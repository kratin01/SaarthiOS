/**
 * The universal LLM controller.
 *
 * Nothing else in the codebase knows which provider is in use — agents and the
 * orchestrator only call `askText()` and `askJson()`, passing the config that
 * `aiSettingsService` resolved for the current user.
 */
import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';
import { logger } from '../utils/logger.js';
import { recordFailure, recordSuccess } from '../utils/serviceHealth.js';
import { buildProvider, resolveProviderConfig } from './providers/index.js';
import { PROVIDER_CATALOG } from './providers/catalog.js';
import { extractJson } from './json.js';

function requireProvider(config) {
  const provider = buildProvider(config, env.LLM_TIMEOUT_MS);
  if (!provider) {
    // The specific reason beats the generic sentence: telling someone to add a
    // key they have already pasted sends them looking in the wrong place.
    throw ApiError.unavailable(
      config?.reason ?? 'AI is not set up yet. Add your provider and API key in Settings.',
      config?.reason
    );
  }
  return provider;
}

/** Plain text answer. */
export async function askText({ config, system, user, temperature, maxTokens }) {
  requireProvider(config);
  const started = Date.now();
  try {
    const { text, model } = await completeWithFallback(config, {
      system,
      user,
      json: false,
      temperature: temperature ?? env.LLM_TEMPERATURE,
      maxTokens
    });
    logger.info(`llm text · ${model} · ${Date.now() - started}ms`);
    recordSuccess('ai');
    return String(text).trim();
  } catch (error) {
    recordFailure('ai', error.message);
    throw error;
  }
}

/**
 * The models to try, in order: the chosen one, then the provider's fallbacks.
 *
 * Only for providers whose model names we actually know. A custom endpoint or a
 * local Ollama could be serving anything, so guessing a name there would just
 * swap one failure for a more confusing one.
 */
function candidateModels(config) {
  const preset = PROVIDER_CATALOG[config?.name];
  return [...new Set([config?.model, ...(preset?.fallbacks ?? [])].filter(Boolean))];
}

/** Worth trying a different model for. A bad key or a rate limit is not. */
const isModelProblem = (error) => error?.providerStatus === 503 || error?.providerStatus === 404;

/**
 * Complete the request, moving to another model if this one cannot serve it.
 *
 * Models get overloaded and retired without warning, and someone who did not
 * choose the model has no way to know that is what happened. A 503 is retried
 * once on the same model first, since Google calls those spikes temporary.
 * Timeouts are never retried: the user has already waited the full window, and
 * doubling that is worse than failing.
 */
async function completeWithFallback(config, request) {
  const models = candidateModels(config);
  let lastError;

  for (const [index, model] of models.entries()) {
    const provider = requireProvider({ ...config, model });

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const text = await provider.complete(request);
        if (index > 0) logger.warn(`Answered with ${model} after ${models[0]} failed`);
        return { text, model };
      } catch (error) {
        lastError = error;
        if (!isModelProblem(error)) throw error;

        const canRetrySameModel = error.providerStatus === 503 && attempt === 1;
        if (!canRetrySameModel) break;

        logger.warn(`${model} is overloaded, retrying once`);
        await new Promise((resolve) => setTimeout(resolve, 1200));
      }
    }

    if (index < models.length - 1) logger.warn(`${model} unavailable, trying the next model`);
  }

  throw lastError;
}

/**
 * JSON answer, validated against a Zod schema.
 * One automatic retry: if the first reply does not fit the schema we tell the
 * model exactly what was wrong and ask again. After that we give up loudly.
 */
export async function askJson({ config, system, user, images, schema, temperature, maxTokens }) {
  // Surfaces a misconfiguration before any network call is attempted.
  requireProvider(config);
  let prompt = user;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const started = Date.now();
    let raw;
    let answeredBy = config.model;
    try {
      const result = await completeWithFallback(config, {
        system,
        user: prompt,
        images,
        json: true,
        temperature: temperature ?? env.LLM_TEMPERATURE,
        maxTokens
      });
      raw = result.text;
      answeredBy = result.model;
      recordSuccess('ai');
    } catch (error) {
      recordFailure('ai', error.message);
      throw error;
    }
    logger.info(`llm json · ${answeredBy} · attempt ${attempt} · ${Date.now() - started}ms`);

    const parsed = extractJson(raw);
    if (parsed) {
      const result = schema.safeParse(parsed);
      if (result.success) return result.data;

      if (attempt === 2) {
        logger.warn('llm json failed validation', JSON.stringify(result.error.issues).slice(0, 400));
        throw ApiError.unavailable('The AI response did not match the expected format.');
      }
      prompt = `${user}\n\nYour previous answer was rejected: ${describeIssues(result.error)}\nReply again with valid JSON only.`;
    } else {
      if (attempt === 2) {
        throw ApiError.unavailable('The AI did not return usable JSON.');
      }
      prompt = `${user}\n\nYour previous answer was not valid JSON. Reply with a single JSON object and nothing else.`;
    }
  }

  throw ApiError.unavailable('The AI did not return usable JSON.');
}

/** One tiny round trip, used by the "Test connection" button in Settings. */
export async function testConnection(config) {
  const provider = requireProvider(config);
  const started = Date.now();

  const reply = await provider.complete({
    system: 'You are a connection test. Reply with exactly: OK',
    user: 'Say OK.',
    json: false,
    temperature: 0,
    maxTokens: 16
  });

  return {
    model: provider.model,
    ms: Date.now() - started,
    reply: String(reply).trim().slice(0, 40)
  };
}

/** The model list for the chosen provider, fetched with the user's own key. */
export async function listModels(config) {
  const provider = requireProvider(config);
  if (typeof provider.listModels !== 'function') return [];
  return provider.listModels();
}

/** Whether the deployment ships a working default in `.env`. */
export const envLlmStatus = () =>
  resolveProviderConfig({
    provider: env.LLM_PROVIDER,
    apiKey: env.LLM_API_KEY,
    model: env.LLM_MODEL,
    baseUrl: env.LLM_BASE_URL
  });

const describeIssues = (error) =>
  error.issues
    .slice(0, 5)
    .map((i) => `${i.path.join('.') || 'root'} — ${i.message}`)
    .join('; ');
