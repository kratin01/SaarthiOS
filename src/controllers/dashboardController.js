/** The combined home dashboard payload, plus the insight agent's blocks. */
import { z } from 'zod';
import { asyncHandler } from '../utils/asyncHandler.js';
import { readPaging } from '../utils/paging.js';
import { DASHBOARD_PERIODS, getDashboard, getRecentActivity } from '../services/dashboardService.js';
import { getInsights, getInspiration } from '../services/overviewService.js';

export const refreshInsightsSchema = z.object({
  period: z.enum(DASHBOARD_PERIODS).default('today')
});

export const overview = asyncHandler(async (req, res) => {
  res.json(await getDashboard(req.user, req.query.period));
});

export const activity = asyncHandler(async (req, res) => {
  const { limit, offset } = readPaging(req.query, { defaultLimit: 8 });
  res.json(await getRecentActivity(req.user, { limit, offset }));
});

export const insights = asyncHandler(async (req, res) => {
  res.json(await getInsights(req.user, req.query.period));
});

export const refreshInsights = asyncHandler(async (req, res) => {
  res.json(await getInsights(req.user, req.body.period, { fresh: true }));
});

export const inspiration = asyncHandler(async (req, res) => {
  res.json(await getInspiration(req.user));
});

export const refreshInspiration = asyncHandler(async (req, res) => {
  res.json(await getInspiration(req.user, { fresh: true }));
});
