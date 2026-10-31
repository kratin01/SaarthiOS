/**
 * Month in review: a recap of one calendar month built entirely from the user's
 * own records. Every number here is worked out in code; the insight agent only
 * adds words on top of it (`getReviewStory`).
 */
import { AgentRun, CustomAgent, DailyBrief, Expense, Investment, Meal } from '../models/index.js';
import * as expenseService from './expenseService.js';
import * as subscriptionService from './subscriptionService.js';
import * as customAgentService from './customAgentService.js';
import { resolveForUser } from './aiSettingsService.js';
import { writeReviewStory } from '../ai/agents/insightAgent.js';
import { ApiError } from '../utils/ApiError.js';
import {
  addDays,
  addMonths,
  dayBuckets,
  endOfDay,
  monthKeyLabel,
  parseMonthKey,
  resolveRange,
  toDateKey,
  toMonthKey
} from '../utils/dates.js';

/** A month key such as `2026-10`; defaults to this month and never looks into the future. */
export function resolveReviewMonth(value, now = new Date()) {
  const month = value ? String(value) : toMonthKey(now);
  if (!parseMonthKey(month)) throw ApiError.badRequest('Pick a month such as 2026-10.');
  if (month > toMonthKey(now)) throw ApiError.badRequest('That month has not happened yet.');
  return month;
}

export async function getMonthReview(user, monthKey, now = new Date()) {
  const month = resolveReviewMonth(monthKey, now);
  const isCurrent = month === toMonthKey(now);
  const { from, to } = resolveRange(month, now);
  const until = isCurrent ? endOfDay(now) : to;
  const days = dayBuckets(from, until);

  // A month still running is compared with the same number of days of the one before.
  const previousKey = toMonthKey(addMonths(from, -1));
  const previous = resolveRange(previousKey, now);
  const previousTo = isCurrent
    ? new Date(Math.min(previous.to, endOfDay(addDays(previous.from, days.length - 1))))
    : previous.to;

  const userId = user._id;
  const window = { $gte: from, $lte: until };
  const [expenses, previousTotal, meals, investments, subscriptions, agents, messages] =
    await Promise.all([
      Expense.find({ user: userId, date: window })
        .select('amount category merchant note date source')
        .lean(),
      expenseService.totalBetween(userId, previous.from, previousTo),
      Meal.find({ user: userId, date: window }).select('date items totals').lean(),
      Investment.find({ user: userId, date: window }).select('amount type').lean(),
      subscriptionService.summariseSubscriptions(userId, now),
      agentSummaries(userId, month),
      AgentRun.countDocuments({ user: userId, createdAt: window })
    ]);

  const summary = summariseMonth({ days, expenses, meals, investments, user });

  return {
    month,
    label: monthKeyLabel(month),
    isCurrent,
    currency: user.currency,
    daysCovered: days.length,
    money: {
      ...summary.money,
      previous: {
        total: previousTotal,
        label: monthKeyLabel(previousKey).split(' ')[0],
        partial: isCurrent
      },
      changePct: previousTotal
        ? Math.round(((summary.money.total - previousTotal) / previousTotal) * 100)
        : null
    },
    food: summary.food,
    investing: summary.investing,
    subscriptions: { monthly: Math.round(subscriptions.monthly), active: subscriptions.activeCount },
    agents,
    assistant: { messages }
  };
}

async function agentSummaries(userId, month) {
  const agents = await CustomAgent.find({ user: userId, active: true }).sort({ createdAt: 1 }).lean();
  const rows = await Promise.all(
    agents.map(async (agent) => {
      const summary = await customAgentService.summariseEntries(userId, agent, month);
      const [first] = summary.totals;
      return {
        name: agent.name,
        icon: agent.icon,
        entries: summary.count,
        stat: first ? { label: first.label, unit: first.unit, total: first.total } : null
      };
    })
  );
  return rows.filter((row) => row.entries > 0);
}

/**
 * The recap itself, from plain rows. Pure, so every rule is easy to test.
 * `days` are the local `YYYY-MM-DD` keys of the month that have already happened.
 */
export function summariseMonth({ days, expenses, meals, investments, user }) {
  return {
    money: summariseMoney(days, expenses, user),
    food: summariseFood(meals, user),
    investing: summariseInvesting(investments)
  };
}

