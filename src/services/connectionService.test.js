import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { afterEach, mock, test } from 'node:test';
import { AppConnection } from '../models/AppConnection.js';
import { AgentRun } from '../models/AgentRun.js';
import { AiSetting } from '../models/AiSetting.js';
import { GlobalAiSetting } from '../models/GlobalAiSetting.js';
import { CustomAgent } from '../models/CustomAgent.js';
import { Conversation } from '../models/Conversation.js';
import { Expense } from '../models/Expense.js';
import { Meal } from '../models/Meal.js';
import { findApp } from '../integrations/catalog.js';

process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/saarthios-test';
process.env.JWT_SECRET = 'test-secret-not-used-in-production';
process.env.CLIENT_ORIGIN = 'https://saarthios.test,https://www.saarthios.test';
process.env.CONNECTED_APPS = 'swiggy';
process.env.LLM_PROVIDER = 'gemini';
process.env.LLM_API_KEY = 'test-key';
process.env.LLM_MODEL = 'test-model';
process.env.LLM_BASE_URL = 'https://example.test/v1beta';
const connections = await import('./connectionService.js');
const { encryptSecret, decryptSecret } = await import('../utils/crypto.js');
const { handleMessage } = await import('../ai/orchestrator.js');
const { planSchema } = await import('../ai/schemas.js');

const userId = '000000000000000000000001';
const otherUserId = '000000000000000000000009';
const swiggy = findApp('swiggy');
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

afterEach(() => mock.restoreAll());

const metadata = {
  'https://mcp.swiggy.com/.well-known/oauth-protected-resource': {
    resource: 'https://mcp.swiggy.com/food',
    authorization_servers: ['https://mcp.swiggy.com']
  },
  'https://mcp.swiggy.com/.well-known/oauth-authorization-server': {
    authorization_endpoint: 'https://mcp.swiggy.com/auth/authorize',
    token_endpoint: 'https://mcp.swiggy.com/auth/token',
    registration_endpoint: 'https://mcp.swiggy.com/auth/register'
  }
};

const connectedRow = (accessToken) =>
  new AppConnection({
    user: userId,
    app: 'swiggy',
    status: 'connected',
    oauth: {
      clientId: 'client-1',
      tokenEndpoint: 'https://mcp.swiggy.com/auth/token',
      redirectUri: 'https://saarthios.test/callback',
      resource: 'https://mcp.swiggy.com/food'
    },
    tokenExpiresAt: new Date(Date.now() + 86_400_000),
    secret: encryptSecret(JSON.stringify({ accessToken, refreshToken: 'refresh-1' }))
  });

/** Serves both `await findOne()` and `findOne().select().lean()`. */
const query = (doc) => ({
  select: () => ({ lean: async () => doc?.toObject() ?? null }),
  then: (resolve, reject) => Promise.resolve(doc).then(resolve, reject)
});

/** A Swiggy Food MCP server that accepts one access token. */
function swiggyServer(tools, token = 'access-1') {
  return (init) => {
    if (init.method === 'DELETE') return new Response(null, { status: 204 });
    if (init.headers.Authorization !== `Bearer ${token}`) return new Response('', { status: 401 });
    const message = JSON.parse(init.body);
    if (message.method === 'initialize') {
      return json({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: '2025-06-18' } }, 200, {
        'mcp-session-id': 'session-1'
      });
    }
    if (message.method === 'notifications/initialized') return new Response(null, { status: 202 });
    assert.equal(init.headers['Mcp-Session-Id'], 'session-1');
    const data = tools[message.params.name](message.params.arguments);
    const reply = {
      jsonrpc: '2.0',
      id: message.id,
      result: { content: [{ type: 'text', text: JSON.stringify({ success: true, data }) }] }
    };
    // Streamable HTTP may answer as an SSE stream, so one tool does.
    if (message.params.name === 'get_food_orders') {
      return new Response(`event: message\ndata: ${JSON.stringify(reply)}\n\n`, {
        headers: { 'content-type': 'text/event-stream' }
      });
    }
    return json(reply);
  };
}

