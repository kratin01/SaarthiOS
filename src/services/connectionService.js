/**
 * Linking outside apps (Swiggy today) and talking to them on a user's behalf.
 *
 * Sign-in is OAuth with PKCE. The app sends the browser back to the signed-in
 * web app at `/callback`, which posts the code here with the user's session.
 * The pending sign-in is looked up by user AND state, so a sign-in link started
 * by someone else can never attach their account to this one, or the reverse.
 */
import crypto from 'node:crypto';
import { AppConnection } from '../models/AppConnection.js';
import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';
import { encryptSecret, decryptSecret } from '../utils/crypto.js';
import { logger } from '../utils/logger.js';
import { findApp, listApps } from '../integrations/catalog.js';
import * as oauth from '../integrations/oauth.js';
import { withMcpSession, McpAuthError } from '../integrations/mcpClient.js';

const PENDING_MS = 10 * 60_000;
const REMEMBERED_ORDERS = 200;

/** The app needs the user to sign in again. The chat turns this into a Connect button. */
export class ReconnectNeeded extends ApiError {
  constructor(app) {
    super(409, `Your ${app.label} sign-in has expired. Connect ${app.label} again to continue.`);
    this.app = app;
  }
}

/** Why an app cannot be connected on this server right now, or '' when it can. */
export function unavailableReason(app) {
  if (app.blocked) return app.blocked;
  if (!env.connectedApps.includes(app.id)) return `${app.label} connections are not switched on yet.`;
  return '';
}

export function requireApp(id) {
  const app = findApp(id);
  if (!app) throw ApiError.notFound('That app is not supported.');
  return app;
}

export async function listConnections(userId) {
  const rows = await AppConnection.find({ user: userId }).lean();
  const byApp = new Map(rows.map((row) => [row.app, row]));

  return listApps().map((app) => {
    const row = byApp.get(app.id);
    const note = unavailableReason(app);
    return {
      id: app.id,
      label: app.label,
      description: app.description,
      status: note ? 'unavailable' : publicStatus(row?.status),
      note,
      connectedAt: row?.connectedAt ?? null,
      lastImportedAt: row?.lastImportedAt ?? null
    };
  });
}

/** `connected`, `expired`, `disconnected` or `unavailable`. */
export async function connectionStatus(userId, app) {
  if (unavailableReason(app)) return 'unavailable';
  const row = await AppConnection.findOne({ user: userId, app: app.id }).select('status').lean();
  return publicStatus(row?.status);
}

export async function startConnection(userId, appId, { origin, returnTo = 'settings' }) {
  const app = requireApp(appId);
  const reason = unavailableReason(app);
  if (reason) throw ApiError.badRequest(reason);

  const redirectUri = `${publicOrigin(origin)}/callback`;
  const server = await talkTo(app, () => oauth.discover(app.mcpUrl));

  const connection =
    (await AppConnection.findOne({ user: userId, app: app.id })) ??
    new AppConnection({ user: userId, app: app.id });
  const secret = readSecret(connection);

  // Registered clients are reused; a new one is only needed when the address changes.
  const reusable =
    connection.oauth?.clientId &&
    connection.oauth.redirectUri === redirectUri &&
    connection.oauth.tokenEndpoint === server.tokenEndpoint;
  const client = reusable
    ? clientOf(connection, secret)
    : await talkTo(app, () =>
        oauth.register(server.registrationEndpoint, { redirectUri, scope: app.scope })
      );

  const state = crypto.randomBytes(32).toString('base64url');
  const pkce = oauth.createPkce();

  connection.set({
    status: ['connected', 'expired'].includes(connection.status) ? connection.status : 'pending',
    oauth: {
      clientId: client.clientId,
      authMethod: client.authMethod,
      tokenEndpoint: server.tokenEndpoint,
      redirectUri,
      resource: server.resource
    },
    pending: { stateHash: hash(state), returnTo, expiresAt: new Date(Date.now() + PENDING_MS) }
  });
  writeSecret(connection, { ...secret, clientSecret: client.clientSecret, codeVerifier: pkce.verifier });
  await connection.save();

  return {
    authorizationUrl: oauth.buildAuthorizationUrl({
      endpoint: server.authorizationEndpoint,
      clientId: client.clientId,
      redirectUri,
      challenge: pkce.challenge,
      state,
      scope: app.scope,
      resource: server.resource
    })
  };
}

export async function completeConnection(userId, { state, code }) {
  const connection = await AppConnection.findOne({ user: userId, 'pending.stateHash': hash(state) });
  // One answer for stale and foreign links alike, so neither can be probed.
  if (!connection || connection.pending.expiresAt < new Date()) {
    throw ApiError.badRequest('This sign-in link has expired. Start again from Settings.');
  }

  const app = requireApp(connection.app);
  const secret = readSecret(connection);
  const tokens = await talkTo(app, () =>
    oauth.exchangeCode({
      tokenEndpoint: connection.oauth.tokenEndpoint,
      client: clientOf(connection, secret),
      code,
      verifier: secret.codeVerifier,
      redirectUri: connection.oauth.redirectUri,
      resource: connection.oauth.resource
    })
  );

  const { returnTo } = connection.pending;
  connection.set({
    status: 'connected',
    pending: null,
    connectedAt: new Date(),
    tokenExpiresAt: tokens.expiresAt
  });
  writeSecret(connection, {
    clientSecret: secret.clientSecret ?? '',
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken
  });
  await connection.save();

  return { app: app.id, label: app.label, returnTo };
}

