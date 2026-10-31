import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';

process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/saarthios-test';
process.env.JWT_SECRET = 'test-secret-not-used-in-production';
process.env.LLM_PROVIDER = 'gemini';
process.env.LLM_API_KEY = 'test-key';
process.env.LLM_MODEL = 'test-model';
process.env.LLM_BASE_URL = 'https://example.test/v1beta';

const models = await import('../models/index.js');
const { dayBuckets } = await import('../utils/dates.js');
const { summariseMonth, resolveReviewMonth, getMonthReview, getReviewStory } =
  await import('./reviewService.js');

const userId = '000000000000000000000001';
const user = {
  _id: userId, currency: 'INR', monthlyBudget: 2000, dailyCalorieGoal: 2000, dailyProteinGoal: 60
};
const at = (day, hour = 12) => new Date(2026, 9, day, hour);
const tenDays = dayBuckets(at(1, 0), at(10, 23));

afterEach(() => mock.restoreAll());

test('the month is summed in code: streaks, busiest day, biggest, regular shop and shares', () => {
  const expenses = [
    { amount: 120, category: 'food', merchant: 'Blinkit', note: 'Milk', date: at(1), source: 'chat' },
    { amount: 80, category: 'food', merchant: 'blinkit', note: '', date: at(2), source: 'chat' },
    // 3rd to 6th October spend nothing: the longest streak.
    { amount: 900, category: 'shopping', merchant: '', note: 'Running shoes', date: at(7), source: 'manual' },
    { amount: 100, category: 'transport', merchant: 'Rapido', note: '', date: at(7), source: 'chat' },
    { amount: 300, category: 'food', merchant: 'Swiggy', note: 'Dinner', date: at(10), source: 'chat' }
  ];
  const { money } = summariseMonth({ days: tenDays, expenses, meals: [], investments: [], user });

  assert.equal(money.total, 1500);
  assert.equal(money.transactions, 5);
  assert.equal(money.dailyAverage, 150);
  assert.equal(money.budgetUsedPct, 75);
  assert.equal(money.noSpendDays, 6);
  assert.deepEqual(money.longestNoSpend, { from: '2026-10-03', to: '2026-10-06', days: 4 });
  assert.deepEqual(money.busiestDay, { date: '2026-10-07', amount: 1000 });
  assert.equal(money.biggest.label, 'Running shoes');
  assert.equal(money.biggest.date, '2026-10-07');
  assert.deepEqual(money.regular, { merchant: 'Blinkit', count: 2, amount: 200 });
  assert.deepEqual(money.categories[0], { category: 'shopping', amount: 900, share: 60 });
  // 3rd, 4th and 10th October 2026 are weekend days; only the 10th had spending.
  assert.equal(money.weekendShare, 20);
  assert.equal(money.viaChatShare, 80);
});

test('food is summed per logged day, with protein goal days and a favourite only when repeated', () => {
  const meal = (day, calories, protein, names) => ({
    date: at(day),
    totals: { calories, protein },
    items: names.map((name) => ({ name }))
  });
  const meals = [
    meal(1, 1200, 40, ['Roti', 'Dal']),
    meal(1, 700, 25, ['Paneer']),
    meal(2, 1500, 70, ['roti', 'Rajma']),
    meal(3, 2600, 30, ['Biryani'])
  ];
  const { food } = summariseMonth({ days: tenDays, expenses: [], meals, investments: [], user });

  assert.equal(food.meals, 4);
  assert.equal(food.daysLogged, 3);
  assert.equal(food.avgCalories, Math.round((1900 + 1500 + 2600) / 3));
  assert.equal(food.onTargetDays, 1);
  assert.equal(food.proteinGoalDays, 2);
  assert.deepEqual(food.favourite, { name: 'Roti', count: 2 });

  const once = summariseMonth({ days: tenDays, expenses: [], meals: [meal(1, 500, 10, ['Poha'])], investments: [], user });
  assert.equal(once.food.favourite, null);
  assert.equal(once.money.longestNoSpend.days, 10);
  assert.equal(once.money.biggest, null);
});

test('only real, finished or current months can be reviewed', () => {
  const now = new Date(2026, 9, 31, 9);
  assert.equal(resolveReviewMonth(undefined, now), '2026-10');
  assert.equal(resolveReviewMonth('2026-09', now), '2026-09');
  assert.throws(() => resolveReviewMonth('2026-11', now), /not happened yet/);
  assert.throws(() => resolveReviewMonth('october', now), /Pick a month/);
});

