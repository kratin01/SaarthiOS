/**
 * Builds the single payload the home dashboard needs, plus the rule-based
 * "insights" line. These insights are plain arithmetic, not AI — that keeps the
 * dashboard fast, free and always available.
 */
import { Expense, Meal, Investment } from '../models/index.js';
import { toObjectId } from '../utils/ids.js';
import {
  startOfDay,
  endOfDay,
  startOfMonth,
  endOfMonth,
  addMonths,
  addDays,
  dayBuckets
} from '../utils/dates.js';
import * as expenseService from './expenseService.js';

export const DASHBOARD_PERIODS = ['today', 'month'];

/**
 * The window being shown, and the comparable one before it — today against
 * yesterday, this month against last month.
 */
function resolvePeriod(period, now) {
  if (period === 'month') {
    const previous = addMonths(now, -1);
    return {
      id: 'month',
      label: 'this month',
      previousLabel: 'last month',
      from: startOfMonth(now),
      to: endOfMonth(now),
      prevFrom: startOfMonth(previous),
      prevTo: endOfMonth(previous),
      // A month reads better as its own days than as a rolling week.
      seriesFrom: startOfMonth(now)
    };
  }

  const yesterday = addDays(now, -1);
  return {
    id: 'today',
    label: 'today',
    previousLabel: 'yesterday',
    from: startOfDay(now),
    to: endOfDay(now),
    prevFrom: startOfDay(yesterday),
    prevTo: endOfDay(yesterday),
    // A single day has no shape on its own, so the chart keeps a week of context.
    seriesFrom: startOfDay(addDays(now, -6))
  };
}

export async function getDashboard(user, period = 'today') {
  const userId = toObjectId(user._id);
  const now = new Date();
  const window = resolvePeriod(DASHBOARD_PERIODS.includes(period) ? period : 'today', now);
  const seriesTo = endOfDay(now);

  const [
    expenseTotal,
    expensePrevious,
    expenseByCategory,
    expenseSeries,
    nutrition,
    nutritionSeries,
    recent
  ] = await Promise.all([
    expenseService.totalBetween(userId, window.from, window.to),
    expenseService.totalBetween(userId, window.prevFrom, window.prevTo),
    groupExpenseByCategory(userId, window.from, window.to),
    groupExpenseByDay(userId, window.seriesFrom, seriesTo),
    nutritionBetween(userId, window.from, window.to),
    nutritionByDay(userId, window.seriesFrom, seriesTo),
    recentActivity(userId)
  ]);

  const loggedDays = countLoggedDays(nutritionSeries, window.from);

  return {
    currency: user.currency,
    generatedAt: now,
    period: window.id,
    periodLabel: window.label,
    previousLabel: window.previousLabel,
    expenses: {
      total: expenseTotal,
      previous: expensePrevious,
      changePct: percentChange(expensePrevious, expenseTotal),
      // A monthly budget only means something against a whole month.
      budget: window.id === 'month' ? user.monthlyBudget : null,
      byCategory: expenseByCategory,
      series: expenseSeries
    },
    health: {
      totals: nutrition,
      calorieGoal: user.dailyCalorieGoal,
      loggedDays,
      dailyAverage: loggedDays ? Math.round(nutrition.calories / loggedDays) : 0,
      series: nutritionSeries
    },
    recent,
    insights: buildInsights({
      user,
      window,
      expenseTotal,
      expensePrevious,
      expenseByCategory,
      nutrition,
      dailyAverage: loggedDays ? Math.round(nutrition.calories / loggedDays) : 0
    })
  };
}

/** Days inside the window that have at least one meal logged. */
function countLoggedDays(series, from) {
  const start = startOfDay(from).getTime();
  return series.filter((d) => d.calories > 0 && new Date(`${d.date}T00:00:00`).getTime() >= start)
    .length;
}

/* ── queries ─────────────────────────────────────────────────────────── */

async function groupExpenseByCategory(userId, from, to) {
  const rows = await Expense.aggregate([
    { $match: { user: userId, date: { $gte: from, $lte: to } } },
    { $group: { _id: '$category', amount: { $sum: '$amount' } } },
    { $sort: { amount: -1 } }
  ]);
  return rows.map((r) => ({ category: r._id, amount: r.amount }));
}

async function groupExpenseByDay(userId, from, to) {
  const rows = await Expense.aggregate([
    { $match: { user: userId, date: { $gte: from, $lte: to } } },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$date' } },
        amount: { $sum: '$amount' }
      }
    }
  ]);
  const map = new Map(rows.map((r) => [r._id, r.amount]));
  return dayBuckets(from, to).map((date) => ({ date, amount: map.get(date) ?? 0 }));
}