export async function disconnect(userId, appId) {
  const app = requireApp(appId);
  await AppConnection.updateOne(
    { user: userId, app: app.id },
    {
      $set: { status: 'disconnected', connectedAt: null, tokenExpiresAt: null, pending: null },
      $unset: { secret: 1, oauth: 1 }
    }
  );
}

/**
 * Runs `work(call)` inside an MCP session for this user. An access token that
 * is about to expire, or is refused, is refreshed once before giving up.
 */
export async function withTools(userId, app, work) {
  const connection = await AppConnection.findOne({ user: userId, app: app.id });
  if (connection?.status !== 'connected') throw new ReconnectNeeded(app);

  let secret = readSecret(connection);
  if (!secret.accessToken) return expire(connection, app);
  if (connection.tokenExpiresAt && connection.tokenExpiresAt.getTime() - Date.now() < 60_000) {
    secret = await refresh(connection, app, secret);
  }

  const run = (token) => withMcpSession({ url: app.mcpUrl, accessToken: token }, work);
  try {
    return await run(secret.accessToken);
  } catch (error) {
    if (!(error instanceof McpAuthError)) throw friendly(app, error);
  }

  secret = await refresh(connection, app, secret);
  try {
    return await run(secret.accessToken);
  } catch (error) {
    if (error instanceof McpAuthError) return expire(connection, app);
    throw friendly(app, error);
  }
}

/** Atomically marks an order as imported. False when it already was. */
export async function claimOrder(userId, appId, orderId) {
  const result = await AppConnection.updateOne(
    { user: userId, app: appId, importedOrders: { $ne: orderId } },
    {
      $push: { importedOrders: { $each: [orderId], $slice: -REMEMBERED_ORDERS } },
      $set: { lastImportedAt: new Date() }
    }
  );
  return result.modifiedCount === 1;
}

export function releaseOrder(userId, appId, orderId) {
  return AppConnection.updateOne({ user: userId, app: appId }, { $pull: { importedOrders: orderId } });
}

async function refresh(connection, app, secret) {
  if (!secret.refreshToken) return expire(connection, app);

  let tokens;
  try {
    tokens = await oauth.refreshTokens({
      tokenEndpoint: connection.oauth.tokenEndpoint,
      client: clientOf(connection, secret),
      refreshToken: secret.refreshToken,
      resource: connection.oauth.resource
    });
  } catch (error) {
    if (isRefusal(error)) return expire(connection, app);
    throw friendly(app, error);
  }

  const next = {
    ...secret,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken || secret.refreshToken
  };
  writeSecret(connection, next);
  connection.tokenExpiresAt = tokens.expiresAt;
  await connection.save();
  return next;
}

async function expire(connection, app) {
  connection.status = 'expired';
  await connection.save();
  throw new ReconnectNeeded(app);
}

async function talkTo(app, work) {
  try {
    return await work();
  } catch (error) {
    throw friendly(app, error);
  }
}

function friendly(app, error) {
  if (error instanceof ApiError) return error;
  logger.warn(`${app.id} connection: ${error.message}`);
  if (isRefusal(error)) {
    return ApiError.badRequest(`${app.label} did not accept that sign-in. Please connect again.`);
  }
  return ApiError.unavailable(`We could not reach ${app.label} right now. Please try again in a minute.`);
}

const isRefusal = (error) =>
  error instanceof oauth.OAuthError && error.status >= 400 && error.status < 500;

/** The address the app sends people back to, which must be a site origin we serve. */
function publicOrigin(origin) {
  const url = new URL(env.allowedOrigins.includes(origin) ? origin : env.allowedOrigins[0]);
  const local = ['localhost', '127.0.0.1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !local) {
    throw ApiError.badRequest('Connecting apps needs the site to run on HTTPS.');
  }
  return url.origin;
}

const publicStatus = (status) =>
  status === 'connected' || status === 'expired' ? status : 'disconnected';

const hash = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');

const clientOf = (connection, secret) => ({
  clientId: connection.oauth.clientId,
  clientSecret: secret.clientSecret ?? '',
  authMethod: connection.oauth.authMethod
});

function readSecret(connection) {
  if (!connection?.secret?.ciphertext) return {};
  try {
    return JSON.parse(decryptSecret(connection.secret) ?? '{}');
  } catch {
    return {};
  }
}

function writeSecret(connection, value) {
  connection.secret = encryptSecret(JSON.stringify(value));
}
