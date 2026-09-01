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
import { extractJson } from './json.js';

function requireProvider(config) {
  const provider = buildProvider(config, env.LLM_TIMEOUT_MS);
  if (!provider) {
    throw ApiError.unavailable(
      'AI is not set up yet. Add your provider and API key in Settings.',
      config?.reason
    );
  }
  return provider;
}

/** Plain text answer. */
export async function askText({ config, system, user, temperature, maxTokens }) {
  const provider = requireProvider(config);
  const started = Date.now();
  try {
    const text = await provider.complete({
      system,
      user,
      json: false,
      temperature: temperature ?? env.LLM_TEMPERATURE,
      maxTokens
    });
    logger.info(`llm text · ${provider.model} · ${Date.now() - started}ms`);
    recordSuccess('ai');
    return String(text).trim();
  } catch (error) {
    recordFailure('ai', error.message);
    throw error;
  }
}

/**
 * JSON answer, validated against a Zod schema.
 * One automatic retry: if the first reply does not fit the schema we tell the
 * model exactly what was wrong and ask again. After that we give up loudly.
 */
export async function askJson({ config, system, user, images, schema, temperature, maxTokens }) {
  const provider = requireProvider(config);
  let prompt = user;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const started = Date.now();
    let raw;
    try {
      raw = await provider.complete({
        system,
        user: prompt,
        images,
        json: true,
        temperature: temperature ?? env.LLM_TEMPERATURE,
        maxTokens
      });
      recordSuccess('ai');
    } catch (error) {
      recordFailure('ai', error.message);
      throw error;
    }
    logger.info(`llm json · ${provider.model} · attempt ${attempt} · ${Date.now() - started}ms`);

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
