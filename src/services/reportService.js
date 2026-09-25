/**
 * Downloadable monthly reports.
 *
 * Both reports read the same rows the screens read, group them the same way,
 * and lay them out as a workbook: a summary first, then a category-by-category
 * breakdown, then the raw rows for anyone who wants to pivot them.
 */
import { Expense } from '../models/Expense.js';
import { Meal } from '../models/Meal.js';
import { ApiError } from '../utils/ApiError.js';
import { currencySymbol } from '../config/constants.js';
import { rangeSchema } from '../ai/schemas.js';
import { dayBuckets, isMonthRange, resolveRange, toDateKey, toMonthKey } from '../utils/dates.js';
import * as xl from '../utils/excel.js';

/**
 * A personal log never comes near this. It is here so one `range=all` request
 * on a huge account cannot try to hold everything in memory at once.
 */
const MAX_ROWS = 10_000;

/** Past a few months a day-by-day sheet is noise, so it switches to months. */
const MAX_DAILY_ROWS = 120;

/** Reports read the range straight off the query string, so it is checked here. */
export function readRange(value) {
  const parsed = rangeSchema.safeParse(value ?? 'month');
  if (!parsed.success) throw ApiError.badRequest('That is not a period I can report on');
  return parsed.data;
}

export async function buildExpenseReport(user, range) {
  const rows = await fetchRows(Expense, user._id, range);
  const symbol = currencySymbol(user.currency);
  const money = xl.moneyFormat(symbol);
  const period = describePeriod(range, rows.at(-1)?.date);

  const total = sum(rows, (item) => item.amount);
  const byCategory = groupBy(rows, (item) => item.category || 'other', (item) => item.amount);
  const byMerchant = groupBy(
    rows.filter((item) => item.merchant),
    (item) => item.merchant,
    (item) => item.amount
  );
  const largest = rows.reduce((best, item) => (!best || item.amount > best.amount ? item : best), null);

  const workbook = xl.createWorkbook('SaarthiOS expense report');

  // ---- Summary -------------------------------------------------------------
  const summary = xl.addSheet(workbook, 'Summary', [30, 18, 12, 16, 16]);
  let row = xl.writeTitle(summary, {
    title: 'Expense report',
    subtitle: period.subtitle,
    meta: reportMeta(user),
    span: 5
  });

  row = xl.writeHeading(summary, row, 'Overview', 5);
  row = xl.writeFacts(summary, row, [
    { label: 'Total spent', value: total, numFmt: money },
    { label: 'Transactions', value: rows.length, numFmt: xl.NUMBER_FORMAT },
    {
      label: 'Average a day',
      value: period.days ? total / period.days : 0,
      numFmt: money,
      hint: `over ${period.days} day${period.days === 1 ? '' : 's'}`
    },
    {
      label: 'Average a transaction',
      value: rows.length ? total / rows.length : 0,
      numFmt: money
    },
    {
      label: 'Biggest category',
      value: byCategory[0] ? labelise(byCategory[0].key) : '—',
      hint: byCategory[0] ? `${share(byCategory[0].amount, total)} of everything spent` : ''
    },
    {
      label: 'Largest single expense',
      value: largest ? largest.amount : 0,
      numFmt: money,
      hint: largest ? `${describeExpense(largest)} · ${dateText(largest.date)}` : ''
    },
    ...budgetFacts(user, range, total, { money, symbol })
  ], { span: 5 });

  row = xl.writeHeading(summary, row, 'Spend by category', 5);
  if (byCategory.length) {
    xl.writeTable(summary, {
      row,
      columns: [
        { header: 'Category' },
        { header: 'Amount', align: 'right', numFmt: money },
        { header: 'Share', align: 'right', numFmt: xl.PERCENT_FORMAT },
        { header: 'Transactions', align: 'right', numFmt: xl.NUMBER_FORMAT },
        { header: 'Average', align: 'right', numFmt: money }
      ],
      rows: byCategory.map((group) => [
        labelise(group.key),
        group.amount,
        total ? group.amount / total : 0,
        group.count,
        group.amount / group.count
      ]),
      total: ['Total', total, total ? 1 : 0, rows.length, rows.length ? total / rows.length : 0],
      freeze: false
    });
  } else {
    xl.writeEmpty(summary, row, 'No expenses recorded in this period.', 5);
  }

  // ---- Every expense, grouped under its category ---------------------------
  const detail = xl.addSheet(workbook, 'By category', [20, 42, 26, 16]);
  row = xl.writeTitle(detail, {
    title: 'Expenses by category',
    subtitle: period.subtitle,
    meta: 'Categories and the expenses inside them run from largest to smallest.',
    span: 4
  });

  if (rows.length) {
    const grouped = [];
    for (const group of byCategory) {
      grouped.push({
        cells: [
          labelise(group.key),
          `${group.count} transaction${group.count === 1 ? '' : 's'}`,
          `${share(group.amount, total)} of everything spent`,
          group.amount
        ],
        variant: 'band'
      });
      for (const item of group.items.slice().sort((a, b) => b.amount - a.amount)) {
        grouped.push([
          xl.excelDate(item.date),
          describeExpense(item),
          item.merchant || '—',
          item.amount
        ]);
      }
    }

    xl.writeTable(detail, {
      row,
      columns: [
        { header: 'Date', numFmt: xl.DATE_FORMAT },
        { header: 'What it was for' },
        { header: 'Merchant' },
        { header: 'Amount', align: 'right', numFmt: money }
      ],
      rows: grouped,
      total: ['Total', '', '', total]
    });
  } else {
    xl.writeEmpty(detail, row, 'No expenses recorded in this period.', 4);
  }

  // ---- Merchants -----------------------------------------------------------
  if (byMerchant.length) {
    const merchants = xl.addSheet(workbook, 'Merchants', [34, 18, 12, 16]);
    row = xl.writeTitle(merchants, {
      title: 'Where the money went',
      subtitle: period.subtitle,
      meta: 'Only expenses that have a merchant name on them.',
      span: 4
    });
    xl.writeTable(merchants, {
      row,
      columns: [
        { header: 'Merchant' },
        { header: 'Amount', align: 'right', numFmt: money },
        { header: 'Share', align: 'right', numFmt: xl.PERCENT_FORMAT },
        { header: 'Transactions', align: 'right', numFmt: xl.NUMBER_FORMAT }
      ],
      rows: byMerchant.map((group) => [
        group.key,
        group.amount,
        total ? group.amount / total : 0,
        group.count
      ])
    });
  }

  // ---- Trend ---------------------------------------------------------------
  const trend = buildTrend(rows, period, (item) => item.amount);
  const trendSheet = xl.addSheet(workbook, trend.sheet, [22, 18, 16]);
  row = xl.writeTitle(trendSheet, {
    title: `Spending by ${trend.unit}`,
    subtitle: period.subtitle,
    meta: trend.meta,
    span: 3
  });
  xl.writeTable(trendSheet, {
    row,
    columns: [
      { header: trend.column },
      { header: 'Amount', align: 'right', numFmt: money },
      { header: 'Transactions', align: 'right', numFmt: xl.NUMBER_FORMAT }
    ],
    rows: trend.buckets.map((bucket) => [bucket.label, bucket.value, bucket.count]),
    total: ['Total', total, rows.length]
  });

  // ---- Raw rows ------------------------------------------------------------
  const all = xl.addSheet(workbook, 'All transactions', [14, 20, 42, 26, 16, 14]);
  row = xl.writeTitle(all, {
    title: 'Every transaction',
    subtitle: period.subtitle,
    meta: 'Newest first. Use the filter arrows to slice this however you like.',
    span: 6
  });
  xl.writeTable(all, {
    row,
    columns: [
      { header: 'Date', numFmt: xl.DATE_FORMAT },
      { header: 'Category' },
      { header: 'What it was for' },
      { header: 'Merchant' },
      { header: 'Amount', align: 'right', numFmt: money },
      { header: 'Added via' }
    ],
    rows: rows.map((item) => [
      xl.excelDate(item.date),
      labelise(item.category),
      describeExpense(item),
      item.merchant || '',
      item.amount,
      labelise(item.source)
    ]),
    filter: true
  });

  return {
    filename: filenameFor('Expenses', range, period.label),
    buffer: await workbook.xlsx.writeBuffer()
  };
}

