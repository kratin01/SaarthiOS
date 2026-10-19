/**
 * The smallest MCP client SaarthiOS needs: open a Streamable HTTP session,
 * call a few tools, close it. A reply may come back as plain JSON or as an SSE
 * stream, so both are read.
 *
 * Spec: https://modelcontextprotocol.io/specification/2025-06-18/basic/transports
 */
const PROTOCOL_VERSION = '2025-06-18';
const TIMEOUT_MS = 20_000;

export class McpError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = 'McpError';
    this.status = status;
  }
}

/** The token was refused. The caller refreshes it, or asks the user to sign in again. */
export class McpAuthError extends McpError {}

export async function withMcpSession({ url, accessToken }, work) {
  const session = { url, accessToken, id: null, version: null, nextId: 1 };

  const init = await rpc(session, 'initialize', {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: 'SaarthiOS', version: '1.0.0' }
  });
  session.version = init?.protocolVersion ?? PROTOCOL_VERSION;
  await post(session, { method: 'notifications/initialized' });

  try {
    return await work((name, args = {}) => callTool(session, name, args));
  } finally {
    // Servers keep session state; closing it is polite and never worth failing over.
    if (session.id) {
      fetch(url, { method: 'DELETE', headers: headers(session), signal: AbortSignal.timeout(5_000) })
        .catch(() => undefined);
    }
  }
}

async function callTool(session, name, args) {
  const result = await rpc(session, 'tools/call', { name, arguments: args });
  if (result?.isError) throw new McpError(textOf(result) || `${name} failed`);
  return result?.structuredContent ?? parse(textOf(result));
}

async function rpc(session, method, params) {
  const id = session.nextId++;
  const response = await post(session, { id, method, params });
  const message = await readMessage(response, id);
  if (message?.error) {
    // Some servers report an expired session inside JSON-RPC instead of as a 401.
    if (message.error.code === -32001) throw new McpAuthError('Sign-in expired');
    throw new McpError(message.error.message || `${method} failed`);
  }
  if (!message) throw new McpError(`${method} returned nothing`);
  return message.result;
}

async function post(session, message) {
  const response = await fetch(session.url, {
    method: 'POST',
    headers: { ...headers(session), 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', ...message }),
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  if (response.status === 401) throw new McpAuthError('Sign-in expired', 401);
  if (!response.ok) throw new McpError(`MCP server answered ${response.status}`, response.status);
  session.id = response.headers.get('mcp-session-id') ?? session.id;
  return response;
}

function headers(session) {
  return {
    Authorization: `Bearer ${session.accessToken}`,
    ...(session.id ? { 'Mcp-Session-Id': session.id } : {}),
    ...(session.version ? { 'MCP-Protocol-Version': session.version } : {})
  };
}

async function readMessage(response, id) {
  const text = await response.text();
  if (!(response.headers.get('content-type') ?? '').includes('text/event-stream')) return parse(text);

  for (const event of text.split(/\r?\n\r?\n/)) {
    const data = event
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n');
    const message = data ? parse(data) : null;
    if (message?.id === id) return message;
  }
  return null;
}

function textOf(result) {
  return (result?.content ?? [])
    .filter((part) => part?.type === 'text')
    .map((part) => part.text)
    .join('\n');
}

function parse(text) {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}