async function nutritionBetween(userId, from, to) {
  const [row] = await Meal.aggregate([
    { $match: { user: userId, date: { $gte: from, $lte: to } } },
    {
      $group: {
        _id: null,
        calories: { $sum: '$totals.calories' },
        protein: { $sum: '$totals.protein' },
        carbs: { $sum: '$totals.carbs' },
        fat: { $sum: '$totals.fat' },
        meals: { $sum: 1 }
      }
    }
  ]);
  return {
    calories: Math.round(row?.calories ?? 0),
    protein: Math.round(row?.protein ?? 0),
    carbs: Math.round(row?.carbs ?? 0),
    fat: Math.round(row?.fat ?? 0),
    meals: row?.meals ?? 0
  };
}

async function nutritionByDay(userId, from, to) {
  const rows = await Meal.aggregate([
    { $match: { user: userId, date: { $gte: from, $lte: to } } },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$date' } },
        calories: { $sum: '$totals.calories' },
        protein: { $sum: '$totals.protein' }
      }
    }
  ]);
  const map = new Map(rows.map((r) => [r._id, r]));
  return dayBuckets(from, to).map((date) => ({
    date,
    calories: Math.round(map.get(date)?.calories ?? 0),
    protein: Math.round(map.get(date)?.protein ?? 0)
  }));
}

/** The merged "Recent Activity" feed across all three domains. */
async function recentActivity(userId, limit = 8) {
  const [expenses, meals, investments] = await Promise.all([
    Expense.find({ user: userId }).sort({ date: -1 }).limit(limit).lean(),
    Meal.find({ user: userId }).sort({ date: -1 }).limit(limit).lean(),
    Investment.find({ user: userId }).sort({ date: -1 }).limit(limit).lean()
  ]);

  const items = [
    ...expenses.map((e) => ({
      id: String(e._id),
      kind: 'expense',
      title: e.merchant || labelise(e.category),
      subtitle: labelise(e.category),
      amount: e.amount,
      date: e.date
    })),
    ...meals.map((m) => ({
      id: String(m._id),
      kind: 'meal',
      title: m.items.map((i) => i.name).slice(0, 3).join(', ') || 'Meal',
      subtitle: `${labelise(m.mealType)} · ${Math.round(m.totals.calories)} kcal`,
      amount: null,
      date: m.date
    })),
    ...investments.map((i) => ({
      id: String(i._id),
      kind: 'investment',
      title: i.instrument || labelise(i.type),
      subtitle: labelise(i.type),
      amount: i.amount,
      date: i.date
    }))
  ];

  return items.sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, limit);
}

/* ── insights ────────────────────────────────────────────────────────── */

function buildInsights({
  user,
  window,
  expenseTotal,
  expensePrevious,
  expenseByCategory,
  nutrition,
  dailyAverage
}) {
  const insights = [];
  const isMonth = window.id === 'month';

  if (isMonth && user.monthlyBudget > 0) {
    const used = Math.round((expenseTotal / user.monthlyBudget) * 100);
    if (used >= 70) {
      insights.push({
        tone: used >= 100 ? 'alert' : 'warn',
        text: `You have used ${used}% of your ${formatShort(user.monthlyBudget)} monthly budget.`
      });
    }
  }

  if (expensePrevious > 0) {
    const change = percentChange(expensePrevious, expenseTotal);
    if (Math.abs(change) >= 20) {
      insights.push({
        tone: change > 0 ? 'warn' : 'good',
        text:
          change > 0
            ? `Spending ${window.label} is ${change}% higher than ${window.previousLabel}.`
            : `Spending ${window.label} is ${Math.abs(change)}% lower than ${window.previousLabel}. Nice.`
      });
    }
  }

  const top = expenseByCategory[0];
  if (top && expenseTotal > 0) {
    const share = Math.round((top.amount / expenseTotal) * 100);
    if (share >= 40) {
      insights.push({
        tone: 'neutral',
        text: `${labelise(top.category)} is ${share}% of your spending ${window.label}.`
      });
    }
  }

  if (nutrition.meals === 0) {
    insights.push({ tone: 'neutral', text: `No meals logged ${window.label} yet.` });
  } else if (user.dailyCalorieGoal > 0) {
    // A month's raw total against a daily goal would be meaningless.
    const value = isMonth ? dailyAverage : nutrition.calories;
    const used = Math.round((value / user.dailyCalorieGoal) * 100);
    insights.push({
      tone: used > 110 ? 'warn' : 'good',
      text: isMonth
        ? `Averaging ${value} kcal a day — about ${used}% of your ${user.dailyCalorieGoal} kcal goal.`
        : `${value} kcal today — about ${used}% of your ${user.dailyCalorieGoal} kcal goal.`
    });
  }

  return insights.slice(0, 3);
}

/* ── helpers ─────────────────────────────────────────────────────────── */

const percentChange = (before, after) => {
  if (!before) return after > 0 ? 100 : 0;
  return Math.round(((after - before) / before) * 100);
};

const labelise = (value) =>
  String(value ?? '')
    .replace(/_/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase());

const formatShort = (n) => new Intl.NumberFormat('en-IN').format(n);
