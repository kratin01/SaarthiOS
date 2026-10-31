/** Month in review: the numbers, and the insight agent's write-up of them. */
import { z } from 'zod';
import { asyncHandler } from '../utils/asyncHandler.js';
import { getMonthReview, getReviewStory } from '../services/reviewService.js';

export const refreshStorySchema = z.object({
  month: z.string().trim().max(7).optional()
});

export const month = asyncHandler(async (req, res) => {
  res.json(await getMonthReview(req.user, req.query.month));
});

export const story = asyncHandler(async (req, res) => {
  res.json(await getReviewStory(req.user, req.query.month));
});

export const refreshStory = asyncHandler(async (req, res) => {
  res.json(await getReviewStory(req.user, req.body.month, { fresh: true }));
});
