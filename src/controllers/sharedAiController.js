/**
 * The AI everyone falls back to when they have not set their own key.
 *
 * Same shape as a user's own settings so the Settings card can be reused,
 * but writing here changes the default for every account at once, which is
 * why it lives behind the admin guard.
 */
import { asyncHandler } from '../utils/asyncHandler.js';
import { publicCatalog } from '../ai/providers/index.js';
import { listModels, testConnection } from '../ai/llm.js';
import * as aiSettings from '../services/aiSettingsService.js';

const withCatalog = async () => ({ ...(await aiSettings.sharedStatus()), providers: publicCatalog() });

export const status = asyncHandler(async (_req, res) => {
  res.json(await withCatalog());
});

export const save = asyncHandler(async (req, res) => {
  await aiSettings.saveShared(req.body, req.user.email);
  res.json(await withCatalog());
});

export const clear = asyncHandler(async (_req, res) => {
  await aiSettings.clearShared();
  res.json(await withCatalog());
});

export const models = asyncHandler(async (req, res) => {
  const config = await aiSettings.configFromSharedDraft(req.body);
  const ids = await listModels(config);
  res.json({ models: ids.sort((a, b) => a.localeCompare(b)) });
});

/** Tested before it is inflicted on everyone, not after. */
export const test = asyncHandler(async (req, res) => {
  const config = await aiSettings.configFromSharedDraft(req.body);
  try {
    const result = await testConnection(config);
    await aiSettings.recordSharedTestResult(true);
    res.json({ ok: true, ...result });
  } catch (error) {
    await aiSettings.recordSharedTestResult(false);
    throw error;
  }
});