function stubMonth({ expenses = [], meals = [], previousTotal = 0 } = {}) {
  const calls = {};
  const listOf = (rows) => () => ({ select: () => ({ lean: async () => rows }) });
  mock.method(models.Expense, 'find', (filter) => {
    calls.expenseFilter = filter;
    return listOf(expenses)();
  });
  mock.method(models.Expense, 'aggregate', async (pipeline) => {
    calls.previousMatch = pipeline[0].$match;
    return [{ amount: previousTotal }];
  });
  mock.method(models.Meal, 'find', listOf(meals));
  mock.method(models.Investment, 'find', listOf([]));
  mock.method(models.Subscription, 'find', () => ({ lean: async () => [] }));
  mock.method(models.CustomAgent, 'find', () => ({ sort: () => ({ lean: async () => [] }) }));
  mock.method(models.AgentRun, 'countDocuments', async () => 12);
  return calls;
}

test('a running month is compared with the same number of days of the month before', async () => {
  const calls = stubMonth({
    expenses: [{ amount: 600, category: 'food', merchant: '', note: '', date: at(3), source: 'chat' }],
    previousTotal: 400
  });
  const review = await getMonthReview(user, '2026-10', new Date(2026, 9, 10, 9));

  assert.equal(review.label, 'October 2026');
  assert.equal(review.isCurrent, true);
  assert.equal(review.daysCovered, 10);
  assert.equal(calls.expenseFilter.date.$lte.getDate(), 10);
  assert.equal(calls.previousMatch.date.$gte.getMonth(), 8);
  assert.equal(calls.previousMatch.date.$lte.getDate(), 10);
  assert.deepEqual(review.money.previous, { total: 400, label: 'September', partial: true });
  assert.equal(review.money.changePct, 50);
  assert.equal(review.assistant.messages, 12);
});

test('a finished month keeps its story; a new one is written once and saved', async () => {
  mock.method(models.DailyBrief, 'findOne', () => ({
    lean: async () => ({ day: '2026-01-01', content: { persona: 'Kept Story' } })
  }));
  mock.method(globalThis, 'fetch', () => assert.fail('A saved story must not call the AI'));
  assert.equal((await getReviewStory(user, '2026-09')).persona, 'Kept Story');
  mock.restoreAll();

  stubMonth({
    expenses: [{ amount: 250, category: 'other', merchant: '', note: 'Hair cutting', date: at(3), source: 'chat' }]
  });
  mock.method(models.AiSetting, 'findOne', () => ({ lean: async () => null }));
  mock.method(models.GlobalAiSetting, 'findOne', () => ({ lean: async () => null }));
  mock.method(models.DailyBrief, 'findOne', () => ({ lean: async () => null }));
  let saved;
  mock.method(models.DailyBrief, 'updateOne', async (filter, update) => { saved = { filter, update }; });
  let prompt;
  let aiCalls = 0;
  mock.method(globalThis, 'fetch', async (_url, request) => {
    aiCalls += 1;
    prompt = JSON.parse(request.body).contents[0].parts[0].text;
    const story = {
      persona: 'Quietly Consistent',
      headline: 'A calm month with one trip to the barber.',
      highlights: [
        { title: 'One haircut', text: 'INR 250 on a haircut.' },
        { title: 'Two', text: 'Second.' },
        { title: 'Three', text: 'Third.' },
        { title: 'Four', text: 'Dropped.' }
      ],
      nudge: 'Keep logging every day.'
    };
    return { ok: true, status: 200, text: async () => JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify(story) }] } }]
    }) };
  });

  const [story, sameStory] = await Promise.all([
    getReviewStory(user, '2026-09', { fresh: true }),
    getReviewStory(user, '2026-09', { fresh: true })
  ]);
  assert.equal(aiCalls, 1, 'two requests at once share one AI call');
  assert.equal(sameStory, story);
  assert.equal(story.persona, 'Quietly Consistent');
  assert.equal(story.highlights.length, 3);
  assert.match(prompt, /"label": "September 2026"/);
  assert.match(prompt, /Hair cutting/);
  assert.equal(saved.filter.slot, 'review:2026-09');
});

test('an empty month is not written up', async () => {
  stubMonth();
  mock.method(models.DailyBrief, 'findOne', () => ({ lean: async () => null }));
  mock.method(globalThis, 'fetch', () => assert.fail('Nothing to write about'));
  await assert.rejects(() => getReviewStory(user, '2026-09'), /nothing logged in September 2026/);
});
