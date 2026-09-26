/**
 * Recurring services: Netflix, Spotify, the gym, the domain you forgot about.
 *
 * Unlike expenses, nothing here is logged per payment. A subscription is
 * recorded once and every number is derived from `startedOn` + `cycle`, which
 * is the only way a tracker like this survives contact with real life.
 */
import { Subscription } from '../models/Subscription.js';
import { ApiError } from '../utils/ApiError.js';
import { CYCLE_MONTHS } from '../config/constants.js';
import { addMonths, startOfDay, startOfMonth, toDateKey } from '../utils/dates.js';
import * as expenseService from './expenseService.js';

const DAY = 86_400_000;

/** Charges land on the same day each cycle, so the first one is on day zero. */
export function chargesBetween(startedOn, until, cycle) {
  const start = startOfDay(startedOn);
  const end = startOfDay(until);
  if (end < start) return 0;

  if (cycle === 'weekly') return Math.floor((end - start) / (7 * DAY)) + 1;

  const everyMonths = CYCLE_MONTHS[cycle] ?? 1;
  let months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
  // The day of the month has not come round yet, so that charge has not happened.
  if (end.getDate() < start.getDate()) months -= 1;

  return Math.max(0, Math.floor(months / everyMonths) + 1);
}

/** The date the next payment falls on, or null once it has been cancelled. */
export function nextChargeOn(subscription, now = new Date()) {
  if (subscription.endedOn) return null;
  const taken = chargesBetween(subscription.startedOn, now, subscription.cycle);
  const start = startOfDay(subscription.startedOn);

  if (subscription.cycle === 'weekly') return new Date(start.getTime() + taken * 7 * DAY);
  return addMonths(start, taken * (CYCLE_MONTHS[subscription.cycle] ?? 1));
}

/** What one charge works out to per month, so two cycles can be compared. */
export const monthlyCost = (subscription) =>
  subscription.amount / (CYCLE_MONTHS[subscription.cycle] ?? 1);

/** Everything derived about one subscription, in the shape the UI wants. */
export function describe(subscription, now = new Date()) {
  const active = !subscription.endedOn;
  const until = active ? now : subscription.endedOn;
  const charges = chargesBetween(subscription.startedOn, until, subscription.cycle);

  return {
    ...subscription,
    active,
    charges,
    paidToDate: charges * subscription.amount,
    monthly: monthlyCost(subscription),
    yearly: monthlyCost(subscription) * 12,
    nextChargeOn: nextChargeOn(subscription, now)
  };
}

export async function createSubscription(userId, input, { source = 'manual', agentRun = null } = {}) {
  const name = String(input.name ?? '').trim();
  if (!name) throw ApiError.badRequest('Give the subscription a name');

  // Saying "I pay for Netflix" twice should correct the price, not add a twin.
  const existing = await Subscription.findOne({
    user: userId,
    endedOn: null,
    name
  }).collation({ locale: 'en', strength: 2 });

  if (existing) {
    existing.amount = input.amount;
    existing.cycle = input.cycle ?? existing.cycle;
    // `other` is what both the form and the model fall back to when they do not
    // know, so treating it as an answer would wipe a category already on file.
    if (input.category && input.category !== 'other') existing.category = input.category;
    if (input.note) existing.note = input.note;
    if (input.startedOn) existing.startedOn = input.startedOn;
    await existing.save();
    return existing;
  }

  return Subscription.create({
    user: userId,
    name,
    amount: input.amount,
    cycle: input.cycle ?? 'monthly',
    category: input.category ?? 'other',
    startedOn: input.startedOn ?? new Date(),
    note: input.note ?? '',
    source,
    agentRun
  });
}

export function createSubscriptions(userId, inputs, options) {
  return Promise.all(inputs.map((input) => createSubscription(userId, input, options)));
}

/**
 * Active first, then the dearest. A cancelled subscription never outranks one
 * still taking money.
 */
