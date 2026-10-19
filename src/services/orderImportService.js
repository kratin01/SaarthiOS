/**
 * Turns a connected app's recent food orders into expenses and meals.
 *
 * Restaurant, amount, time and dishes come straight from the app and never pass
 * through the model. The model only estimates nutrition for the dishes, as it
 * does for a typed meal, and a failed estimate never costs the user the expense.
 */
import { askJson } from '../ai/llm.js';
import { orderNutritionSchema } from '../ai/schemas.js';
import { buildOrderNutritionPrompt } from '../ai/prompts.js';
import * as expenseService from './expenseService.js';
import * as healthService from './healthService.js';
import * as connections from './connectionService.js';
import { logger } from '../utils/logger.js';

export async function importRecentOrders({ user, app, count, config, agentRunId }) {
  const orders = await connections.withTools(user._id, app, (call) => app.orders(call, { count }));

  const fresh = [];
  let duplicates = 0;
  for (const order of orders.filter((o) => o.amount > 0)) {
    if (await connections.claimOrder(user._id, app.id, order.id)) fresh.push(order);
    else duplicates += 1;
  }

  const nutrition = fresh.length ? await estimateNutrition(fresh, config) : new Map();
  const options = { source: 'chat', agentRun: agentRunId };
  const imported = [];

  for (const order of fresh) {
    const date = localNoon(order.orderedAt);
    let expense;
    try {
      expense = await expenseService.createExpense(
        user._id,
        {
          amount: order.amount,
          category: 'food',
          merchant: order.restaurant,
          note: `${app.label} order ${order.id}`,
          date
        },
        options
      );
    } catch (error) {
      // Unclaim it, so asking again retries this order instead of skipping it.
      await connections.releaseOrder(user._id, app.id, order.id);
      throw error;
    }

    const items = nutrition.get(order.id);
    const meal = items
      ? await healthService
          .createMeal(
            user._id,
            {
              mealType: mealTypeAt(order.orderedAt),
              items,
              note: `${app.label} order from ${order.restaurant}`.slice(0, 300),
              date
            },
            options
          )
          .catch((error) => {
            logger.warn(`${app.id} meal not saved`, error.message);
            return null;
          })
      : null;

    imported.push({ order, expense, meal });
  }

  return { found: orders.length, imported, duplicates };
}

async function estimateNutrition(orders, config) {
  try {
    const plan = await askJson({
      config,
      system: buildOrderNutritionPrompt(),
      user: JSON.stringify({
        orders: orders.map((o) => ({ orderId: o.id, restaurant: o.restaurant, dishes: o.items }))
      }),
      schema: orderNutritionSchema
    });
    const ids = new Set(orders.map((o) => o.id));
    return new Map(plan.meals.filter((m) => ids.has(m.orderId)).map((m) => [m.orderId, m.items]));
  } catch (error) {
    logger.warn('order nutrition estimate failed', error.message);
    return new Map();
  }
}

/** Calendar days are stored at local noon, like every other dated record. */
function localNoon(value) {
  const now = new Date();
  const date = value && value <= new Date(now.getTime() + 86_400_000) ? value : now;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
}

function mealTypeAt(value) {
  const hour = (value ?? new Date()).getHours();
  if (hour >= 4 && hour < 11) return 'breakfast';
  if (hour >= 11 && hour < 16) return 'lunch';
  if (hour >= 16 && hour < 19) return 'snack';
  return 'dinner';
}
