/** The combined home dashboard payload. */
import { asyncHandler } from '../utils/asyncHandler.js';
import { readPaging } from '../utils/paging.js';
import { getDashboard, getRecentActivity } from '../services/dashboardService.js';

export const overview = asyncHandler(async (req, res) => {
  res.json(await getDashboard(req.user, req.query.period));
});

export const activity = asyncHandler(async (req, res) => {
  const { limit, offset } = readPaging(req.query, { defaultLimit: 8 });
  res.json(await getRecentActivity(req.user, { limit, offset }));
});
