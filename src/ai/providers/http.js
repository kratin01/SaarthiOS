/** Shared HTTP helpers for every provider adapter: timeout + readable errors. */
import { ApiError } from '../../utils/ApiError.js';

export async function postJson(url, { headers, body, timeoutMs, providerLabel }) {
  return request(url, { method: 'POST', headers, body, timeoutMs, providerLabel });
}

export async function getJson(url, { headers, timeoutMs, providerLabel }) {
  return request(url, { method: 'GET', headers, timeoutMs, providerLabel });
}

async function request(url, { method, headers, body, timeoutMs, providerLabel }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw ApiError.unavailable(`${providerLabel} timed out. Try again in a moment.`);
    }
    throw ApiError.unavailable(`Could not reach ${providerLabel}. Check the network or base URL.`);
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text();

  if (!response.ok) {
    const error = ApiError.unavailable(
      explain(response.status, providerLabel),
      shortenProviderError(text)
    );
    // Carried so `askJson` can retry the statuses that are worth retrying.
    error.providerStatus = response.status;
    throw error;
  }

  try {
    return JSON.parse(text);
  } catch {
    throw ApiError.unavailable(`${providerLabel} returned a response that was not JSON.`);
  }
}

/** The four statuses users actually hit, in words they can act on. */
function explain(status, providerLabel) {
  if (status === 429) {
    return `${providerLabel} is rate limiting you. Free tiers allow only a few requests a minute — wait a moment and try again.`;
  }
  if (status === 401 || status === 403) {
    return `${providerLabel} rejected your API key. Check it in Settings.`;
  }
  if (status === 404) {
    return `${providerLabel} does not have that model. Pick another one in Settings.`;
  }
  // Worth separating from other 5xx: it is the model that is busy, not the
  // provider that is broken, and switching model in Settings fixes it now.
  if (status === 503) {
    return `That model is overloaded right now. It usually clears in a few minutes, or pick a different model in Settings.`;
  }
  if (status >= 500) {
    return `${providerLabel} is having trouble right now. Try again shortly.`;
  }
  return `${providerLabel} rejected the request (${status}).`;
}

/** Providers return long error blobs; keep only the useful sentence. */
function shortenProviderError(text) {
  try {
    const parsed = JSON.parse(text);
    const message = parsed?.error?.message ?? parsed?.message ?? parsed?.error;
    if (typeof message === 'string') return message.slice(0, 300);
  } catch {
    /* fall through */
  }
  return String(text).slice(0, 300);
}
