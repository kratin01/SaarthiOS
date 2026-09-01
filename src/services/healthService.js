/** All meal / nutrition reads and writes. */
import { Meal } from '../models/Meal.js';
import { ApiError } from '../utils/ApiError.js';
import { toObjectId } from '../utils/ids.js';
import { resolveRange, dayBuckets } from '../utils/dates.js';

export function createMeal(userId, input, { source = 'manual', agentRun = null } = {}) {
  return Meal.create({
    user: userId,
    mealType: input.mealType ?? 'snack',
    items: input.items ?? [],
    note: input.note ?? '',
    date: input.date ?? new Date(),
    source,
    agentRun
  });
}

export function createMeals(userId, inputs, options) {
  return Promise.all(inputs.map((input) => createMeal(userId, input, options)));
}

export async function listMeals(userId, { range = 'week', limit = 50, offset = 0 } = {}) {
  const { from, to } = resolveRange(range);
  const filter = { user: userId, date: { $gte: from, $lte: to } };

  const [items, total] = await Promise.all([
    Meal.find(filter).sort({ date: -1, createdAt: -1, _id: -1 }).skip(offset).limit(limit).lean(),
    Meal.countDocuments(filter)
  ]);

  return { items, total };
}

export async function deleteMeal(userId, id) {
  const deleted = await Meal.findOneAndDelete({ _id: id, user: userId });
  if (!deleted) throw ApiError.notFound('Meal not found');
  return deleted;
}

/**
 * Saved with `.save()` rather than `findOneAndUpdate` so the pre-validate hook
 * runs and `totals` is recomputed — editing an item's calories has to move the
 * meal total with it.
 */
export async function updateMeal(userId, id, input) {
  const meal = await Meal.findOne({ _id: id, user: userId });
  if (!meal) throw ApiError.notFound('Meal not found');

  if (input.mealType !== undefined) meal.mealType = input.mealType;
  if (input.items !== undefined) meal.items = input.items;
  if (input.note !== undefined) meal.note = input.note;
  if (input.date !== undefined) meal.date = input.date;

  await meal.save();
  return meal;
}

/** Daily calorie series, macro split and per-meal-type breakdown. */
export async function summariseNutrition(userId, range = 'week') {
  const { from, to, label } = resolveRange(range);

  const [rows] = await Meal.aggregate([
    { $match: { user: toObjectId(userId), date: { $gte: from, $lte: to } } },
    {
      $facet: {
        totals: [
          {
            $group: {
              _id: null,
              calories: { $sum: '$totals.calories' },
              protein: { $sum: '$totals.protein' },
              carbs: { $sum: '$totals.carbs' },
              fat: { $sum: '$totals.fat' },
              count: { $sum: 1 }
            }
          }
        ],
        byDay: [
          {
            $group: {
              _id: { $dateToString: { format: '%Y-%m-%d', date: '$date' } },
              calories: { $sum: '$totals.calories' },
              protein: { $sum: '$totals.protein' },
              carbs: { $sum: '$totals.carbs' },
              fat: { $sum: '$totals.fat' }
            }
          },
          { $sort: { _id: 1 } }
        ],
        byMealType: [
          { $group: { _id: '$mealType', calories: { $sum: '$totals.calories' }, count: { $sum: 1 } } },
          { $sort: { calories: -1 } }
        ],
        topFoods: [
          { $unwind: '$items' },
          { $group: { _id: '$items.name', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 5 }
        ]
      }
    }
  ]);

  const totals = rows.totals?.[0] ?? { calories: 0, protein: 0, carbs: 0, fat: 0, count: 0 };
  const byDayMap = new Map((rows.byDay ?? []).map((d) => [d._id, d]));
  const series = dayBuckets(from, to).map((date) => ({
    date,
    calories: byDayMap.get(date)?.calories ?? 0,
    protein: byDayMap.get(date)?.protein ?? 0,
    carbs: byDayMap.get(date)?.carbs ?? 0,
    fat: byDayMap.get(date)?.fat ?? 0
  }));

  const loggedDays = series.filter((d) => d.calories > 0).length;

  return {
    range: label,
    from,
    to,
    totals: {
      calories: round(totals.calories),
      protein: round(totals.protein),
      carbs: round(totals.carbs),
      fat: round(totals.fat)
    },
    mealCount: totals.count,
    loggedDays,
    dailyAverage: loggedDays ? round(totals.calories / loggedDays) : 0,
    byDay: series,
    byMealType: (rows.byMealType ?? []).map((m) => ({
      mealType: m._id,
      calories: round(m.calories),
      count: m.count
    })),
    topFoods: (rows.topFoods ?? []).map((f) => ({ name: f._id, count: f.count }))
  };
}

const round = (n) => Math.round((n ?? 0) * 10) / 10;
