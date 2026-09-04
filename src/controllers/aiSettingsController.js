/**
 * The AI provider settings screen.
 *
 * The API key only ever travels one way — browser to server. Responses carry a
 * hint like `AQ.Ab…5xKq` so a user can recognise which key is saved, never the
 * key itself.
 */
import { z } from 'zod';
import { asyncHandler } from '../utils/asyncHandler.js';
import { publicCatalog, PROVIDER_NAMES } from '../ai/providers/index.js';
import { listModels, testConnection } from '../ai/llm.js';
import * as aiSettings from '../services/aiSettingsService.js';

const providerEnum = z.enum(PROVIDER_NAMES);

export const saveSchema = z.object({
  provider: providerEnum,
  model: z.string().trim().max(120).default(''),
  baseUrl: z.string().trim().max(300).default(''),
  /** Omit to keep the stored key — lets a user change model without re-pasting. */
  apiKey: z.string().max(500).optional()
});

export const draftSchema = z.object({
  provider: providerEnum,
  model: z.string().trim().max(120).optional(),
  baseUrl: z.string().trim().max(300).optional(),
  apiKey: z.string().max(500).optional()
});

/** Current status plus everything the dropdowns need. */
export const status = asyncHandler(async (req, res) => {
  res.json(await fullStatus(req.user._id));
});

export const save = asyncHandler(async (req, res) => {
  await aiSettings.saveForUser(req.user._id, req.body);
  res.json(await fullStatus(req.user._id));
});

export const clear = asyncHandler(async (req, res) => {
  await aiSettings.clearForUser(req.user._id);
  res.json(await fullStatus(req.user._id));
});

/**
 * Every route that returns settings returns the same shape, catalogue included.
 * Saving used to answer without `providers`, and a client that trusted the
 * response lost the list it renders the form from.
 */
async function fullStatus(userId) {
  return { ...(await aiSettings.statusForUser(userId)), providers: publicCatalog() };
}

/** Lists the models the given key can actually use. */
export const models = asyncHandler(async (req, res) => {
  const config = await aiSettings.configFromDraft(req.user._id, req.body);
  const ids = await listModels(config);
  res.json({ models: ids.sort((a, b) => a.localeCompare(b)) });
});

/** One small live call, so problems surface here instead of mid-conversation. */
export const test = asyncHandler(async (req, res) => {
  const config = await aiSettings.configFromDraft(req.user._id, req.body);
  try {
    const result = await testConnection(config);
    await aiSettings.recordTestResult(req.user._id, true);
    res.json({ ok: true, ...result });
  } catch (error) {
    await aiSettings.recordTestResult(req.user._id, false);
    throw error;
  }
});
