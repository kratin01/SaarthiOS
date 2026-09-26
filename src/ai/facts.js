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
import * as subscriptionService from '../services/subscriptionService.js';
import * as customAgentService from '../services/customAgentService.js';
import { toDateKey } from '../utils/dates.js';

/**
 * How many individual rows travel to the model.
 *
 * Summaries alone cannot answer "show me each one", but a whole year of
 * expenses would be a small novel of tokens on every question. Enough to
 * tabulate, and the count is sent too so the answer can say what was left out.
 */
const ROW_LIMIT = 40;

export async function collectFacts({ userId, domains, range, customDefinitions = [] }) {
  const facts = {};

  if (domains.includes('expense')) {
    const [summary, rows] = await Promise.all([
      expenseService.summariseExpenses(userId, range),
      expenseService.listExpenses(userId, { range, limit: ROW_LIMIT })
    ]);
    facts.expenses = {
      range: summary.range,
      total: summary.total,
      transactions: summary.count,
      byCategory: summary.byCategory,
      topMerchants: summary.topMerchants,
      items: rows.items.map((e) => ({
        date: toDateKey(e.date),
        category: e.category,
        merchant: e.merchant || '',
        amount: e.amount,
        note: e.note || ''
      })),
      itemsShown: rows.items.length,
      itemsTotal: rows.total
    };
  }

  if (domains.includes('health')) {
    const [summary, rows] = await Promise.all([
      healthService.summariseNutrition(userId, range),
      healthService.listMeals(userId, { range, limit: ROW_LIMIT })
    ]);
    facts.nutrition = {
      range: summary.range,
      totals: summary.totals,
      mealsLogged: summary.mealCount,
      daysLogged: summary.loggedDays,
      averageCaloriesPerLoggedDay: summary.dailyAverage,
      byMealType: summary.byMealType,
      mostFrequentFoods: summary.topFoods,
      items: rows.items.map((m) => ({
        date: toDateKey(m.date),
        mealType: m.mealType,
        foods: m.items.map((i) => `${i.name} (${i.quantity})`).join(', '),
        calories: Math.round(m.totals?.calories ?? 0),
        protein: Math.round(m.totals?.protein ?? 0)
      })),
      itemsShown: rows.items.length,
      itemsTotal: rows.total
    };
  }

  if (domains.includes('investment')) {
    const [summary, rows] = await Promise.all([
      investmentService.summariseInvestments(userId, range),
      investmentService.listInvestments(userId, { range, limit: ROW_LIMIT })
    ]);
    facts.investments = {
      range: summary.range,
      total: summary.total,
      contributions: summary.count,
      byType: summary.byType,
      byMonth: summary.byMonth,
      items: rows.items.map((i) => ({
        date: toDateKey(i.date),
        type: i.type,
        instrument: i.instrument || '',
        amount: i.amount,
        quantity: i.quantity ?? null
      })),
      itemsShown: rows.items.length,
      itemsTotal: rows.total
    };
  }

  /**
   * A subscription is not tied to the selected range — it either runs today or
   * it does not — so this one block answers every period.
   */
  if (domains.includes('subscription')) {
    const [summary, rows] = await Promise.all([
      subscriptionService.summariseSubscriptions(userId),
      subscriptionService.listSubscriptions(userId, { limit: ROW_LIMIT })
    ]);
    facts.subscriptions = {
      monthlyCost: round(summary.monthly),
      yearlyCost: round(summary.yearly),
      paidToDateAcrossAll: round(summary.paidToDate),
      active: summary.activeCount,
      cancelled: summary.cancelledCount,
      byCategory: summary.byCategory.map((c) => ({ ...c, monthly: round(c.monthly) })),
      shareOfLastMonthSpending: summary.shareOfSpending,
      dueInNext30Days: round(summary.dueThisMonth),
      upcomingCharges: summary.upcoming,
      items: rows.items.map((s) => ({
        name: s.name,
        amount: s.amount,
        cycle: s.cycle,
        category: s.category,
        monthlyEquivalent: round(s.monthly),
        startedOn: toDateKey(s.startedOn),
        chargedSoFar: s.charges,
        paidToDate: round(s.paidToDate),
        active: s.active
      })),
      itemsShown: rows.items.length,
      itemsTotal: rows.total
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

const round = (n) => Math.round((n ?? 0) * 100) / 100;
