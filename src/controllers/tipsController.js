/** The "Tips" button: one AI pass over a screen's real numbers. */
import { z } from 'zod';
import { asyncHandler } from '../utils/asyncHandler.js';
import { generateTips } from '../ai/tips.js';

export const tipsSchema = z.object({
  /** A built-in domain or one of the user's own agent slugs. */
  domain: z.string().min(1).max(40),
  range: z.enum(['today', 'week', 'month', 'last_month', 'year', 'all']).default('month')
});

export const tips = asyncHandler(async (req, res) => {
  const result = await generateTips({
    user: req.user,
    domain: req.body.domain,
    range: req.body.range
  });
  res.json(result);
});
