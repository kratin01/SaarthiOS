/**
 * OAuth 2.1 as MCP servers expect it: discover the authorization server from
 * the MCP server's metadata (RFC 9728, RFC 8414), register a client on the fly
 * (RFC 7591), and sign in with PKCE S256 plus the `resource` indicator (RFC 8707).
 *
 * Every endpoint must be HTTPS. Nothing here logs or returns a token to the browser.
 */
import crypto from 'node:crypto';

const TIMEOUT_MS = 15_000;

export class OAuthError extends Error {
  constructor(message, { status = 0, code = '' } = {}) {
    super(message);
    this.name = 'OAuthError';
    this.status = status;
    this.code = code;
  }
}

export async function discover(mcpUrl) {
  const server = new URL(mcpUrl);
  const resourceMeta = await firstJson([
    wellKnown(server, 'oauth-protected-resource'),
    `${server.origin}/.well-known/oauth-protected-resource`
  ]);

  // Servers written against the older spec host the authorization server themselves.
  const issuer = new URL(resourceMeta?.authorization_servers?.[0] ?? server.origin);
  const meta = await firstJson([
    wellKnown(issuer, 'oauth-authorization-server'),
    wellKnown(issuer, 'openid-configuration')
  ]);
  if (!meta?.authorization_endpoint || !meta?.token_endpoint) {
    throw new OAuthError('The app did not publish its sign-in details.');
  }

  const declared = resourceMeta?.resource ? new URL(resourceMeta.resource) : null;
  return {
    resource: declared?.origin === server.origin ? declared.toString().replace(/\/$/, '') : mcpUrl,
    authorizationEndpoint: httpsUrl(meta.authorization_endpoint),
    tokenEndpoint: httpsUrl(meta.token_endpoint),
    registrationEndpoint: meta.registration_endpoint ? httpsUrl(meta.registration_endpoint) : null
  };
}

export async function register(registrationEndpoint, { redirectUri, scope }) {
  if (!registrationEndpoint) throw new OAuthError('The app does not accept new connections.');

  const response = await send(registrationEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_name: 'SaarthiOS',
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      ...(scope ? { scope } : {})
    })
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.client_id) {
    throw new OAuthError('The app refused to register SaarthiOS.', {
      status: response.status,
      code: data?.error
    });
  }

  const clientSecret = data.client_secret ? String(data.client_secret) : '';
  return {
    clientId: String(data.client_id),
    clientSecret,
    authMethod: data.token_endpoint_auth_method ?? (clientSecret ? 'client_secret_post' : 'none')
  };
}

export function createPkce() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export function buildAuthorizationUrl({ endpoint, clientId, redirectUri, challenge, state, scope, resource }) {
  const url = new URL(endpoint);
  const params = {
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    resource,
    ...(scope ? { scope } : {})
  };
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

export const exchangeCode = ({ tokenEndpoint, client, code, verifier, redirectUri, resource }) =>
  tokenRequest(tokenEndpoint, client, {
    grant_type: 'authorization_code',
    code,
    code_verifier: verifier,
    redirect_uri: redirectUri,
    resource
  });

export const refreshTokens = ({ tokenEndpoint, client, refreshToken, resource }) =>
  tokenRequest(tokenEndpoint, client, {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    resource
  });

async function tokenRequest(tokenEndpoint, client, params) {
  const body = new URLSearchParams(params);
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' };

  if (client.clientSecret && client.authMethod === 'client_secret_basic') {
    const pair = `${encodeURIComponent(client.clientId)}:${encodeURIComponent(client.clientSecret)}`;
    headers.Authorization = `Basic ${Buffer.from(pair).toString('base64')}`;
  } else {
    body.set('client_id', client.clientId);
    if (client.clientSecret) body.set('client_secret', client.clientSecret);
  }

  const response = await send(tokenEndpoint, { method: 'POST', headers, body });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.access_token) {
    throw new OAuthError('The app did not accept the sign-in.', {
      status: response.status,
      code: data?.error
    });
  }

  const seconds = Number(data.expires_in);
  return {
    accessToken: String(data.access_token),
    refreshToken: data.refresh_token ? String(data.refresh_token) : '',
    expiresAt: Number.isFinite(seconds) && seconds > 0 ? new Date(Date.now() + seconds * 1000) : null
  };
}

/** RFC 8414 and 9728 put the well-known segment between the host and any path. */
function wellKnown(url, name) {
  return `${url.origin}/.well-known/${name}${url.pathname.replace(/\/+$/, '')}`;
}

async function firstJson(urls) {
  for (const url of [...new Set(urls)]) {
    const response = await send(url, { headers: { Accept: 'application/json' } });
    if (response.ok) return response.json().catch(() => null);
  }
  return null;
}

function send(url, init) {
  return fetch(httpsUrl(url), { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
}

function httpsUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:') throw new OAuthError('The app published an insecure sign-in address.');
  return url.toString();
}