export async function buildHealthReport(user, range) {
  const rows = await fetchRows(Meal, user._id, range);
  const period = describePeriod(range, rows.at(-1)?.date);

  const totals = {
    calories: sum(rows, (item) => item.totals?.calories ?? 0),
    protein: sum(rows, (item) => item.totals?.protein ?? 0),
    carbs: sum(rows, (item) => item.totals?.carbs ?? 0),
    fat: sum(rows, (item) => item.totals?.fat ?? 0)
  };
  const loggedDays = new Set(rows.map((item) => toDateKey(item.date))).size;
  const perDay = (value) => (loggedDays ? value / loggedDays : 0);

  const byMealType = groupBy(
    rows,
    (item) => item.mealType || 'snack',
    (item) => item.totals?.calories ?? 0
  );
  const byFood = groupFoods(rows);

  const workbook = xl.createWorkbook('SaarthiOS nutrition report');

  // ---- Summary -------------------------------------------------------------
  const summary = xl.addSheet(workbook, 'Summary', [30, 18, 14, 16, 16]);
  let row = xl.writeTitle(summary, {
    title: 'Nutrition report',
    subtitle: period.subtitle,
    meta: reportMeta(user),
    span: 5
  });

  row = xl.writeHeading(summary, row, 'Overview', 5);
  row = xl.writeFacts(summary, row, [
    { label: 'Meals logged', value: rows.length, numFmt: xl.NUMBER_FORMAT },
    {
      label: 'Days logged',
      value: loggedDays,
      numFmt: xl.NUMBER_FORMAT,
      hint: `out of ${period.days} day${period.days === 1 ? '' : 's'} in this period`
    },
    {
      label: 'Calories a day',
      value: perDay(totals.calories),
      numFmt: xl.NUMBER_FORMAT,
      hint: user.dailyCalorieGoal ? `goal ${user.dailyCalorieGoal} kcal` : ''
    },
    {
      label: 'Protein a day',
      value: perDay(totals.protein),
      numFmt: xl.DECIMAL_FORMAT,
      hint: user.dailyProteinGoal ? `goal ${user.dailyProteinGoal} g` : 'grams'
    },
    { label: 'Carbs a day', value: perDay(totals.carbs), numFmt: xl.DECIMAL_FORMAT, hint: 'grams' },
    { label: 'Fat a day', value: perDay(totals.fat), numFmt: xl.DECIMAL_FORMAT, hint: 'grams' },
    { label: 'Calories in total', value: totals.calories, numFmt: xl.NUMBER_FORMAT },
    {
      label: 'Biggest meal of the day',
      value: byMealType[0] ? labelise(byMealType[0].key) : '—',
      hint: byMealType[0] ? `${share(byMealType[0].amount, totals.calories)} of all calories` : ''
    }
  ], { span: 5 });

  row = xl.writeHeading(summary, row, 'Calories by meal', 5);
  if (byMealType.length) {
    xl.writeTable(summary, {
      row,
      columns: [
        { header: 'Meal' },
        { header: 'Calories', align: 'right', numFmt: xl.NUMBER_FORMAT },
        { header: 'Share', align: 'right', numFmt: xl.PERCENT_FORMAT },
        { header: 'Times logged', align: 'right', numFmt: xl.NUMBER_FORMAT },
        { header: 'Average', align: 'right', numFmt: xl.NUMBER_FORMAT }
      ],
      rows: byMealType.map((group) => [
        labelise(group.key),
        group.amount,
        totals.calories ? group.amount / totals.calories : 0,
        group.count,
        group.amount / group.count
      ]),
      total: [
        'Total',
        totals.calories,
        totals.calories ? 1 : 0,
        rows.length,
        rows.length ? totals.calories / rows.length : 0
      ],
      freeze: false
    });
  } else {
    xl.writeEmpty(summary, row, 'No meals logged in this period.', 5);
  }

  // ---- Every meal, grouped under its meal type -----------------------------
  const detail = xl.addSheet(workbook, 'By meal', [24, 40, 14, 12, 12, 12]);
  row = xl.writeTitle(detail, {
    title: 'Meals by type',
    subtitle: period.subtitle,
    meta: 'Meal types and the meals inside them run from most calories to least.',
    span: 6
  });

  if (rows.length) {
    const grouped = [];
    for (const group of byMealType) {
      grouped.push({
        cells: [
          labelise(group.key),
          `${group.count} logged · ${share(group.amount, totals.calories)} of all calories`,
          group.amount,
          sum(group.items, (item) => item.totals?.protein ?? 0),
          sum(group.items, (item) => item.totals?.carbs ?? 0),
          sum(group.items, (item) => item.totals?.fat ?? 0)
        ],
        variant: 'band'
      });
      const sorted = group.items
        .slice()
        .sort((a, b) => (b.totals?.calories ?? 0) - (a.totals?.calories ?? 0));
      for (const meal of sorted) {
        grouped.push([
          xl.excelDate(meal.date),
          describeItems(meal),
          meal.totals?.calories ?? 0,
          meal.totals?.protein ?? 0,
          meal.totals?.carbs ?? 0,
          meal.totals?.fat ?? 0
        ]);
      }
    }

    xl.writeTable(detail, {
      row,
      columns: [
        { header: 'Date', numFmt: xl.DATE_FORMAT },
        { header: 'What you ate' },
        { header: 'Calories', align: 'right', numFmt: xl.NUMBER_FORMAT },
        { header: 'Protein (g)', align: 'right', numFmt: xl.DECIMAL_FORMAT },
        { header: 'Carbs (g)', align: 'right', numFmt: xl.DECIMAL_FORMAT },
        { header: 'Fat (g)', align: 'right', numFmt: xl.DECIMAL_FORMAT }
      ],
      rows: grouped,
      total: ['Total', '', totals.calories, totals.protein, totals.carbs, totals.fat]
    });
  } else {
    xl.writeEmpty(detail, row, 'No meals logged in this period.', 6);
  }

  // ---- Foods ---------------------------------------------------------------
  if (byFood.length) {
    const foods = xl.addSheet(workbook, 'Foods', [34, 14, 16, 16, 14]);
    row = xl.writeTitle(foods, {
      title: 'What you ate most',
      subtitle: period.subtitle,
      meta: 'Every food item you logged, from most calories to least.',
      span: 5
    });
    xl.writeTable(foods, {
      row,
      columns: [
        { header: 'Food' },
        { header: 'Times', align: 'right', numFmt: xl.NUMBER_FORMAT },
        { header: 'Calories', align: 'right', numFmt: xl.NUMBER_FORMAT },
        { header: 'Average', align: 'right', numFmt: xl.NUMBER_FORMAT },
        { header: 'Protein (g)', align: 'right', numFmt: xl.DECIMAL_FORMAT }
      ],
      rows: byFood.map((food) => [
        food.name,
        food.count,
        food.calories,
        food.calories / food.count,
        food.protein
      ]),
      filter: true
    });
  }

  // ---- Trend ---------------------------------------------------------------
  const trend = buildTrend(rows, period, (item) => item.totals?.calories ?? 0, {
    protein: (item) => item.totals?.protein ?? 0,
    carbs: (item) => item.totals?.carbs ?? 0,
    fat: (item) => item.totals?.fat ?? 0
  });
  const trendSheet = xl.addSheet(workbook, trend.sheet, [22, 14, 14, 14, 14, 12]);
  row = xl.writeTitle(trendSheet, {
    title: `Nutrition by ${trend.unit}`,
    subtitle: period.subtitle,
    meta: trend.meta,
    span: 6
  });
  xl.writeTable(trendSheet, {
    row,
    columns: [
      { header: trend.column },
      { header: 'Calories', align: 'right', numFmt: xl.NUMBER_FORMAT },
      { header: 'Protein (g)', align: 'right', numFmt: xl.DECIMAL_FORMAT },
      { header: 'Carbs (g)', align: 'right', numFmt: xl.DECIMAL_FORMAT },
      { header: 'Fat (g)', align: 'right', numFmt: xl.DECIMAL_FORMAT },
      { header: 'Meals', align: 'right', numFmt: xl.NUMBER_FORMAT }
    ],
    rows: trend.buckets.map((bucket) => [
      bucket.label,
      bucket.value,
      bucket.extra.protein,
      bucket.extra.carbs,
      bucket.extra.fat,
      bucket.count
    ]),
    total: ['Total', totals.calories, totals.protein, totals.carbs, totals.fat, rows.length]
  });

  // ---- Raw rows ------------------------------------------------------------
  const all = xl.addSheet(workbook, 'All meals', [14, 14, 40, 12, 12, 12, 12, 26, 12]);
  row = xl.writeTitle(all, {
    title: 'Every meal',
    subtitle: period.subtitle,
    meta: 'Newest first. Use the filter arrows to slice this however you like.',
    span: 9
  });
  xl.writeTable(all, {
    row,
    columns: [
      { header: 'Date', numFmt: xl.DATE_FORMAT },
      { header: 'Meal' },
      { header: 'What you ate' },
      { header: 'Calories', align: 'right', numFmt: xl.NUMBER_FORMAT },
      { header: 'Protein (g)', align: 'right', numFmt: xl.DECIMAL_FORMAT },
      { header: 'Carbs (g)', align: 'right', numFmt: xl.DECIMAL_FORMAT },
      { header: 'Fat (g)', align: 'right', numFmt: xl.DECIMAL_FORMAT },
      { header: 'Note' },
      { header: 'Added via' }
    ],
    rows: rows.map((meal) => [
      xl.excelDate(meal.date),
      labelise(meal.mealType),
      describeItems(meal),
      meal.totals?.calories ?? 0,
      meal.totals?.protein ?? 0,
      meal.totals?.carbs ?? 0,
      meal.totals?.fat ?? 0,
      meal.note || '',
      labelise(meal.source)
    ]),
    filter: true
  });

  return {
    filename: filenameFor('Health', range, period.label),
    buffer: await workbook.xlsx.writeBuffer()
  };
}

