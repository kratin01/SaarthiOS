import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addMonths, resolveRange, toDateKey } from './dates.js';
import { nextChargeOn } from '../services/subscriptionService.js';

test('a month back from the 31st lands in the previous month, not the current one', () => {
  const october31 = new Date(2026, 9, 31, 10);
  assert.equal(toDateKey(addMonths(october31, -1)), '2026-09-30');

  const lastMonth = resolveRange('last_month', october31);
  assert.equal(toDateKey(lastMonth.from), '2026-09-01');
  assert.equal(toDateKey(lastMonth.to), '2026-09-30');

  assert.equal(toDateKey(addMonths(new Date(2026, 0, 31), 1)), '2026-02-28');
  assert.equal(toDateKey(addMonths(new Date(2024, 0, 31), 1)), '2024-02-29');
  assert.equal(toDateKey(addMonths(new Date(2026, 4, 15), -1)), '2026-04-15');
  assert.equal(toDateKey(addMonths(new Date(2026, 11, 31), 2)), '2027-02-28');
});

test('a plan started on the 31st renews at the end of a shorter month', () => {
  const plan = { startedOn: new Date(2026, 0, 31), cycle: 'monthly', endedOn: null };
  assert.equal(toDateKey(nextChargeOn(plan, new Date(2026, 1, 10))), '2026-02-28');
});
