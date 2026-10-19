/**
 * Apps Agent: links outside apps such as Swiggy and brings their orders in.
 *
 * It never invents an order. Connecting hands the browser a sign-in button, and
 * fetching reads the app itself; only the nutrition is an estimate.
 */
import { findApp, listApps } from '../../integrations/catalog.js';
import * as connections from '../../services/connectionService.js';
import { importRecentOrders } from '../../services/orderImportService.js';

export const appsAgent = {
  name: 'apps',
  label: 'Apps Agent',

  async run({ user, request, config, agentRunId }) {
    const usable = listApps().filter((app) => !connections.unavailableReason(app));
    // An unnamed app is only guessed when there is exactly one it could be.
    const app = findApp(request.app) ?? (usable.length === 1 && !request.app ? usable[0] : null);
    if (!app) {
      return answer(
        usable.length
          ? `Which app should I use? I can connect ${usable.map((a) => a.label).join(' and ')}.`
          : 'Connecting apps is not switched on yet.'
      );
    }

    const reason = connections.unavailableReason(app);
    if (reason) return answer(reason);

    const status = await connections.connectionStatus(user._id, app);
    if (request.action === 'connect') {
      if (status === 'connected') {
        return answer(`${app.label} is already connected. Ask me to add your latest ${app.label} order whenever you like.`);
      }
      return signIn(app, `Taking you to ${app.label} to sign in. You will come straight back here.`);
    }

    if (status !== 'connected') {
      return signIn(
        app,
        status === 'expired'
          ? `Your ${app.label} sign-in has expired. Connect it again, then ask me once more.`
          : `${app.label} is not connected yet. Connect it, then ask me again.`
      );
    }

    try {
      const result = await importRecentOrders({ user, app, count: request.count, config, agentRunId });
      return describe(app, result, user.currency);
    } catch (error) {
      if (error instanceof connections.ReconnectNeeded) return signIn(app, error.message);
      throw error;
    }
  }
};

const answer = (reply) => ({ done: false, summary: reply, reply, action: null, expenses: [], meals: [] });

const signIn = (app, reply) => ({
  done: true,
  summary: `Sign-in to ${app.label} needed`,
  reply,
  action: { kind: 'connect_app', app: app.id, label: app.label },
  expenses: [],
  meals: []
});

/** Written in code so the amounts read back are exactly the ones saved. */
function describe(app, { found, imported, duplicates }, currency) {
  const expenses = imported.map((i) => i.expense);
  const meals = imported.map((i) => i.meal).filter(Boolean);

  if (!found) return answer(`I could not find a delivered ${app.label} order yet.`);
  if (!imported.length) {
    return answer(
      duplicates === 1
        ? `Your latest ${app.label} order is already recorded.`
        : `Those ${app.label} orders are already recorded.`
    );
  }

  const parts = [];
  if (imported.length === 1) {
    const { order } = imported[0];
    parts.push(`Added your ${app.label} order from ${order.restaurant}: ${money(order.amount, currency)} under food.`);
  } else {
    const total = imported.reduce((sum, i) => sum + i.order.amount, 0);
    parts.push(`Added ${imported.length} ${app.label} orders totalling ${money(total, currency)} under food.`);
  }

  if (meals.length) {
    const dishes = meals.flatMap((m) => m.items.map((i) => `${i.name} (${i.quantity})`));
    const calories = Math.round(meals.reduce((sum, m) => sum + m.totals.calories, 0));
    const protein = Math.round(meals.reduce((sum, m) => sum + m.totals.protein, 0));
    parts.push(
      `${meals.length === 1 ? 'Meal' : 'Meals'} logged: ${dishes.slice(0, 4).join(', ')}${dishes.length > 4 ? ' and more' : ''}. Roughly ${calories} kcal, ${protein} g protein. These are estimates for those portions.`
    );
  }
  if (meals.length < imported.length) {
    parts.push('I could not estimate the food this time, so add it from Health if you want it tracked.');
  }
  if (duplicates) {
    parts.push(`${duplicates} ${duplicates === 1 ? 'order was' : 'orders were'} already recorded.`);
  }

  const reply = parts.join(' ');
  return { done: true, summary: reply, reply, action: null, expenses, meals };
}

const money = (amount, currency) =>
  `${currency} ${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(amount)}`;