function gemini(init, answers) {
  const body = JSON.parse(init.body);
  const system = body.systemInstruction.parts[0].text;
  const text = JSON.stringify(system.includes('estimate nutrition') ? answers.nutrition : answers.plan);
  return { ok: true, status: 200, text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }) };
}

function mockChat() {
  mock.method(AiSetting, 'findOne', () => ({ lean: async () => null }));
  mock.method(GlobalAiSetting, 'findOne', () => ({ lean: async () => null }));
  mock.method(CustomAgent, 'find', () => ({ sort: () => ({ lean: async () => [] }) }));
  mock.method(AgentRun, 'find', () => {
    const chain = { sort: () => chain, limit: () => chain, select: () => chain, lean: async () => [] };
    return chain;
  });
  mock.method(AgentRun, 'create', async (input) => new AgentRun(input));
  mock.method(AgentRun.prototype, 'save', async function () { await this.validate(); return this; });
  mock.method(Conversation, 'updateOne', async () => ({ matchedCount: 1 }));
  return {
    user: { _id: userId, currency: 'INR', customCategories: [] },
    conversation: { _id: '000000000000000000000002', messageCount: 1 }
  };
}

test('starting a connection registers a PKCE client and keeps only a hash of the state', async () => {
  const saved = [];
  const registered = [];
  mock.method(AppConnection, 'findOne', async () => null);
  mock.method(AppConnection.prototype, 'save', async function () {
    await this.validate();
    saved.push(this);
    return this;
  });
  mock.method(globalThis, 'fetch', async (url, init = {}) => {
    if (metadata[url]) return json(metadata[url]);
    if (url === 'https://mcp.swiggy.com/auth/register') {
      const body = JSON.parse(init.body);
      registered.push(body.redirect_uris[0]);
      assert.equal(body.token_endpoint_auth_method, 'none');
      return json({ client_id: 'client-1' }, 201);
    }
    return json({}, 404);
  });

  const { authorizationUrl } = await connections.startConnection(userId, 'swiggy', {
    origin: 'https://www.saarthios.test',
    returnTo: 'chat'
  });
  const url = new URL(authorizationUrl);
  assert.equal(`${url.origin}${url.pathname}`, 'https://mcp.swiggy.com/auth/authorize');
  assert.equal(url.searchParams.get('client_id'), 'client-1');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://www.saarthios.test/callback');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('resource'), 'https://mcp.swiggy.com/food');
  assert.equal(url.searchParams.get('scope'), 'mcp:tools');

  const state = url.searchParams.get('state');
  const row = saved[0];
  assert.equal(row.status, 'pending');
  assert.equal(row.pending.stateHash, sha256(state));
  assert.equal(row.pending.returnTo, 'chat');
  assert.ok(!JSON.stringify(row.toObject()).includes(state));
  const { codeVerifier } = JSON.parse(decryptSecret(row.secret));
  assert.equal(
    url.searchParams.get('code_challenge'),
    crypto.createHash('sha256').update(codeVerifier).digest('base64url')
  );

  // A forged Origin never chooses where the app sends people back to.
  await connections.startConnection(userId, 'swiggy', { origin: 'https://evil.test' });
  assert.deepEqual(registered, ['https://www.saarthios.test/callback', 'https://saarthios.test/callback']);
  await assert.rejects(connections.startConnection(userId, 'zomato', {}), /Zomato does not let/);
});

