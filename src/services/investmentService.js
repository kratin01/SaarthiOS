/** All investment reads and writes. */
import { Investment } from '../models/Investment.js';
import { ApiError } from '../utils/ApiError.js';
import { toObjectId } from '../utils/ids.js';
import { resolveRange } from '../utils/dates.js';
import { QUANTITY_TYPES } from '../config/constants.js';
import { getQuotes, resolveSymbol, isValidSymbol } from './marketService.js';

export function createInvestment(userId, input, { source = 'manual', agentRun = null } = {}) {
  return Investment.create({
    user: userId,
    amount: input.amount,
    type: input.type ?? 'other',
    instrument: input.instrument ?? '',
    quantity: input.quantity ?? null,
    symbol: input.symbol ?? '',
    note: input.note ?? '',
    date: input.date ?? new Date(),
    source,
    agentRun
  });
}

export function createInvestments(userId, inputs, options) {
  return Promise.all(inputs.map((input) => createInvestment(userId, input, options)));
}

export async function listInvestments(userId, { range = 'year', type, limit = 50, offset = 0 } = {}) {
  const { from, to } = resolveRange(range);
  const filter = { user: userId, date: { $gte: from, $lte: to } };
  if (type) filter.type = type;

  const [items, total] = await Promise.all([
    Investment.find(filter).sort({ date: -1, createdAt: -1, _id: -1 }).skip(offset).limit(limit).lean(),
    Investment.countDocuments(filter)
  ]);

  return { items, total };
}

export async function deleteInvestment(userId, id) {
  const deleted = await Investment.findOneAndDelete({ _id: id, user: userId });
  if (!deleted) throw ApiError.notFound('Investment not found');
  return deleted;
}

export async function updateInvestment(userId, id, input) {
  const changes = Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined)
  );
  const updated = await Investment.findOneAndUpdate(
    { _id: id, user: userId },
    { $set: changes },
    { new: true, runValidators: true }
  );
  if (!updated) throw ApiError.notFound('Investment not found');
  return updated;
}

/**
 * What the holdings that have a unit count are worth right now.
 *
 * Only rows with a quantity can be valued — without one there is no way to know
 * how many units a rupee amount bought. Rows whose price cannot be fetched come
 * back with `quote: null` and are left out of the totals rather than guessed at.
 */
export async function valueHoldings(userId, { range = 'all', currency = 'INR' } = {}) {
  const { from, to, label } = resolveRange(range);

  const rows = await Investment.find({
    user: userId,
    type: { $in: QUANTITY_TYPES },
    quantity: { $gt: 0 },
    date: { $gte: from, $lte: to }
  })
    .sort({ date: -1 })
    .lean();

  if (rows.length === 0) {
    return { range: label, holdings: [], totals: emptyTotals(currency), checkedAt: new Date().toISOString() };
  }

  // Anything missing a ticker gets one looked up from its name, then saved so
  // the lookup only ever happens once per holding.
  await Promise.all(
    rows.map(async (row) => {
      if (isValidSymbol(row.symbol)) return;
      const found = await resolveSymbol(row.instrument, { preferCurrency: currency });
      if (!found) return;
      row.symbol = found;
      await Investment.updateOne({ _id: row._id, user: userId }, { $set: { symbol: found } });
    })
  );

  const quotes = await getQuotes(rows.map((r) => r.symbol));

  const holdings = rows.map((row) => {
    const quote = quotes.get((row.symbol ?? '').toUpperCase()) ?? null;
    const buyPrice = row.amount / row.quantity;

    if (!quote) {
      return {
        _id: String(row._id),
        instrument: row.instrument,
        symbol: row.symbol ?? '',
        quantity: row.quantity,
        invested: round(row.amount),
        buyPrice: round(buyPrice),
        date: row.date,
        quote: null
      };
    }

    const value = quote.price * row.quantity;
    const change = value - row.amount;

    return {
      _id: String(row._id),
      instrument: row.instrument,
      symbol: quote.symbol,
      quantity: row.quantity,
      invested: round(row.amount),
      buyPrice: round(buyPrice),
      date: row.date,
      quote: {
        price: round(quote.price),
        currency: quote.currency,
        exchange: quote.exchange,
        value: round(value),
        change: round(change),
        changePercent: row.amount ? round((change / row.amount) * 100) : 0,
        at: quote.at
      }
    };
  });

  // Only same-currency holdings are summed. Adding a USD gain to an INR one
  // would produce a confident number that means nothing.
  const priced = holdings.filter((h) => h.quote);
  const summable = priced.filter((h) => !h.quote.currency || h.quote.currency === currency);

  const invested = summable.reduce((sum, h) => sum + h.invested, 0);
  const value = summable.reduce((sum, h) => sum + h.quote.value, 0);

  return {
    range: label,
    holdings,
    totals: {
      currency,
      counted: summable.length,
      unpriced: holdings.length - priced.length,
      otherCurrency: priced.length - summable.length,
      invested: round(invested),
      value: round(value),
      change: round(value - invested),
      changePercent: invested ? round(((value - invested) / invested) * 100) : 0
    },
    checkedAt: new Date().toISOString()
  };
}

const emptyTotals = (currency) => ({
  currency,
  counted: 0,
  unpriced: 0,
  otherCurrency: 0,
  invested: 0,
  value: 0,
  change: 0,
  changePercent: 0
});

const round = (n) => Math.round(n * 100) / 100;

/** Contributed total, allocation by type and a month-by-month series. */
export async function summariseInvestments(userId, range = 'year') {
  const { from, to, label } = resolveRange(range);

  const [rows] = await Investment.aggregate([
    { $match: { user: toObjectId(userId), date: { $gte: from, $lte: to } } },
    {
      $facet: {
        total: [{ $group: { _id: null, amount: { $sum: '$amount' }, count: { $sum: 1 } } }],
        byType: [
          { $group: { _id: '$type', amount: { $sum: '$amount' }, count: { $sum: 1 } } },
          { $sort: { amount: -1 } }
        ],
        byMonth: [
          {
            $group: {
              _id: { $dateToString: { format: '%Y-%m', date: '$date' } },
              amount: { $sum: '$amount' }
            }
          },
          { $sort: { _id: 1 } }
        ],
        topInstruments: [
          { $match: { instrument: { $ne: '' } } },
          { $group: { _id: '$instrument', amount: { $sum: '$amount' } } },
          { $sort: { amount: -1 } },
          { $limit: 5 }
        ]
      }
    }
  ]);

  return {
    range: label,
    from,
    to,
    total: rows.total?.[0]?.amount ?? 0,
    count: rows.total?.[0]?.count ?? 0,
    byType: (rows.byType ?? []).map((t) => ({ type: t._id, amount: t.amount, count: t.count })),
    byMonth: (rows.byMonth ?? []).map((m) => ({ month: m._id, amount: m.amount })),
    topInstruments: (rows.topInstruments ?? []).map((i) => ({
      instrument: i._id,
      amount: i.amount
    }))
  };
}

export async function totalBetween(userId, from, to) {
  const [row] = await Investment.aggregate([
    { $match: { user: toObjectId(userId), date: { $gte: from, $lte: to } } },
    { $group: { _id: null, amount: { $sum: '$amount' } } }
  ]);
  return row?.amount ?? 0;
}
