/**
 * Where each user's AI provider settings live.
 *
 * Resolution order for every AI call:
 *   1. What the user saved in Settings   ← rotating a key is a UI action
 *   2. The shared default an admin set   ← changing it for everyone, no deploy
 *   3. The `.env` values                 ← a default for a fresh deployment
 *
 * The key itself is encrypted in MongoDB and is never returned to the browser —
 * Settings only ever sees a hint like `AQ.Ab…5xKq`.
 */
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { AiSetting } from '../models/AiSetting.js';
import { GlobalAiSetting } from '../models/GlobalAiSetting.js';
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
 *
 * Three places it can come from, most specific first: the user's own key, the
 * shared default an admin set, then `.env`. `source` tells the UI which won.
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

  const shared = await GlobalAiSetting.findOne({ scope: 'default' }).lean();
  if (shared?.provider) {
    const config = sharedConfig(shared);
    // Only used when it actually works, so a broken shared default falls
    // through to `.env` rather than taking everyone down with it.
    if (config.ok) return { ...config, source: 'shared' };
  }

  return { ...resolveProviderConfig(envConfig()), source: 'env' };
}

const sharedConfig = (shared) =>
  resolveProviderConfig({
    provider: shared.provider,
    apiKey: decryptSecret(shared.key ?? {}) ?? '',
    model: shared.model,
    baseUrl: shared.baseUrl
  });

/**
 * The config to turn a voice note into text with.
 *
 * Deliberately not whatever `resolveForUser` returns. Transcription is
 * plumbing rather than a personal preference, and most chat providers cannot
 * do it at all — choosing OpenRouter to answer questions should not cost you
 * the microphone. So this walks the same three places and takes the first one
 * that can actually hear.
 */
export async function resolveTranscriber(userId) {
  const candidates = [await resolveForUser(userId)];

  const shared = await GlobalAiSetting.findOne({ scope: 'default' }).lean();
  if (shared?.provider) candidates.push({ ...sharedConfig(shared), source: 'shared' });

  candidates.push({ ...resolveProviderConfig(envConfig()), source: 'env' });

  return candidates.find((config) => config.ok && config.audio) ?? candidates[0];
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

/* ── the shared default ───────────────────────────────────────────────── */

/** Status of the default everyone without their own key falls back to. */
export async function sharedStatus() {
  const saved = await GlobalAiSetting.findOne({ scope: 'default' }).lean();
  const config = saved?.provider
    ? resolveProviderConfig({
        provider: saved.provider,
        apiKey: decryptSecret(saved.key ?? {}) ?? '',
        model: saved.model,
        baseUrl: saved.baseUrl
      })
    : resolveProviderConfig(envConfig());

  return {
    configured: config.ok,
    provider: config.name,
    label: config.label ?? config.name,
    model: config.model ?? '',
    source: saved?.provider ? 'shared' : 'env',
    reason: config.ok ? null : config.reason,
    keyHint: saved?.keyHint ?? '',
    baseUrl: saved?.baseUrl ?? '',
    updatedBy: saved?.updatedBy ?? '',
    updatedAt: saved?.updatedAt ?? null,
    lastTestedAt: saved?.lastTestedAt ?? null,
    lastTestOk: saved?.lastTestOk ?? null,
    envFallbackAvailable: resolveProviderConfig(envConfig()).ok,
    /** How many accounts this actually governs right now. */
    usersOnDefault: await countUsersOnDefault()
  };
}

const countUsersOnDefault = async () => {
  const [total, withOwnKey] = await Promise.all([
    mongoose.model('User').countDocuments(),
    AiSetting.countDocuments()
  ]);
  return Math.max(0, total - withOwnKey);
};

export async function saveShared({ provider, model = '', baseUrl = '', apiKey }, changedBy = '') {
  const preset = PROVIDER_CATALOG[String(provider ?? '').toLowerCase()];
  if (!preset) throw ApiError.badRequest('Unknown provider');

  const existing = await GlobalAiSetting.findOne({ scope: 'default' });
  const update = {
    scope: 'default',
    provider: provider.toLowerCase(),
    model: model.trim(),
    baseUrl: baseUrl.trim(),
    updatedBy: changedBy
  };

  if (typeof apiKey === 'string' && apiKey.trim()) {
    update.key = encryptSecret(apiKey.trim());
    update.keyHint = maskSecret(apiKey.trim());
    update.lastTestedAt = null;
    update.lastTestOk = null;
  } else if (!existing?.key?.ciphertext && !preset.keyOptional) {
    throw ApiError.badRequest(`${preset.label} needs an API key.`);
  }

  await GlobalAiSetting.findOneAndUpdate({ scope: 'default' }, update, {
    new: true,
    upsert: true,
    setDefaultsOnInsert: true
  });

  return sharedStatus();
}

/** Drops the shared default, so everyone falls back to `.env` again. */
export async function clearShared() {
  await GlobalAiSetting.deleteOne({ scope: 'default' });
  return sharedStatus();
}

export async function recordSharedTestResult(ok) {
  await GlobalAiSetting.updateOne({ scope: 'default' }, { lastTestedAt: new Date(), lastTestOk: ok });
}

/** Same "blank key means keep the saved one" rule as a user's form. */
export async function configFromSharedDraft({ provider, model, baseUrl, apiKey }) {
  let key = typeof apiKey === 'string' ? apiKey.trim() : '';

  if (!key) {
    const saved = await GlobalAiSetting.findOne({ scope: 'default' }).lean();
    if (saved?.provider === String(provider ?? '').toLowerCase()) {
      key = decryptSecret(saved.key ?? {}) ?? '';
    }
  }

  return resolveProviderConfig({ provider, apiKey: key, model, baseUrl });
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
