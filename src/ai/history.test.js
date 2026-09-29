import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import { Expense } from '../models/Expense.js';
import { resolveQuestion } from './queryContext.js';
import { questionSchema } from './schemas.js';
import { buildConversationContext } from './prompts.js';
import { AgentRun } from '../models/AgentRun.js';
import { Meal } from '../models/Meal.js';
import { AiSetting } from '../models/AiSetting.js';
import { GlobalAiSetting } from '../models/GlobalAiSetting.js';
import { CustomAgent } from '../models/CustomAgent.js';
import { Conversation } from '../models/Conversation.js';

process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/saarthios-test';
process.env.JWT_SECRET = 'test-secret-not-used-in-production';
process.env.LLM_PROVIDER = 'gemini';
process.env.LLM_API_KEY = 'test-key';
process.env.LLM_MODEL = 'test-model';
process.env.LLM_BASE_URL = 'https://example.test/v1beta';
const { collectFacts } = await import('./facts.js');
const { analystAgent } = await import('./agents/analystAgent.js');
const { handleMessage } = await import('./orchestrator.js');

const userId = '000000000000000000000001';

afterEach(() => mock.restoreAll());

const expenseHistory = [{
  _id: '000000000000000000000010',
  intent: 'query',
  message: 'give me my last week spending in category others',
  reply: 'You spent INR 378 in other.',
  queryContext: {
    domains: ['expense'], range: 'week', category: 'other', scope: 'period',
    text: 'Show my spending in other over the last week.'
  }
}];

test('a period-only follow-up keeps the category through schema parsing', () => {
  const question = questionSchema.parse({ continuation: true, range: 'month' });
  const resolved = resolveQuestion(question, expenseHistory, 'for the month');
  assert.deepEqual(resolved.domains, ['expense']);
  assert.equal(resolved.range, 'month');
  assert.equal(resolved.category, 'other');
});

test('category changes keep the period; all categories explicitly clears the filter', () => {
  const monthly = resolveQuestion({ continuation: true, range: 'month' }, expenseHistory, 'for the month');
  const history = [...expenseHistory, { intent: 'query', queryContext: monthly }];
  assert.equal(resolveQuestion({ continuation: true, category: 'transport' }, history, 'and transport?').range, 'month');
  assert.equal(resolveQuestion({ continuation: true, category: 'transport' }, history, 'and transport?').category, 'transport');
  assert.equal(resolveQuestion({ continuation: true, clearCategory: true }, history, 'all categories').category, null);
  assert.equal(resolveQuestion({ domains: ['health'], continuation: true }, history, 'what about protein?').category, null);
  assert.equal(resolveQuestion({ domains: ['expense'], range: 'all' }, history, 'total spending ever').category, null);
});

test('a meal breakdown anchors to a saved turn and later metrics keep that anchor', () => {
  const mealId = '000000000000000000000020';
  const history = [...expenseHistory, { _id: mealId, intent: 'record', created: { meals: 1 } }];
  const question = questionSchema.parse({ domains: ['health'], continuation: true, scope: 'last_meal', referenceTurn: 2 });
  const resolved = resolveQuestion(question, history, 'give me breakdown of protine');
  assert.equal(resolved.mealRunId, mealId);
  assert.equal(resolved.scope, 'last_meal');
  assert.equal(resolved.category, null);
  history.push({ intent: 'query', queryContext: resolved });
  assert.equal(resolveQuestion({ continuation: true }, history, 'and carbs?').mealRunId, mealId);
  const monthly = resolveQuestion({ continuation: true, range: 'month' }, history, 'protein this month');
  assert.equal(monthly.mealRunId, null);
  assert.equal(monthly.scope, 'period');
});

test('missing or invalid meal references never silently broaden the query', () => {
  const missing = resolveQuestion({ scope: 'last_meal', referenceTurn: 999 }, expenseHistory, 'that meal');
  assert.equal(missing.scope, 'last_meal');
  assert.equal(missing.mealRunId, null);
  const fresh = resolveQuestion({ continuation: true, scope: 'last_meal' }, [], 'protein breakdown');
  assert.equal(fresh.mealRunId, null);
});