test('a sign-in completes only for the account that started it, with tokens encrypted', async () => {
  const state = 'a-state-value-long-enough';
  const row = new AppConnection({
    user: userId,
    app: 'swiggy',
    oauth: {
      clientId: 'client-1',
      tokenEndpoint: 'https://mcp.swiggy.com/auth/token',
      redirectUri: 'https://saarthios.test/callback',
      resource: 'https://mcp.swiggy.com/food'
    },
    pending: { stateHash: sha256(state), returnTo: 'chat', expiresAt: new Date(Date.now() + 60_000) },
    secret: encryptSecret(JSON.stringify({ codeVerifier: 'verifier-1' }))
  });
  mock.method(AppConnection, 'findOne', async (filter) => {
    assert.equal(filter['pending.stateHash'], sha256(state));
    return String(filter.user) === userId ? row : null;
  });
  mock.method(AppConnection.prototype, 'save', async function () { await this.validate(); return this; });
  mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(url, 'https://mcp.swiggy.com/auth/token');
    const body = new URLSearchParams(init.body);
    assert.equal(body.get('grant_type'), 'authorization_code');
    assert.equal(body.get('code_verifier'), 'verifier-1');
    assert.equal(body.get('client_id'), 'client-1');
    assert.equal(body.get('redirect_uri'), 'https://saarthios.test/callback');
    assert.equal(body.get('resource'), 'https://mcp.swiggy.com/food');
    return json({ access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 432000 });
  });

  await assert.rejects(connections.completeConnection(otherUserId, { state, code: 'code-1' }), /expired/);
  const result = await connections.completeConnection(userId, { state, code: 'code-1' });
  assert.deepEqual(result, { app: 'swiggy', label: 'Swiggy', returnTo: 'chat' });
  assert.equal(row.status, 'connected');
  assert.equal(row.pending, null);
  assert.ok(!JSON.stringify(row.toObject()).includes('access-1'));
  assert.equal(JSON.parse(decryptSecret(row.secret)).refreshToken, 'refresh-1');
  assert.equal(row.toJSON().secret, undefined);
});

test('a refused token is refreshed once, and a refused refresh asks the user to reconnect', async () => {
  const row = connectedRow('old-token');
  mock.method(AppConnection, 'findOne', () => query(row));
  mock.method(AppConnection.prototype, 'save', async function () { await this.validate(); return this; });
  let refreshAnswer = json({ access_token: 'access-1', refresh_token: 'refresh-2', expires_in: 2592000 });
  const server = swiggyServer({ get_addresses: () => ({ addresses: [{ id: 'addr-1' }] }) });
  mock.method(globalThis, 'fetch', async (url, init) => {
    if (url === 'https://mcp.swiggy.com/auth/token') {
      assert.equal(new URLSearchParams(init.body).get('grant_type'), 'refresh_token');
      return refreshAnswer;
    }
    return server(init);
  });

  const data = await connections.withTools(userId, swiggy, (call) => call('get_addresses'));
  assert.equal(data.data.addresses[0].id, 'addr-1');
  assert.equal(JSON.parse(decryptSecret(row.secret)).refreshToken, 'refresh-2');

  row.secret = encryptSecret(JSON.stringify({ accessToken: 'old-token', refreshToken: 'refresh-1' }));
  refreshAnswer = json({ error: 'invalid_grant' }, 400);
  await assert.rejects(
    connections.withTools(userId, swiggy, (call) => call('get_addresses')),
    connections.ReconnectNeeded
  );
  assert.equal(row.status, 'expired');
});