/* -------------------------------------------------------------------------- */

/** Newest first, with one row of headroom so an oversized window is caught. */
async function fetchRows(Model, userId, range) {
  const { from, to } = resolveRange(range);
  const rows = await Model.find({ user: userId, date: { $gte: from, $lte: to } })
    .sort({ date: -1, createdAt: -1, _id: -1 })
    .limit(MAX_ROWS + 1)
    .lean();

  if (rows.length > MAX_ROWS) {
    throw ApiError.badRequest(
      `That period holds more than ${MAX_ROWS.toLocaleString('en-GB')} entries. Pick a shorter one.`
    );
  }
  return rows;
}

/**
 * `all` starts at the epoch, which would print 1970 on the cover, so the first
 * row that actually exists stands in for the start of the period.
 */
function describePeriod(range, earliest) {
  const { from, to, label } = resolveRange(range);
  const start = from.getTime() === 0 ? new Date(earliest ?? to) : from;
  const end = to > new Date() ? new Date() : to;
  const days = Math.max(1, Math.round((endOfDay(end) - startOfDay(start)) / 86_400_000));

  return {
    label,
    from: start,
    to: end,
    days,
    subtitle: `${sentenceCase(label)}  ·  ${dateText(start)} – ${dateText(end)}`
  };
}