function summariseMoney(days, expenses, user) {
  const total = sum(expenses, (row) => row.amount);
  const byDay = new Map(days.map((day) => [day, 0]));
  for (const row of expenses) {
    const day = toDateKey(row.date);
    if (byDay.has(day)) byDay.set(day, byDay.get(day) + row.amount);
  }

  let noSpendDays = 0;
  let streak = null;
  let longestNoSpend = null;
  for (const day of days) {
    if (byDay.get(day) > 0) {
      streak = null;
      continue;
    }
    noSpendDays += 1;
    streak = streak ? { ...streak, to: day, days: streak.days + 1 } : { from: day, to: day, days: 1 };
    if (!longestNoSpend || streak.days > longestNoSpend.days) longestNoSpend = streak;
  }

  const busiest = [...byDay.entries()].reduce(
    (best, [date, amount]) => (amount > (best?.amount ?? 0) ? { date, amount: round(amount) } : best),
    null
  );

  const biggestRow = expenses.reduce((best, row) => (row.amount > (best?.amount ?? 0) ? row : best), null);

  const categories = [...groupBy(expenses, (row) => row.category).entries()]
    .map(([category, rows]) => ({ category, amount: round(sum(rows, (row) => row.amount)) }))
    .sort((a, b) => b.amount - a.amount)
    .map((row) => ({ ...row, share: percent(row.amount, total) }));

  // A "regular" needs at least two visits; one purchase is not a habit.
  const regular = [...groupBy(
    expenses.filter((row) => row.merchant?.trim()),
    (row) => row.merchant.trim().toLowerCase()
  ).values()]
    .map((rows) => ({
      merchant: rows[0].merchant.trim(),
      count: rows.length,
      amount: round(sum(rows, (row) => row.amount))
    }))
    .filter((row) => row.count >= 2)
    .sort((a, b) => b.count - a.count || b.amount - a.amount)[0] ?? null;

  const isWeekend = (row) => [0, 6].includes(new Date(row.date).getDay());
  const weekend = sum(expenses.filter(isWeekend), (row) => row.amount);
  const viaChat = expenses.filter((row) => row.source === 'chat').length;
  const budget = user.monthlyBudget > 0 ? user.monthlyBudget : null;

  return {
    total: round(total),
    transactions: expenses.length,
    dailyAverage: days.length ? Math.round(total / days.length) : 0,
    budget,
    budgetUsedPct: budget ? percent(total, budget) : null,
    noSpendDays,
    longestNoSpend: longestNoSpend && longestNoSpend.days >= 2 ? longestNoSpend : null,
    busiestDay: busiest,
    biggest: biggestRow
      ? {
        amount: biggestRow.amount,
        label: biggestRow.note || biggestRow.merchant || labelise(biggestRow.category),
        merchant: biggestRow.merchant || '',
        category: biggestRow.category,
        date: toDateKey(biggestRow.date)
      }
      : null,
    categories: categories.slice(0, 6),
    regular,
    weekendShare: total ? percent(weekend, total) : null,
    viaChatShare: expenses.length ? percent(viaChat, expenses.length) : null
  };
}

function summariseFood(meals, user) {
  const byDay = new Map();
  const foods = new Map();
  for (const meal of meals) {
    const day = toDateKey(meal.date);
    const totals = byDay.get(day) ?? { calories: 0, protein: 0 };
    totals.calories += meal.totals?.calories ?? 0;
    totals.protein += meal.totals?.protein ?? 0;
    byDay.set(day, totals);
    for (const item of meal.items ?? []) {
      const key = item.name.trim().toLowerCase();
      const seen = foods.get(key) ?? { name: item.name.trim(), count: 0 };
      seen.count += 1;
      foods.set(key, seen);
    }
  }

  const logged = [...byDay.values()].filter((day) => day.calories > 0);
  const calorieGoal = user.dailyCalorieGoal ?? 0;
  const proteinGoal = user.dailyProteinGoal ?? 0;
  const favourite = [...foods.values()].sort((a, b) => b.count - a.count)[0];

  return {
    meals: meals.length,
    daysLogged: logged.length,
    avgCalories: logged.length ? Math.round(sum(logged, (day) => day.calories) / logged.length) : 0,
    calorieGoal,
    // Within ten per cent either side of the goal counts as on target.
    onTargetDays: calorieGoal
      ? logged.filter((day) => Math.abs(day.calories - calorieGoal) <= calorieGoal * 0.1).length
      : 0,
    avgProtein: logged.length ? Math.round(sum(logged, (day) => day.protein) / logged.length) : 0,
    proteinGoal,
    proteinGoalDays: proteinGoal ? logged.filter((day) => day.protein >= proteinGoal).length : 0,
    favourite: favourite && favourite.count >= 2 ? favourite : null
  };
}

function summariseInvesting(investments) {
  const byType = [...groupBy(investments, (row) => row.type).entries()]
    .map(([type, rows]) => ({ type, amount: sum(rows, (row) => row.amount) }))
    .sort((a, b) => b.amount - a.amount);
  return {
    total: round(sum(investments, (row) => row.amount)),
    count: investments.length,
    topType: byType[0]?.type ?? null
  };
}

/** Stories being written now, so a second request waits for the same AI call. */
const writing = new Map();

/**
 * The insight agent's write-up of a month. A finished month does not change, so
 * its story is kept until the user asks for a new one; the current month is
 * rewritten at most once a day.
 */
export async function getReviewStory(user, monthKey, { fresh = false } = {}) {
  const now = new Date();
  const month = resolveReviewMonth(monthKey, now);
  const slot = `review:${month}`;
  const today = toDateKey(now);
  const isCurrent = month === toMonthKey(now);

  if (!fresh) {
    const cached = await DailyBrief.findOne({ user: user._id, slot }).lean();
    if (cached?.content && (!isCurrent || cached.day === today)) return cached.content;
  }

  const key = `${user._id}:${month}`;
  if (!writing.has(key)) {
    writing.set(key, writeStory(user, month, now).finally(() => writing.delete(key)));
  }
  return writing.get(key);
}

async function writeStory(user, month, now) {
  const review = await getMonthReview(user, month, now);
  if (!review.money.transactions && !review.food.meals && !review.investing.count) {
    throw ApiError.badRequest(`There is nothing logged in ${review.label} to write about yet.`);
  }

  const config = await resolveForUser(user._id);
  if (!config.ok) {
    throw ApiError.unavailable('Add an AI provider in Settings and your month will be written up for you.');
  }

  const content = { ...(await writeReviewStory({ user, review, config })), generatedAt: now };
  await DailyBrief.updateOne(
    { user: user._id, slot: `review:${month}` },
    { $set: { day: toDateKey(now), content } },
    { upsert: true }
  );
  return content;
}

const sum = (rows, valueOf) => rows.reduce((total, row) => total + (valueOf(row) || 0), 0);
const round = (n) => Math.round(n * 100) / 100;
const percent = (part, whole) => (whole ? Math.round((part / whole) * 100) : 0);

function groupBy(rows, keyOf) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyOf(row);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return groups;
}

const labelise = (value) =>
  String(value ?? '').replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
