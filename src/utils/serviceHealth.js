/**
 * Remembers whether an outside service has been failing lately.
 *
 * The point is to tell a user "prices are having trouble right now" *before*
 * they click and wait, rather than only failing after they do. A few isolated
 * failures are normal, so a service is only called unhealthy after several in a
 * row, and one success clears it immediately.
 *
 * This lives in memory, so it resets on restart and is per-instance. That is
 * fine for what it does: it is a hint for the UI, never a source of truth.
 */
const FAILURES_BEFORE_UNHEALTHY = 3;

/** After this long with no news, assume things recovered rather than nag forever. */
const STALE_MS = 10 * 60 * 1000;

const state = new Map();

const entry = (service) => {
  if (!state.has(service)) {
    state.set(service, { failures: 0, lastError: '', lastFailureAt: 0 });
  }
  return state.get(service);
};

export function recordSuccess(service) {
  const s = entry(service);
  s.failures = 0;
  s.lastError = '';
  s.lastFailureAt = 0;
}

export function recordFailure(service, message = '') {
  const s = entry(service);
  s.failures += 1;
  s.lastError = String(message).slice(0, 200);
  s.lastFailureAt = Date.now();
}

/** `ok: false` only once a service has failed repeatedly and recently. */
export function healthOf(service) {
  const s = state.get(service);
  if (!s || s.failures === 0) return { ok: true, failures: 0, lastError: '' };

  const stale = Date.now() - s.lastFailureAt > STALE_MS;
  if (stale) return { ok: true, failures: 0, lastError: '' };

  return {
    ok: s.failures < FAILURES_BEFORE_UNHEALTHY,
    failures: s.failures,
    lastError: s.lastError
  };
}
