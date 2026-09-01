/**
 * What to tell users when something is not working.
 *
 * Two sources feed this, and they are deliberately different:
 *
 *  - **Operator notices** from `.env` (`NOTICE_*`). You write these. They win
 *    over anything detected automatically, because you know things the server
 *    cannot — "our AI credits ran out, back on Monday".
 *  - **Detected problems**, from repeated failures talking to MongoDB, the AI
 *    provider or the price feed. These need nobody to be awake.
 *
 * Nothing here is a secret, so this is safe to serve without a login: it is the
 * sign-in page that most needs to explain why the database is down.
 */
import { env } from '../config/env.js';
import { databaseState } from '../config/db.js';
import { healthOf } from '../utils/serviceHealth.js';
import { envLlmStatus } from '../ai/llm.js';

/** Wording lives here rather than in components so it stays consistent. */
const DETECTED = {
  database:
    'We are having trouble reaching the database, so things may not save right now. Please try again in a few minutes.',
  ai: 'The AI is not responding at the moment, so chat and tips may fail. Your saved data is unaffected.',
  aiMissing:
    'No AI provider is set up yet, so chat and tips are off. Add a key in Settings — everything else works without one.',
  prices:
    'Live share prices are unavailable right now. Everything you have saved is fine; only the current value cannot be fetched.'
};

export function buildStatus() {
  const db = databaseState();
  const ai = envLlmStatus();
  const aiHealth = healthOf('ai');
  const priceHealth = healthOf('prices');

  // A cold start is not an outage, so nothing is said while the first attempt
  // is still in flight.
  const database = {
    ok: db.ready || db.connecting,
    notice: db.ready || db.connecting ? '' : DETECTED.database
  };

  // "Not configured" and "configured but failing" are different problems and
  // deserve different sentences.
  const aiOk = ai.ok && aiHealth.ok;
  const aiNotice = env.notices.chat || (!ai.ok ? DETECTED.aiMissing : aiHealth.ok ? '' : DETECTED.ai);

  const pricesOk = priceHealth.ok;
  const pricesNotice = env.notices.prices || (pricesOk ? '' : DETECTED.prices);

  return {
    notice: env.notices.global,
    services: {
      database,
      ai: {
        ok: aiOk,
        configured: ai.ok,
        provider: ai.ok ? ai.label : '',
        model: ai.ok ? ai.model : '',
        notice: aiNotice
      },
      prices: { ok: pricesOk, notice: pricesNotice },
      import: { ok: aiOk, notice: env.notices.import || (aiOk ? '' : DETECTED.ai) },
      google: { enabled: env.googleEnabled }
    }
  };
}