export async function listSubscriptions(userId, { status = 'all', limit = 50, offset = 0 } = {}) {
  const filter = { user: userId };
  if (status === 'active') filter.endedOn = null;
  if (status === 'cancelled') filter.endedOn = { $ne: null };

  const [rows, total] = await Promise.all([
    Subscription.find(filter).sort({ endedOn: 1, startedOn: -1, _id: -1 }).skip(offset).limit(limit).lean(),
    Subscription.countDocuments(filter)
  ]);

  const now = new Date();
  const items = rows
    .map((row) => describe(row, now))
    .sort((a, b) => Number(b.active) - Number(a.active) || b.monthly - a.monthly);

  return { items, total };
}

export async function updateSubscription(userId, id, input) {
  const changes = Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined)
  );
  const updated = await Subscription.findOneAndUpdate(
    { _id: id, user: userId },
    { $set: changes },
    { new: true, runValidators: true }
  );
  if (!updated) throw ApiError.notFound('Subscription not found');
  return updated;
}

export async function deleteSubscription(userId, id) {
  const deleted = await Subscription.findOneAndDelete({ _id: id, user: userId });
  if (!deleted) throw ApiError.notFound('Subscription not found');
  return deleted;
}

/**
 * The whole picture: what it costs a month, what it has cost so far, and what
 * share of real spending it quietly takes up.
 */
export async function summariseSubscriptions(userId, now = new Date()) {
  const rows = await Subscription.find({ user: userId }).lean();
  const all = rows.map((row) => describe(row, now));
  const active = all.filter((row) => row.active);

  const monthly = sum(active, (row) => row.monthly);
  const paidToDate = sum(all, (row) => row.paidToDate);

  const byCategory = [...group(active, (row) => row.category).values()]
    .map((entries) => ({
      category: entries[0].category,
      monthly: sum(entries, (row) => row.monthly),
      count: entries.length
    }))
    .sort((a, b) => b.monthly - a.monthly);

  const upcoming = active
    .filter((row) => row.nextChargeOn)
    .sort((a, b) => a.nextChargeOn - b.nextChargeOn)
    .slice(0, 6)
    .map((row) => ({
      _id: String(row._id),
      name: row.name,
      amount: row.amount,
      cycle: row.cycle,
      on: toDateKey(row.nextChargeOn),
      inDays: Math.max(0, Math.round((startOfDay(row.nextChargeOn) - startOfDay(now)) / DAY))
    }));

  return {
    monthly,
    yearly: monthly * 12,
    daily: (monthly * 12) / 365,
    paidToDate,
    activeCount: active.length,
    cancelledCount: all.length - active.length,
    /** Longest-running first — the ones worth questioning. */
    longestRunning: [...active]
      .sort((a, b) => b.paidToDate - a.paidToDate)
      .slice(0, 5)
      .map((row) => ({
        _id: String(row._id),
        name: row.name,
        paidToDate: row.paidToDate,
        charges: row.charges,
        since: toDateKey(row.startedOn)
      })),
    byCategory,
    upcoming,
    /** Charges due in the next 30 days, which is the number that stings. */
    dueThisMonth: sum(
      active.filter((row) => row.nextChargeOn && row.nextChargeOn - now <= 30 * DAY),
      (row) => row.amount
    ),
    shareOfSpending: await shareOfSpending(userId, monthly, now)
  };
}

/**
 * Subscriptions as a percentage of what actually left the account last month.
 *
 * This is the number that changes behaviour: "₹2,400 a month" means nothing
 * until it is "18% of everything you spent".
 */
async function shareOfSpending(userId, monthly, now) {
  if (!monthly) return null;

  const from = startOfMonth(addMonths(now, -1));
  const to = new Date(startOfMonth(now).getTime() - 1);
  const spent = await expenseService.totalBetween(userId, from, to);
  if (!spent) return null;

  return { spent, month: toDateKey(from).slice(0, 7), percent: Math.round((monthly / spent) * 100) };
}

const sum = (rows, valueOf) => rows.reduce((acc, row) => acc + (valueOf(row) || 0), 0);

function group(rows, keyOf) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyOf(row);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return groups;
}
