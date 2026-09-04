/**
 * All expense reads/writes. Controllers and AI agents both go through here,
 * so business rules exist in exactly one place.
 */
import { Expense } from '../models/Expense.js';
import { User } from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { toObjectId } from '../utils/ids.js';
import { resolveRange, dayBuckets } from '../utils/dates.js';
import {
  MAX_CUSTOM_CATEGORIES,
  categoriesFor,
  isBuiltInCategory,
  normaliseCategory
} from '../utils/categories.js';

/**
 * Turns whatever was typed or predicted into a category this user owns,
 * registering it the first time it is seen.
 *
 * Returns "other" rather than throwing when the list is full: refusing to save
 * someone's expense over a category name would be the wrong trade.
 */
export async function resolveCategory(userId, raw) {
  const category = normaliseCategory(raw);
  if (!category) return 'other';
  if (isBuiltInCategory(category)) return category;

  const user = await User.findById(userId).select('customCategories');
  if (!user) return 'other';

  if (user.customCategories.includes(category)) return category;
  if (user.customCategories.length >= MAX_CUSTOM_CATEGORIES) return 'other';

  // Atomic so two expenses saved together cannot add the same name twice.
  await User.updateOne({ _id: userId }, { $addToSet: { customCategories: category } });
  return category;
}

export async function listCategories(userId) {
  const user = await User.findById(userId).select('customCategories').lean();
  return categoriesFor(user);
}

export async function createExpense(userId, input, { source = 'manual', agentRun = null } = {}) {
  return Expense.create({
    user: userId,
    amount: input.amount,
    category: await resolveCategory(userId, input.category),
    merchant: input.merchant ?? '',
    note: input.note ?? '',
    date: input.date ?? new Date(),
    source,
    agentRun
  });
}

export function createExpenses(userId, inputs, options) {
  return Promise.all(inputs.map((input) => createExpense(userId, input, options)));
}

/** Returns one page of rows plus the true total, so the UI can offer "load more". */
export async function listExpenses(userId, { range = 'month', category, limit = 50, offset = 0 } = {}) {
  const { from, to } = resolveRange(range);
  const filter = { user: userId, date: { $gte: from, $lte: to } };
  if (category) filter.category = category;

  const [items, total] = await Promise.all([
    // `_id` breaks ties: rows sharing a date have no stable order otherwise, and
    // `skip` would then show the same row on two pages and hide another.
    Expense.find(filter).sort({ date: -1, createdAt: -1, _id: -1 }).skip(offset).limit(limit).lean(),
    Expense.countDocuments(filter)
  ]);

  return { items, total };
}

export async function deleteExpense(userId, id) {
  const deleted = await Expense.findOneAndDelete({ _id: id, user: userId });
  if (!deleted) throw ApiError.notFound('Expense not found');
  return deleted;
}

/**
 * Correcting a row by hand. `source` is deliberately left alone: knowing a row
 * originally came from chat stays true even after you fix a number on it.
 */
export async function updateExpense(userId, id, input) {
  const changes = Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined)
  );
  // Editing a row is another way to invent a category, so it registers too.
  if (changes.category !== undefined) {
    changes.category = await resolveCategory(userId, changes.category);
  }
  const updated = await Expense.findOneAndUpdate(
    { _id: id, user: userId },
    { $set: changes },
    { new: true, runValidators: true }
  );
  if (!updated) throw ApiError.notFound('Expense not found');
  return updated;
}

/** Totals + per-category split + a daily series for the chart. */
export async function summariseExpenses(userId, range = 'month') {
  const { from, to, label } = resolveRange(range);

  const [rows] = await Expense.aggregate([
    { $match: { user: toObjectId(userId), date: { $gte: from, $lte: to } } },
    {
      $facet: {
        total: [{ $group: { _id: null, amount: { $sum: '$amount' }, count: { $sum: 1 } } }],
        byCategory: [
          { $group: { _id: '$category', amount: { $sum: '$amount' }, count: { $sum: 1 } } },
          { $sort: { amount: -1 } }
        ],
        byDay: [
          {
            $group: {
              _id: { $dateToString: { format: '%Y-%m-%d', date: '$date' } },
              amount: { $sum: '$amount' }
            }
          },
          { $sort: { _id: 1 } }
        ],
        topMerchants: [
          { $match: { merchant: { $ne: '' } } },
          { $group: { _id: '$merchant', amount: { $sum: '$amount' }, count: { $sum: 1 } } },
          { $sort: { amount: -1 } },
          { $limit: 5 }
        ]
      }
    }
  ]);

  const byDayMap = new Map((rows.byDay ?? []).map((d) => [d._id, d.amount]));

  return {
    range: label,
    from,
    to,
    total: rows.total?.[0]?.amount ?? 0,
    count: rows.total?.[0]?.count ?? 0,
    byCategory: (rows.byCategory ?? []).map((c) => ({
      category: c._id,
      amount: c.amount,
      count: c.count
    })),
    byDay: buildSeries(from, to, byDayMap),
    topMerchants: (rows.topMerchants ?? []).map((m) => ({
      merchant: m._id,
      amount: m.amount,
      count: m.count
    }))
  };
}

/** Sum for an arbitrary window — used for month-over-month comparisons. */
export async function totalBetween(userId, from, to) {
  const [row] = await Expense.aggregate([
    { $match: { user: toObjectId(userId), date: { $gte: from, $lte: to } } },
    { $group: { _id: null, amount: { $sum: '$amount' } } }
  ]);
  return row?.amount ?? 0;
}

function buildSeries(from, to, map) {
  // Long windows would produce hundreds of points; day-level detail only helps
  // for roughly a quarter or less.
  const days = Math.round((to - from) / 86_400_000);
  if (days > 120) {
    return [...map.entries()].map(([date, amount]) => ({ date, amount }));
  }
  return dayBuckets(from, to).map((date) => ({ date, amount: map.get(date) ?? 0 }));
}
