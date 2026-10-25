import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';

process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/saarthios-test';
process.env.JWT_SECRET = 'test-secret-not-used-in-production';
process.env.LLM_PROVIDER = 'gemini';
process.env.LLM_API_KEY = 'test-key';
process.env.LLM_MODEL = 'test-model';
process.env.LLM_BASE_URL = 'https://example.test/v1beta';

const { Expense } = await import('../models/Expense.js');
const { AgentRun } = await import('../models/AgentRun.js');
const { questionSchema } = await import('./schemas.js');
const { resolveQuestion } = await import('./queryContext.js');
const { collectFacts } = await import('./facts.js');
const { describeExpenses } = await import('./orchestrator.js');
const { buildPlannerPrompt } = await import('./prompts.js');

const userId = '000000000000000000000001';

afterEach(() => mock.restoreAll());

test('keyword questions search the whole history and follow-ups keep the words', async () => {
  const question = questionSchema.parse({
    domains: ['expense'], keywords: ['Amazon', ' AMZN ', 'amazon', 'a'], sort: 'biggest'
  });
  assert.deepEqual(question.keywords, ['amazon', 'amzn']);
  assert.equal(question.sort, null);
  assert.deepEqual(questionSchema.parse({ keywords: [7] }).keywords, []);

  const resolved = resolveQuestion(question, [], 'what did I get from amazone?');
  assert.equal(resolved.range, 'all');
  assert.deepEqual(resolved.keywords, ['amazon', 'amzn']);
  assert.equal(resolved.sort, 'recent');

  const history = [{ intent: 'query', queryContext: resolved }];
  const total = resolveQuestion(questionSchema.parse({ continuation: true }), history, 'and in total?');
  assert.deepEqual(total.keywords, ['amazon', 'amzn']);
  assert.equal(total.range, 'all');

  const cleared = resolveQuestion(
    questionSchema.parse({ continuation: true, clearKeywords: true, range: 'month' }),
    history,
    'show everything this month'
  );
  assert.deepEqual(cleared.keywords, []);
  assert.equal(cleared.range, 'month');

  const biggest = resolveQuestion(
    questionSchema.parse({ domains: ['expense'], keywords: ['blinkit'], range: 'month', sort: 'largest' }),
    [],
    'biggest blinkit orders this month'
  );
  assert.equal(biggest.range, 'month');
  assert.equal(biggest.sort, 'largest');

  const run = new AgentRun({
    user: userId, conversation: '000000000000000000000002', message: 'amazon', queryContext: resolved
  });
  await run.validate();
  assert.deepEqual(run.toObject().queryContext.keywords, ['amazon', 'amzn']);
});

test('searches match merchant, note and category literally and can sort by amount', async () => {
  let match;
  let listFilter;
  let order;
  mock.method(Expense, 'aggregate', async (pipeline) => {
    match = pipeline[0].$match;
    return [{ total: [{ amount: 2400, count: 2 }], byCategory: [], byDay: [], topMerchants: [] }];
  });
  mock.method(Expense, 'countDocuments', async () => 2);
  mock.method(Expense, 'find', (filter) => {
    listFilter = filter;
    const query = {
      sort: (value) => { order = value; return query; },
      skip: () => query,
      limit: () => query,
      lean: async () => [{ date: new Date(2026, 9, 3), category: 'shopping', merchant: 'Amazon', amount: 1500, note: 'Earbuds' }]
    };
    return query;
  });

  const { expenses } = await collectFacts({
    userId, domains: ['expense'], range: 'all', keywords: ['amazon', 'c++'], sort: 'largest'
  });

  assert.equal(match.$or.length, 6);
  assert.deepEqual(listFilter.$or, match.$or);
  const merchant = match.$or.find((condition) => condition.merchant)?.merchant;
  assert.ok(merchant.test('Amazon India'));
  const literal = match.$or.find((condition) => condition.note?.source === 'c\\+\\+');
  assert.ok(literal.note.test('c++ book') && !literal.note.test('cc book'));
  assert.deepEqual(order, { amount: -1, date: -1, _id: -1 });
  assert.deepEqual(expenses.keywords, ['amazon', 'c++']);
  assert.equal(expenses.order, 'largest first');
  assert.equal(expenses.total, 2400);
  assert.equal(expenses.items[0].merchant, 'Amazon');
});

test('saved expenses are read back with what, where and category', () => {
  assert.equal(
    describeExpenses([{ amount: 936, note: 'Minoxidil', merchant: 'Blinkit', category: 'health' }], 'INR'),
    'Saved INR 936 for Minoxidil from Blinkit under health.'
  );
  assert.equal(
    describeExpenses([{ amount: 450, note: '', merchant: 'Swiggy', category: 'food' }], 'INR'),
    'Saved INR 450 at Swiggy under food.'
  );

  const outing = [
    { amount: 500, note: 'Dinner with friends', merchant: 'Phoenix MarketCity', category: 'friends outing' },
    { amount: 170, note: 'lunch', merchant: '', category: 'friends outing' },
    { amount: 30, note: 'Metro, Phoenix MarketCity to home', merchant: '', category: 'friends outing' }
  ];
  assert.equal(describeExpenses(outing, 'INR'), [
    'Saved 3 expenses under friends outing, INR 700 in total:',
    '- Dinner with friends (Phoenix MarketCity): INR 500',
    '- Lunch: INR 170',
    '- Metro, Phoenix MarketCity to home: INR 30'
  ].join('\n'));

  const mixed = describeExpenses([
    { amount: 120, note: 'Coffee', merchant: '', category: 'food' },
    { amount: 90, note: 'Auto', merchant: '', category: 'transport' }
  ], 'INR');
  assert.match(mixed, /^Saved 2 expenses, INR 210 in total:\n- Coffee: INR 120, food\n- Auto: INR 90, transport$/);
});

test('the planner is told how to search and how to describe what it records', () => {
  const prompt = buildPlannerPrompt({ today: '2026-10-25', currency: 'INR' });
  assert.match(prompt, /"keywords": string\[\]/);
  assert.match(prompt, /A shop name is never a "category"/);
  assert.match(prompt, /One row per amount/);
});
