import assert from 'node:assert/strict';
import { afterEach, beforeEach, mock, test } from 'node:test';
import {
  User,
  Expense,
  Meal,
  Investment,
  Subscription,
  CustomEntry,
  AgentRun,
  CustomAgent
} from '../models/index.js';

process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/saarthios-test';
process.env.JWT_SECRET = 'test-secret-not-used-in-production';
const { getAdminOverview } = await import('./adminService.js');

const ago = (hours) => new Date(Date.now() - hours * 3_600_000);
const DAY = 24;

// Returned newest signup first, as the real query sorts them.
const users = [
  { _id: 'dan', name: 'Dan', email: 'dan@example.test', createdAt: ago(1 * DAY) },
  { _id: 'bob', name: 'Bob', email: 'bob@example.test', createdAt: ago(2 * DAY), googleId: 'g' },
  { _id: 'frank', name: 'Frank', email: 'frank@example.test', createdAt: ago(5 * DAY) },
  { _id: 'cara', name: 'Cara', email: 'cara@example.test', createdAt: ago(10 * DAY) },
  { _id: 'alice', name: 'Alice', email: 'alice@example.test', createdAt: ago(40 * DAY) },
  { _id: 'erin', name: 'Erin', email: 'erin@example.test', createdAt: ago(60 * DAY) }
];

/** `countAndLatest` groups by user first; the per-day and failure pipelines start with a match. */
function stubAggregate(model, perUser, { failures = [] } = {}) {
  mock.method(model, 'aggregate', async (pipeline) => {
    if (pipeline[0].$group) return perUser;
    return pipeline[0].$match.status ? failures : [];
  });
}

beforeEach(() => {
  mock.method(User, 'find', () => ({ select: () => ({ sort: () => ({ lean: async () => users }) }) }));
  stubAggregate(User, []);
  stubAggregate(Expense, [{ _id: 'alice', count: 1, last: ago(1 * DAY) }]);
  stubAggregate(Meal, []);
  stubAggregate(Investment, []);
  stubAggregate(Subscription, [{ _id: 'erin', count: 1, last: ago(45 * DAY) }]);
  stubAggregate(CustomEntry, [{ _id: 'frank', count: 1, last: ago(2 * DAY) }]);
  stubAggregate(CustomAgent, [{ _id: 'frank', count: 1, last: ago(3 * DAY) }]);
  stubAggregate(AgentRun, [{ _id: 'bob', count: 4, last: ago(3) }], {
    failures: [{ _id: 'Timed out', count: 2, last: ago(5) }]
  });
  mock.method(AgentRun, 'countDocuments', async (filter) => (filter.status ? 10 : 40));
});

afterEach(() => mock.restoreAll());

const names = (overview) => overview.people.map((person) => person.name);

test('lists the most recently active people first and never-used accounts last', async () => {
  const overview = await getAdminOverview({ days: 30, limit: 10 });
  assert.deepEqual(names(overview), ['Bob', 'Alice', 'Frank', 'Erin', 'Dan', 'Cara']);

  const paged = await getAdminOverview({ days: 30, limit: 4 });
  assert.deepEqual(names(paged), ['Bob', 'Alice', 'Frank', 'Erin']);
  assert.deepEqual(paged.page, { limit: 4, offset: 0, total: 6, hasMore: true });
});

test('can still list the newest signups first', async () => {
  const overview = await getAdminOverview({ days: 30, limit: 10, sort: 'joined' });
  assert.deepEqual(names(overview), ['Dan', 'Bob', 'Frank', 'Cara', 'Alice', 'Erin']);
});

test('counts subscriptions and custom agent entries as activity', async () => {
  const { people, totals } = await getAdminOverview({ days: 30, limit: 10 });
  const frank = people.find((person) => person.name === 'Frank');
  const erin = people.find((person) => person.name === 'Erin');
  assert.equal(frank.records, 1);
  assert.equal(frank.entries, 1);
  assert.ok(frank.lastActiveAt);
  assert.equal(erin.records, 1);
  assert.equal(erin.subscriptions, 1);
  assert.equal(totals.subscriptions, 1);
  assert.equal(totals.entries, 1);
});

test('headline counts follow the chosen window', async () => {
  const month = await getAdminOverview({ days: 30, limit: 10 });
  assert.deepEqual(month.users, { total: 6, newInWindow: 4, activeInWindow: 3, neverUsed: 2 });

  const quarter = await getAdminOverview({ days: 90, limit: 10 });
  assert.deepEqual(quarter.users, { total: 6, newInWindow: 6, activeInWindow: 4, neverUsed: 2 });
});

test('the failure rate counts every failed message, not just the listed reasons', async () => {
  const { ai } = await getAdminOverview({ days: 30, limit: 10 });
  assert.equal(ai.failed, 10);
  assert.equal(ai.runs, 40);
  assert.equal(ai.failureRate, 25);
  assert.deepEqual(
    ai.recentFailures.map(({ reason, count }) => ({ reason, count })),
    [{ reason: 'Timed out', count: 2 }]
  );
});
