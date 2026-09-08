/**
 * Numbers for the admin dashboard.
 *
 * Deliberately no chat text, no expense rows, no meal rows. Knowing who signed
 * up and how much they use the app is running a service; reading what someone
 * ate is not, and the moment this page can do that, one stolen session becomes
 * everyone's private log.
 */
import { User, Expense, Meal, Investment, AgentRun, CustomAgent } from '../models/index.js';
import { addDays, startOfDay } from '../utils/dates.js';

/** Per-user totals and the last time anything was written, in one pass each. */
const countAndLatest = (model) =>
  model
    .aggregate([{ $group: { _id: '$user', count: { $sum: 1 }, last: { $max: '$createdAt' } } }])
    .then((rows) => new Map(rows.map((r) => [String(r._id), r])));

const laterOf = (a, b) => (!a ? b : !b ? a : a > b ? a : b);

export async function getAdminOverview({ days = 30 } = {}) {
  const since = startOfDay(addDays(new Date(), -(days - 1)));

  const [users, expenses, meals, investments, runs, agents] = await Promise.all([
    User.find({}).select('name email createdAt googleId').sort({ createdAt: -1 }).lean(),
    countAndLatest(Expense),
    countAndLatest(Meal),
    countAndLatest(Investment),
    countAndLatest(AgentRun),
    countAndLatest(CustomAgent)
  ]);

  const people = users.map((u) => {
    const id = String(u._id);
    const counts = {
      expenses: expenses.get(id)?.count ?? 0,
      meals: meals.get(id)?.count ?? 0,
      investments: investments.get(id)?.count ?? 0,
      messages: runs.get(id)?.count ?? 0,
      agents: agents.get(id)?.count ?? 0
    };

    const lastActive = [expenses, meals, investments, runs]
      .map((m) => m.get(id)?.last)
      .reduce(laterOf, null);

    return {
      id,
      name: u.name,
      email: u.email,
      joinedAt: u.createdAt,
      signedInWith: u.googleId ? 'google' : 'password',
      lastActiveAt: lastActive ?? null,
      records: counts.expenses + counts.meals + counts.investments,
      ...counts
    };
  });

  const now = Date.now();
  const withinDays = (date, n) => date && now - new Date(date).getTime() <= n * 86400000;

  // A signup that never logged anything is the number that actually matters,
  // and it is invisible in a plain user count.
  const activity = {
    total: people.length,
    newThisWeek: people.filter((p) => withinDays(p.joinedAt, 7)).length,
    activeSevenDays: people.filter((p) => withinDays(p.lastActiveAt, 7)).length,
    activeThirtyDays: people.filter((p) => withinDays(p.lastActiveAt, 30)).length,
    neverUsed: people.filter((p) => !p.lastActiveAt).length
  };

  const [signupsByDay, runsByDay, failures] = await Promise.all([
    perDay(User, since),
    perDay(AgentRun, since),
    AgentRun.aggregate([
      { $match: { createdAt: { $gte: since }, status: { $ne: 'completed' } } },
      { $group: { _id: '$error', count: { $sum: 1 }, last: { $max: '$createdAt' } } },
      { $sort: { count: -1 } },
      { $limit: 8 }
    ])
  ]);

  const runsTotal = await AgentRun.countDocuments({ createdAt: { $gte: since } });
  const runsFailed = failures.reduce((sum, f) => sum + f.count, 0);

  return {
    generatedAt: new Date(),
    windowDays: days,
    users: activity,
    people,
    totals: {
      expenses: sumOf(expenses),
      meals: sumOf(meals),
      investments: sumOf(investments),
      messages: sumOf(runs),
      agents: sumOf(agents)
    },
    ai: {
      runs: runsTotal,
      failed: runsFailed,
      failureRate: runsTotal ? Math.round((runsFailed / runsTotal) * 1000) / 10 : 0,
      recentFailures: failures.map((f) => ({
        reason: f._id || 'Unknown error',
        count: f.count,
        lastAt: f.last
      }))
    },
    signupsByDay,
    messagesByDay: runsByDay
  };
}

const sumOf = (map) => [...map.values()].reduce((total, row) => total + row.count, 0);

/** Zero-filled so the chart shows quiet days instead of skipping them. */
async function perDay(model, since) {
  const rows = await model.aggregate([
    { $match: { createdAt: { $gte: since } } },
    { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } }
  ]);
  const found = new Map(rows.map((r) => [r._id, r.count]));

  const out = [];
  for (let day = new Date(since); day <= new Date(); day = addDays(day, 1)) {
    const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
    out.push({ date: key, count: found.get(key) ?? 0 });
  }
  return out;
}