test('legacy history remains usable and others aliases to the stored other category', () => {
  const legacy = [{ message: 'others last week', reply: '378', intent: 'query' }];
  const question = resolveQuestion({ continuation: true, category: 'others', range: 'month' }, legacy, 'for the month');
  assert.equal(question.category, 'other');
  assert.equal(resolveQuestion({ category: 'others' }, [], '', ['others']).category, 'others');
  assert.match(buildConversationContext(legacy), /others last week/);
  assert.match(buildConversationContext(expenseHistory), /"category":"other"/);
});

test('resolved scope survives persistence on an AgentRun without a migration', async () => {
  const run = new AgentRun({
    user: userId, conversation: '000000000000000000000002', message: 'for the month',
    queryContext: resolveQuestion({ continuation: true, range: 'month' }, expenseHistory, 'for the month')
  });
  await run.validate();
  assert.equal(run.toObject().queryContext.category, 'other');
  assert.equal(run.toObject().queryContext.range, 'month');
  assert.equal(new AgentRun().queryContext, null);
});

test('a meal breakdown reads only the referenced run and keeps all saved food values', async () => {
  const mealRunId = '000000000000000000000020';
  const foodItems = [
    { name: 'roti', quantity: '3', protein: 9.5 },
    { name: 'aloo bhindi', quantity: '1 katori', protein: 2 },
    { name: 'soyabean', quantity: '15 g', protein: 7 },
    { name: 'mix veg rice', quantity: '70 g', protein: 2.5 },
    { name: 'dahi', quantity: '1 katori', protein: 6 }
  ];
  mock.method(Meal, 'find', (filter) => {
    assert.equal(String(filter.user), userId);
    assert.equal(String(filter.agentRun), mealRunId);
    assert.equal(filter.date, undefined);
    return { sort: () => ({ lean: async () => [{
      date: new Date(2026, 8, 29), mealType: 'lunch', items: foodItems,
      totals: { protein: 27, calories: 660, carbs: 100, fat: 12 }
    }] }) };
  });
  mock.method(Meal, 'aggregate', () => assert.fail('A meal reference must not fetch monthly totals'));
  const { nutrition } = await collectFacts({
    userId, domains: ['health'], scope: 'last_meal', range: 'month', mealRunId
  });
  assert.equal(nutrition.mealsLogged, 1);
  assert.equal(nutrition.totals.protein, 27);
  assert.equal(nutrition.items[0].foodItems.length, 5);
  assert.equal(nutrition.items[0].foodItems[4].name, 'dahi');
  assert.equal(nutrition.items[0].foodItems[0].protein, 9.5);
  assert.equal(nutrition.itemsTotal, 1);
});

test('a missing or deleted referenced meal asks for clarification, not monthly data', async () => {
  mock.method(Meal, 'find', () => ({ sort: () => ({ lean: async () => [] }) }));
  mock.method(Meal, 'aggregate', () => assert.fail('No fallback to other meals'));
  for (const mealRunId of [null, '000000000000000000000020']) {
    const result = await analystAgent.run({
      user: { _id: userId },
      question: { domains: ['health'], scope: 'last_meal', mealRunId },
      message: 'give me breakdown of protine'
    });
    assert.match(result.reply, /Which meal/);
    assert.equal(result.facts.nutrition.itemsTotal, 0);
  }
});

test('category facts filter totals and rows before pagination', async () => {
  const items = Array.from({ length: 40 }, () => ({
    date: new Date(2026, 8, 10), category: 'other', amount: 10, note: 'Haircut'
  }));
  const checkFilter = (filter) => {
    assert.equal(String(filter.user), userId);
    assert.equal(filter.category, 'other');
    assert.equal(filter.date.$gte.getMonth(), 8);
    assert.equal(filter.date.$lte.getMonth(), 8);
  };
  mock.method(Expense, 'aggregate', async (pipeline) => {
    checkFilter(pipeline[0].$match);
    return [{
      total: [{ amount: 450, count: 45 }],
      byCategory: [{ _id: 'other', amount: 450, count: 45 }],
      byDay: [], topMerchants: []
    }];
  });
  mock.method(Expense, 'countDocuments', async (filter) => {
    checkFilter(filter);
    return 45;
  });
  mock.method(Expense, 'find', (filter) => {
    checkFilter(filter);
    const query = {
      sort: () => query,
      skip: () => query,
      limit: (limit) => {
        assert.equal(limit, 40);
        return query;
      },
      lean: async () => items
    };
    return query;
  });

  const { expenses } = await collectFacts({
    userId, domains: ['expense'], range: '2026-09', category: 'other'
  });
  assert.equal(expenses.category, 'other');
  assert.equal(expenses.total, 450);
  assert.equal(expenses.transactions, 45);
  assert.equal(expenses.itemsShown, 40);
  assert.equal(expenses.itemsTotal, 45);
  assert.ok(expenses.items.every((item) => item.category === 'other'));
});