test('fetching the latest Swiggy order records its real amount and an estimated meal, once', async () => {
  const request = mockChat();
  const row = connectedRow('access-1');
  mock.method(AppConnection, 'findOne', () => query(row));
  const imported = new Set();
  mock.method(AppConnection, 'updateOne', async (_filter, update) => {
    const id = update.$push.importedOrders.$each[0];
    if (imported.has(id)) return { modifiedCount: 0 };
    imported.add(id);
    return { modifiedCount: 1 };
  });
  const expenses = [];
  const meals = [];
  mock.method(Expense, 'create', async (input) => {
    const doc = new Expense(input);
    await doc.validate();
    expenses.push(doc);
    return doc;
  });
  mock.method(Meal, 'create', async (input) => {
    const doc = new Meal(input);
    await doc.validate();
    meals.push(doc);
    return doc;
  });

  const orderedAt = new Date();
  orderedAt.setDate(orderedAt.getDate() - 1);
  orderedAt.setHours(20, 30, 0, 0);
  const server = swiggyServer({
    get_addresses: () => ({ addresses: [{ id: 'addr-1' }], resolution: { defaultAddressId: 'addr-1' } }),
    get_food_orders: (args) => {
      assert.equal(args.addressId, 'addr-1');
      return {
        orders: [
          { orderId: 'A1', isActiveOrder: true, orderStatus: 'PLACED', orderTotal: '300' },
          { orderId: 'C1', isActiveOrder: false, orderStatus: 'CANCELLED', orderTotal: '200' },
          { orderId: 'D1', isActiveOrder: false, orderStatus: 'DELIVERED', restaurantName: 'Behrouz', orderTotal: '450' }
        ]
      };
    },
    get_food_order_details: (args) => {
      assert.equal(args.orderId, 'D1');
      return {
        order: {
          restaurant_name: 'Behrouz Biryani',
          order_total: 452.5,
          order_time: orderedAt.toISOString(),
          order_items: [
            { name: 'Chicken Biryani', quantity: '1', attributes: { portionSize: 'Regular' } },
            { name: 'Raita', quantity: '2' }
          ]
        }
      };
    }
  });
  const answers = {
    plan: { intent: 'record', app: { action: 'fetch_orders', app: 'swiggy' } },
    nutrition: {
      meals: [
        { orderId: 'D1', items: [
          { name: 'Chicken Biryani', quantity: '1 x Regular', calories: 700, protein: 30, carbs: 80, fat: 25 },
          { name: 'Raita', quantity: '2 restaurant servings', calories: 120, protein: 6, carbs: 10, fat: 6 }
        ] },
        { orderId: 'NOT-AN-ORDER', items: [{ name: 'Cake', quantity: '1', calories: 400 }] }
      ]
    }
  };
  mock.method(globalThis, 'fetch', async (url, init) => {
    if (String(url).startsWith('https://example.test/')) return gemini(init, answers);
    assert.equal(url, 'https://mcp.swiggy.com/food');
    return server(init);
  });

  const first = await handleMessage({ ...request, message: 'add my latest swiggy order' });
  assert.equal(expenses.length, 1);
  assert.equal(expenses[0].amount, 452.5);
  assert.equal(expenses[0].category, 'food');
  assert.equal(expenses[0].merchant, 'Behrouz Biryani');
  assert.equal(expenses[0].source, 'chat');
  assert.equal(expenses[0].date.getDate(), orderedAt.getDate());
  assert.equal(expenses[0].date.getHours(), 12);
  assert.equal(meals.length, 1);
  assert.equal(meals[0].mealType, 'dinner');
  assert.equal(meals[0].totals.calories, 820);
  assert.deepEqual([first.created.expenses, first.created.meals], [1, 1]);
  assert.ok(first.agentsUsed.includes('apps'));
  assert.match(first.reply, /Swiggy order from Behrouz Biryani: INR 452\.5 under food/);
  assert.match(first.reply, /Roughly 820 kcal, 36 g protein/);
  assert.equal(first.action, null);

  const again = await handleMessage({ ...request, message: 'add my latest swiggy order' });
  assert.equal(expenses.length, 1);
  assert.equal(meals.length, 1);
  assert.match(again.reply, /already recorded/);
});

test('asking to connect offers a sign-in, and a blocked app explains why', async () => {
  const request = mockChat();
  mock.method(AppConnection, 'findOne', () => query(null));
  mock.method(Expense, 'create', () => assert.fail('Connecting must not create expenses'));
  const answers = { plan: { intent: 'record', app: { action: 'connect', app: 'swiggy' } } };
  mock.method(globalThis, 'fetch', async (url, init) => gemini(init, answers));

  const connect = await handleMessage({ ...request, message: 'connect my swiggy account' });
  assert.deepEqual(connect.action, { kind: 'connect_app', app: 'swiggy', label: 'Swiggy' });
  assert.match(connect.reply, /Taking you to Swiggy to sign in/);

  answers.plan = { intent: 'record', app: { action: 'fetch_orders', app: 'zomato' } };
  const zomato = await handleMessage({ ...request, message: 'add my last zomato order' });
  assert.equal(zomato.action, null);
  assert.match(zomato.reply, /Zomato does not let other apps connect yet/);

  const parsed = planSchema.parse({ intent: 'record', app: { action: 'fetch_orders', app: ' Swiggy ', count: 12 } });
  assert.deepEqual(parsed.app, { action: 'fetch_orders', app: 'swiggy', count: 5 });
  assert.equal(planSchema.parse({ intent: 'record', app: { action: 'order_food' } }).app, null);
});
