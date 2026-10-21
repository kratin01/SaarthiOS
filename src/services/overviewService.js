/**
 * The AI blocks on the Overview: the insight agent's insights and the
 * inspiration card.
 *
 * Each is written at most once a day per user and kept in `DailyBrief`, so the
 * Overview stays quick and does not spend AI quota on every visit. The refresh
 * buttons ask for a new one. When the AI cannot run, insights fall back to the
 * dashboard's arithmetic checks.
 */
import { DailyBrief } from '../models/index.js';
import { DASHBOARD_PERIODS, getDashboard } from './dashboardService.js';
import { resolveForUser } from './aiSettingsService.js';
import { writeInsights, writeInspiration } from '../ai/agents/insightAgent.js';
import { ApiError } from '../utils/ApiError.js';
import { logger } from '../utils/logger.js';
import { toDateKey } from '../utils/dates.js';

/** How many past inspiration lines the agent is told not to repeat. */
const RECENT_LINES = 12;

export async function getInsights(user, period, { fresh = false } = {}) {
  const window = DASHBOARD_PERIODS.includes(period) ? period : 'today';
  const slot = `insights:${window}`;
  const day = toDateKey(new Date());

  if (!fresh) {
    const cached = await DailyBrief.findOne({ user: user._id, slot, day }).lean();
    if (cached?.content) return cached.content;
  }

  const dashboard = await getDashboard(user, window);
  const fallback = (notice) => ({
    source: 'rules',
    period: window,
    insights: dashboard.insights.map((insight) => ({ ...insight, link: null })),
    generatedAt: new Date(),
    notice
  });

  const config = await resolveForUser(user._id);
  if (!config.ok) {
    return fallback('Add an AI provider in Settings for personal insights. These are quick checks.');
  }

  try {
    const insights = await writeInsights({ user, period: window, dashboard, config });
    if (!insights.length) return fallback('');

    const content = { source: 'ai', period: window, insights, generatedAt: new Date(), notice: '' };
    await DailyBrief.updateOne({ user: user._id, slot }, { $set: { day, content } }, { upsert: true });
    return content;
  } catch (error) {
    logger.warn(`overview insights fell back to rules · ${error.message}`);
    return fallback('The insight agent could not answer just now, so these are quick checks.');
  }
}

/**
 * Today's line, or a new one when `fresh`. A line written earlier today is kept
 * even if the kind has changed since: the web asks for a fresh one when the
 * picker changes, which keeps plain page loads to one AI call a day.
 */
export async function getInspiration(user, { fresh = false } = {}) {
  const day = toDateKey(new Date());
  const cached = await DailyBrief.findOne({ user: user._id, slot: 'inspiration' }).lean();
  if (!fresh && cached?.day === day && cached.content) return cached.content;

  const config = await resolveForUser(user._id);
  if (!config.ok) {
    throw ApiError.unavailable('Add an AI provider in Settings to get a new line every day.');
  }

  const kind = user.inspirationKind ?? 'affirmation';
  const line = await writeInspiration({ user, kind, recent: cached?.recent ?? [], config });
  const content = { requested: kind, ...line, generatedAt: new Date() };

  await DailyBrief.updateOne(
    { user: user._id, slot: 'inspiration' },
    {
      $set: { day, content },
      $push: { recent: { $each: [line.text.slice(0, 200)], $slice: -RECENT_LINES } }
    },
    { upsert: true }
  );
  return content;
}
