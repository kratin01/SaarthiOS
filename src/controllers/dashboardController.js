/** The combined home dashboard payload. */
import { asyncHandler } from '../utils/asyncHandler.js';
import { getDashboard } from '../services/dashboardService.js';

export const overview = asyncHandler(async (req, res) => {
  res.json(await getDashboard(req.user, req.query.period));
});
