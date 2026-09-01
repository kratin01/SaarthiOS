/**
 * Builds a provider adapter from an explicit config.
 *
 * This file used to read `.env` itself. It no longer does: the config arrives
 * from `aiSettingsService`, which prefers the key a user saved in Settings and
 * falls back to `.env`. That is what turns rotating a key into a settings
 * change rather than a redeploy.
 */
import { PROVIDER_CATALOG, PROVIDER_NAMES, publicCatalog } from './catalog.js';
import { createOpenAIProvider } from './openai.js';
import { createGeminiProvider } from './gemini.js';
import { createAnthropicProvider } from './anthropic.js';

const BUILDERS = {
  openai: createOpenAIProvider,
  gemini: createGeminiProvider,
  anthropic: createAnthropicProvider
};

/**
 * Fills in the provider's defaults and reports anything still missing.
 * Returns `{ ok: false, reason }` instead of throwing, so Settings can show the
 * reason rather than a request blowing up.
 */
export function resolveProviderConfig({ provider, apiKey = '', model = '', baseUrl = '' } = {}) {
  const name = String(provider ?? '').trim().toLowerCase();
  const preset = PROVIDER_CATALOG[name];

  if (!preset) {
    return {
      ok: false,
      name,
      label: name,
      model: '',
      reason: `Unknown provider "${name}". Use one of: ${PROVIDER_NAMES.join(', ')}.`
    };
  }

  const resolved = {
    name,
    kind: preset.kind,
    label: preset.label,
    baseUrl: String(baseUrl || preset.baseUrl).trim(),
    model: String(model || preset.model).trim(),
    apiKey: String(apiKey ?? '').trim(),
    keyOptional: Boolean(preset.keyOptional)
  };

  if (!resolved.apiKey && !preset.keyOptional) {
    return { ...resolved, ok: false, reason: 'No API key set.' };
  }
  if (!resolved.baseUrl) {
    return { ...resolved, ok: false, reason: 'No base URL set.' };
  }
  if (!resolved.model) {
    return { ...resolved, ok: false, reason: 'No model set.' };
  }

  return { ...resolved, ok: true, reason: null };
}

/** Returns an adapter, or null when the config is incomplete. */
export function buildProvider(config, timeoutMs) {
  if (!config?.ok) return null;
  return BUILDERS[config.kind]({
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    model: config.model,
    label: config.label,
    timeoutMs
  });
}

export { PROVIDER_CATALOG, PROVIDER_NAMES, publicCatalog };
