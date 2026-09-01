/**
 * Where each user's AI provider settings live.
 *
 * Resolution order for every AI call:
 *   1. What the user saved in Settings  ← rotating a key is a UI action
 *   2. The `.env` values                ← a default for a fresh deployment
 *
 * The key itself is encrypted in MongoDB and is never returned to the browser —
 * Settings only ever sees a hint like `AQ.Ab…5xKq`.
 */
import { env } from '../config/env.js';
import { AiSetting } from '../models/AiSetting.js';
import { ApiError } from '../utils/ApiError.js';
import { decryptSecret, encryptSecret, maskSecret } from '../utils/crypto.js';
import { PROVIDER_CATALOG, resolveProviderConfig } from '../ai/providers/index.js';

/** The `.env` fallback, used until a user saves their own. */
const envConfig = () => ({
  provider: env.LLM_PROVIDER,
  apiKey: env.LLM_API_KEY,
  model: env.LLM_MODEL,
  baseUrl: env.LLM_BASE_URL
});

/**
 * The config an AI call should actually use.
 * `source` tells the UI which of the two won.
 */
export async function resolveForUser(userId) {
  const saved = await AiSetting.findOne({ user: userId }).lean();

  if (saved?.provider) {
    const apiKey = decryptSecret(saved.key ?? {}) ?? '';
    const config = resolveProviderConfig({
      provider: saved.provider,
      apiKey,
      model: saved.model,
      baseUrl: saved.baseUrl
    });

    // A key that will not decrypt means ENCRYPTION_KEY (or JWT_SECRET) changed.
    if (!config.ok && !apiKey && saved.key?.ciphertext) {
      return {
        ...config,
        source: 'user',
        reason: 'Your saved API key could not be read. Please enter it again in Settings.'
      };
    }
    return { ...config, source: 'user' };
  }

  return { ...resolveProviderConfig(envConfig()), source: 'env' };
}

/** Safe to send to the browser: no key, ever. */
export async function statusForUser(userId) {
  const config = await resolveForUser(userId);
  const saved = await AiSetting.findOne({ user: userId }).lean();

  return {
    configured: config.ok,
    provider: config.name,
    label: config.label ?? config.name,
    model: config.model ?? '',
    source: config.source,
    reason: config.ok ? null : config.reason,
    keyHint: saved?.keyHint ?? '',
    baseUrl: saved?.baseUrl ?? '',
    lastTestedAt: saved?.lastTestedAt ?? null,
    lastTestOk: saved?.lastTestOk ?? null,
    /** True when the deployment ships a default key, so the UI can say so. */
    envFallbackAvailable: resolveProviderConfig(envConfig()).ok
  };
}

/**
 * Saves a user's provider choice.
 * Leaving `apiKey` out keeps the stored one, so a user can change model without
 * having to paste their key again.
 */
export async function saveForUser(userId, { provider, model = '', baseUrl = '', apiKey }) {
  const preset = PROVIDER_CATALOG[String(provider ?? '').toLowerCase()];
  if (!preset) throw ApiError.badRequest('Unknown provider');

  const existing = await AiSetting.findOne({ user: userId });
  const update = {
    user: userId,
    provider: provider.toLowerCase(),
    model: model.trim(),
    baseUrl: baseUrl.trim()
  };

  if (typeof apiKey === 'string' && apiKey.trim()) {
    update.key = encryptSecret(apiKey.trim());
    update.keyHint = maskSecret(apiKey.trim());
    update.lastTestedAt = null;
    update.lastTestOk = null;
  } else if (!existing?.key?.ciphertext && !preset.keyOptional) {
    throw ApiError.badRequest(`${preset.label} needs an API key.`);
  }

  const saved = await AiSetting.findOneAndUpdate({ user: userId }, update, {
    new: true,
    upsert: true,
    setDefaultsOnInsert: true
  });

  return saved.toJSON();
}

/** Removes the saved key and falls back to whatever `.env` provides. */
export async function clearForUser(userId) {
  await AiSetting.deleteOne({ user: userId });
}

export async function recordTestResult(userId, ok) {
  await AiSetting.updateOne({ user: userId }, { lastTestedAt: new Date(), lastTestOk: ok });
}

/**
 * Config for a not-yet-saved form. Lets Settings list models and run a test
 * before anything is written to the database.
 */
export async function configFromDraft(userId, { provider, model, baseUrl, apiKey }) {
  let key = typeof apiKey === 'string' ? apiKey.trim() : '';

  // Blank key + same provider = "use the one I already saved".
  if (!key) {
    const saved = await AiSetting.findOne({ user: userId }).lean();
    if (saved?.provider === String(provider ?? '').toLowerCase()) {
      key = decryptSecret(saved.key ?? {}) ?? '';
    }
  }

  return resolveProviderConfig({ provider, apiKey: key, model, baseUrl });
}