const startOfDay = (d) => new Date(new Date(d).setHours(0, 0, 0, 0));
const endOfDay = (d) => new Date(new Date(d).setHours(23, 59, 59, 999));

const reportMeta = (user) =>
  `Prepared for ${user.name} · Generated ${new Date().toLocaleString('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short'
  })} · SaarthiOS`;

/** Only worth printing next to a window that is actually a calendar month. */
function budgetFacts(user, range, total, { money, symbol }) {
  const monthly = range === 'month' || range === 'last_month' || isMonthRange(range);
  if (!monthly || !user.monthlyBudget) return [];
  return [
    { label: 'Monthly budget', value: user.monthlyBudget, numFmt: money },
    {
      label: 'Budget used',
      value: total / user.monthlyBudget,
      numFmt: xl.PERCENT_FORMAT,
      hint:
        total > user.monthlyBudget
          ? `${symbol}${Math.round(total - user.monthlyBudget).toLocaleString('en-GB')} over budget`
          : `${symbol}${Math.round(user.monthlyBudget - total).toLocaleString('en-GB')} left`
    }
  ];
}

/** Day buckets while the window is short enough to read, months after that. */
function buildTrend(rows, period, value, extras = {}) {
  const daily = period.days <= MAX_DAILY_ROWS;
  const key = daily ? toDateKey : toMonthKey;
  const totals = new Map();

  for (const row of rows) {
    const bucket = totals.get(key(row.date)) ?? { value: 0, count: 0, extra: zeroExtras(extras) };
    bucket.value += value(row);
    bucket.count += 1;
    for (const name of Object.keys(extras)) bucket.extra[name] += extras[name](row);
    totals.set(key(row.date), bucket);
  }

  // Gap-filled so an empty day is visibly a zero rather than a missing line.
  const keys = daily
    ? dayBuckets(period.from, period.to)
    : [...totals.keys()].sort((a, b) => a.localeCompare(b));

  return {
    sheet: daily ? 'Daily totals' : 'Monthly totals',
    column: daily ? 'Date' : 'Month',
    unit: daily ? 'day' : 'month',
    meta: daily
      ? 'Every day in the period, including the ones with nothing on them.'
      : 'Grouped by month because the period is longer than four months.',
    buckets: keys.map((bucketKey) => {
      const bucket = totals.get(bucketKey) ?? { value: 0, count: 0, extra: zeroExtras(extras) };
      return {
        label: daily ? readableDate(bucketKey) : readableMonth(bucketKey),
        value: bucket.value,
        count: bucket.count,
        extra: bucket.extra
      };
    })
  };
}

