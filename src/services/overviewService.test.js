import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';

process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/saarthios-test';
process.env.JWT_SECRET = 'test-secret-not-used-in-production';
process.env.LLM_PROVIDER = 'gemini';
process.env.LLM_API_KEY = 'test-key';
process.env.LLM_MODEL = 'test-model';
process.env.LLM_BASE_URL = 'https://example.test/v1beta';
process.env.TAVILY_API_KEY = 'tvly-test';

const models = await import('../models/index.js');
const { getInsights, getInspiration } = await import('./overviewService.js');
const { updateProfileSchema } = await import('../controllers/authController.js');
const { toDateKey } = await import('../utils/dates.js');

const { AiSetting, GlobalAiSetting, DailyBrief } = models;
const userId = '000000000000000000000001';

afterEach(() => mock.restoreAll());

const geminiReply = (answer) => ({
  ok: true,
  status: 200,
  text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(answer) }] } }] })
});

test('inspiration may search once, keeps only web links and remembers the line', async () => {
  mock.method(AiSetting, 'findOne', () => ({ lean: async () => null }));
  mock.method(GlobalAiSetting, 'findOne', () => ({ lean: async () => null }));
  mock.method(DailyBrief, 'findOne', () => ({
    lean: async () => ({ day: '2000-01-01', recent: ['I am enough.'], content: {} })
  }));
  let saved;
  mock.method(DailyBrief, 'updateOne', async (filter, update) => { saved = { filter, update }; });

  const prompts = [];
  let searchBody;
  mock.method(globalThis, 'fetch', async (url, request) => {
    if (url === 'https://api.tavily.com/search') {
      assert.equal(request.headers.Authorization, 'Bearer tvly-test');
      searchBody = JSON.parse(request.body);
      return { ok: true, status: 200, json: async () => ({ results: [
        { title: 'Bad', url: 'javascript:alert(1)', content: 'x' },
        { title: 'Quote source', url: 'https://example.org/quote', content: 'The quote and its author.' }
      ] }) };
    }
    prompts.push(JSON.parse(request.body).contents[0].parts[0].text);
    return geminiReply(prompts.length === 1
      ? { search: { query: 'journey of a thousand miles quote author' }, kind: 'quote', text: 'draft', author: '' }
      : {
        search: { query: 'asking again is ignored' },
        kind: 'quote',
        text: '"The journey of a thousand miles begins with one step."',
        author: 'Lao Tzu',
        original: 'only for gita',
        source: 1
      });
  });

  const line = await getInspiration({ _id: userId, currency: 'INR', inspirationKind: 'quote' });

  assert.equal(prompts.length, 2);
  assert.match(prompts[0], /I am enough\./);
  assert.match(prompts[1], /Web results for "journey of a thousand miles/);
  assert.doesNotMatch(prompts[1], /javascript:/);
  assert.equal(searchBody.country, 'india');
  assert.equal(line.text, 'The journey of a thousand miles begins with one step.');
  assert.equal(line.author, 'Lao Tzu');
  assert.equal(line.original, '');
  assert.deepEqual(line.link, { title: 'Quote source', url: 'https://example.org/quote' });
  assert.equal(saved.filter.slot, 'inspiration');
  assert.equal(saved.update.$set.day, toDateKey(new Date()));
  assert.deepEqual(saved.update.$push.recent.$each, [line.text]);
});

test('a line written today is reused without calling the AI', async () => {
  mock.method(DailyBrief, 'findOne', () => ({
    lean: async () => ({ day: toDateKey(new Date()), recent: [], content: { text: 'Cached', kind: 'gita' } })
  }));
  mock.method(globalThis, 'fetch', () => assert.fail('A cached line must not call the AI'));

  const line = await getInspiration({ _id: userId, inspirationKind: 'quote' });
  assert.equal(line.text, 'Cached');
});

test('insights fall back to the arithmetic checks when no AI is usable', async () => {
  // A saved provider without a key resolves to "not ok", so no model is called.
  mock.method(AiSetting, 'findOne', () => ({ lean: async () => ({ provider: 'gemini', key: {} }) }));
  mock.method(DailyBrief, 'findOne', () => ({ lean: async () => null }));
  mock.method(DailyBrief, 'updateOne', () => assert.fail('Rule checks are not cached'));
  mock.method(globalThis, 'fetch', () => assert.fail('No AI or search call without a provider'));

  const empty = () => {
    const query = {
      sort: () => query, limit: () => query, skip: () => query, populate: () => query,
      lean: async () => []
    };
    return query;
  };
  for (const name of ['Expense', 'Meal', 'Investment', 'CustomEntry']) {
    mock.method(models[name], 'aggregate', async () => []);
    mock.method(models[name], 'find', empty);
    mock.method(models[name], 'countDocuments', async () => 0);
  }
  mock.method(models.Subscription, 'find', empty);
  mock.method(models.CustomAgent, 'find', empty);

  const result = await getInsights(
    { _id: userId, currency: 'INR', dailyCalorieGoal: 2000, dailyProteinGoal: 0, monthlyBudget: null },
    'today'
  );
  assert.equal(result.source, 'rules');
  assert.match(result.notice, /AI provider/);
  assert.deepEqual(result.insights, [
    { tone: 'neutral', text: 'No meals logged today yet.', link: null }
  ]);
});

test('profile updates accept known Overview cards and inspiration kinds only', () => {
  const agentCard = 'agent:0123456789abcdef01234567';
  const parsed = updateProfileSchema.parse({
    overviewCards: ['spent', agentCard, 'spent'],
    inspirationKind: 'gita'
  });
  assert.deepEqual(parsed.overviewCards, ['spent', agentCard]);
  assert.equal(updateProfileSchema.safeParse({ overviewCards: ['nonsense'] }).success, false);
  assert.equal(updateProfileSchema.safeParse({ inspirationKind: 'horoscope' }).success, false);
});
