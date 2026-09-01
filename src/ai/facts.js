/**
 * Pulls a user's real numbers out of MongoDB for a set of domains.
 *
 * Both the analyst (answering a question) and the tips endpoint need exactly
 * the same block of facts, and neither is allowed to let the model invent a
 * figure — so the fetching lives here once.
 */
import * as expenseService from '../services/expenseService.js';
import * as healthService from '../services/healthService.js';
import * as investmentService from '../services/investmentService.js';
import * as customAgentService from '../services/customAgentService.js';

export async function collectFacts({ userId, domains, range, customDefinitions = [] }) {
  const facts = {};

  if (domains.includes('expense')) {
    const summary = await expenseService.summariseExpenses(userId, range);
    facts.expenses = {
      range: summary.range,
      total: summary.total,
      transactions: summary.count,
      byCategory: summary.byCategory,
      topMerchants: summary.topMerchants
    };
  }

  if (domains.includes('health')) {
    const summary = await healthService.summariseNutrition(userId, range);
    facts.nutrition = {
      range: summary.range,
      totals: summary.totals,
      mealsLogged: summary.mealCount,
      daysLogged: summary.loggedDays,
      averageCaloriesPerLoggedDay: summary.dailyAverage,
      byMealType: summary.byMealType,
      mostFrequentFoods: summary.topFoods
    };
  }

  if (domains.includes('investment')) {
    const summary = await investmentService.summariseInvestments(userId, range);
    facts.investments = {
      range: summary.range,
      total: summary.total,
      contributions: summary.count,
      byType: summary.byType,
      byMonth: summary.byMonth
    };
  }

  for (const definition of customDefinitions) {
    if (!domains.includes(definition.slug)) continue;
    const summary = await customAgentService.summariseEntries(userId, definition, range);
    facts[definition.slug] = {
      name: definition.name,
      range: summary.range,
      entries: summary.count,
      // `totals` already carries each stat's label and unit, so the model has
      // enough to phrase "42 km" without being told the schema separately.
      stats: summary.totals
    };
  }

  return facts;
}