const zeroExtras = (extras) =>
  Object.fromEntries(Object.keys(extras).map((name) => [name, 0]));

/** `{ key, amount, count, items }` per group, biggest first. */
function groupBy(rows, keyOf, valueOf) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyOf(row);
    const group = groups.get(key) ?? { key, amount: 0, count: 0, items: [] };
    group.amount += valueOf(row);
    group.count += 1;
    group.items.push(row);
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => b.amount - a.amount);
}

function groupFoods(meals) {
  const foods = new Map();
  for (const meal of meals) {
    for (const item of meal.items ?? []) {
      const name = String(item.name ?? '').trim();
      if (!name) continue;
      const food = foods.get(name.toLowerCase()) ?? { name, count: 0, calories: 0, protein: 0 };
      food.count += 1;
      food.calories += item.calories ?? 0;
      food.protein += item.protein ?? 0;
      foods.set(name.toLowerCase(), food);
    }
  }
  return [...foods.values()].sort((a, b) => b.calories - a.calories || b.count - a.count);
}

const describeItems = (meal) =>
  (meal.items ?? [])
    .map((item) => (item.quantity ? `${item.name} (${item.quantity})` : item.name))
    .join(', ');

/**
 * What the money actually went on. The note is the user's own answer to "what
 * was it for?", so it leads; without one the merchant or the category still
 * says more than an empty cell would.
 */
const describeExpense = (item) =>
  item.note?.trim() || item.merchant?.trim() || labelise(item.category);

const sum = (rows, valueOf) => rows.reduce((acc, row) => acc + (valueOf(row) || 0), 0);

const share = (part, whole) => (whole ? `${Math.round((part / whole) * 100)}%` : '0%');

const dateText = (value) =>
  new Date(value).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

const readableDate = (key) => {
  const [year, month, day] = key.split('-').map(Number);
  return dateText(new Date(year, month - 1, day));
};

const readableMonth = (key) => {
  const [year, month] = key.split('-').map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric'
  });
};

const sentenceCase = (text) => String(text).charAt(0).toUpperCase() + String(text).slice(1);

const labelise = (value) =>
  String(value ?? '')
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

/**
 * A month names itself; every other window needs the day it was taken, or two
 * downloads a week apart would overwrite each other.
 */
function filenameFor(prefix, range, label) {
  const stamp = isMonthRange(range) ? label : `${label} ${toDateKey(new Date())}`;
  const slug = stamp.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '');
  return `${prefix}-${slug || 'report'}.xlsx`;
}