test('successive chat queries persist and reuse scope without writing records', async () => {
  const conversationId = '000000000000000000000002';
  const history = [...expenseHistory];
  let expectedCategory = 'other';
  let plannerQuestion = { continuation: true, range: 'month' };
  mock.method(AiSetting, 'findOne', () => ({ lean: async () => null }));
  mock.method(GlobalAiSetting, 'findOne', () => ({ lean: async () => null }));
  mock.method(CustomAgent, 'find', () => ({ sort: () => ({ lean: async () => [] }) }));
  mock.method(AgentRun, 'find', (filter) => {
    assert.deepEqual(filter, { user: userId, conversation: conversationId, status: 'completed' });
    const query = {
      sort: (order) => { assert.equal(order._id, -1); return query; },
      limit: () => query,
      select: (fields) => { assert.ok(fields.includes('queryContext')); return query; },
      lean: async () => [...history].reverse()
    };
    return query;
  });
  mock.method(AgentRun, 'create', async (input) => new AgentRun(input));
  mock.method(AgentRun.prototype, 'save', async function () {
    await this.validate();
    history.push(this.toObject());
    return this;
  });
  mock.method(Conversation, 'updateOne', async () => ({ matchedCount: 1 }));
  const checkFilter = (filter) => {
    assert.equal(String(filter.user), userId);
    assert.equal(filter.category, expectedCategory);
    assert.equal(filter.date.$gte.getDate(), 1);
  };
  mock.method(Expense, 'aggregate', async (pipeline) => {
    checkFilter(pipeline[0].$match);
    return [{ total: [], byCategory: [], byDay: [], topMerchants: [] }];
  });
  mock.method(Expense, 'countDocuments', async (filter) => { checkFilter(filter); return 0; });
  mock.method(Expense, 'find', (filter) => {
    checkFilter(filter);
    const query = { sort: () => query, skip: () => query, limit: () => query, lean: async () => [] };
    return query;
  });
  mock.method(Expense, 'create', () => assert.fail('Queries must not create expenses'));
  mock.method(Meal, 'create', () => assert.fail('Queries must not repeat meals'));
  let analystCalls = 0;
  mock.method(globalThis, 'fetch', async (url, request) => {
    assert.ok(url.startsWith('https://example.test/'));
    const body = JSON.parse(request.body);
    const input = body.contents[0].parts[0].text;
    let text;
    if (body.generationConfig.responseMimeType === 'application/json') {
      assert.match(input, /resolvedQuery/);
      text = JSON.stringify({ intent: 'query', question: plannerQuestion });
    } else {
      analystCalls += 1;
      const facts = JSON.parse(input.split('\n\nData:\n')[1]);
      assert.equal(facts.expenses.category, expectedCategory);
      assert.equal(facts.expenses.total, 0);
      assert.match(input, /Resolved question:/);
      text = `No ${expectedCategory} expenses in this period.`;
    }
    return { ok: true, status: 200, text: async () => JSON.stringify({
      candidates: [{ content: { parts: [{ text }] } }]
    }) };
  });
  const request = {
    user: { _id: userId, currency: 'INR', customCategories: [] },
    conversation: { _id: conversationId, messageCount: 1 }
  };
  const monthly = await handleMessage({ ...request, message: 'for the month' });
  assert.equal(monthly.queryContext.category, 'other');
  assert.equal(monthly.queryContext.range, 'month');
  expectedCategory = 'transport';
  plannerQuestion = { continuation: true, category: 'transport' };
  const transport = await handleMessage({ ...request, message: 'and transport?' });
  assert.equal(transport.queryContext.range, 'month');
  assert.equal(transport.queryContext.category, 'transport');
  assert.equal(transport.status, 'completed');
  assert.ok(Object.values(transport.created).every((count) => count === 0));
  assert.equal(analystCalls, 2);
});