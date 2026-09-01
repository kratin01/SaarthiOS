/**
 * The "Tips" button behind every screen.
 *
 * Same contract as the analyst: real numbers are read from MongoDB first and
 * the model only reasons about them. It cannot see or write the database.
 */
import { askJson } from './llm.js';
import { tipsSchema } from './schemas.js';
import { buildTipsPrompt } from './prompts.js';
import { collectFacts } from './facts.js';
import { resolveForUser } from '../services/aiSettingsService.js';
import * as customAgentService from '../services/customAgentService.js';
import { ApiError } from '../utils/ApiError.js';
import { toDateKey } from '../utils/dates.js';

const BUILT_IN = {
  expense: 'spending',
  health: 'food and nutrition',
  investment: 'investment'
};

export async function generateTips({ user, domain, range = 'month' }) {
  const config = await resolveForUser(user._id);

  let subject = BUILT_IN[domain];
  let customDefinitions = [];

  if (!subject) {
    // Anything not built in has to be one of this user's own agents.
    const agent = await customAgentService.getAgentBySlug(user._id, domain).catch(() => null);
    if (!agent) throw ApiError.notFound('Nothing to give tips about');
    subject = agent.name;
    customDefinitions = [agent];
  }

  const facts = await collectFacts({
    userId: user._id,
    domains: [domain],
    range,
    customDefinitions
  });

  const result = await askJson({
    config,
    system: buildTipsPrompt({ today: toDateKey(new Date()), currency: user.currency, subject }),
    user: `Data:\n${JSON.stringify(facts, null, 2)}`,
    schema: tipsSchema
  });

  return { ...result, range, domain };
}
