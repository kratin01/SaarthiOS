/** Operator view. Aggregates only, and never anything a user wrote. */
import { asyncHandler } from '../utils/asyncHandler.js';
import { readPaging } from '../utils/paging.js';
import { getAdminOverview } from '../services/adminService.js';

export const overview = asyncHandler(async (req, res) => {
  const days = Math.min(Math.max(Number.parseInt(req.query.days, 10) || 30, 7), 90);
  const { limit, offset } = readPaging(req.query);
  const sort = req.query.sort === 'joined' ? 'joined' : 'active';
  res.json(await getAdminOverview({ days, limit, offset, sort }));
});
