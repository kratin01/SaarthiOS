import { Router } from 'express';
import * as review from '../controllers/reviewController.js';
import { requireAuth } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { chatLimiter } from '../middleware/rateLimit.js';

const router = Router();

router.use(requireAuth);
router.get('/', review.month);
// The story is cached per month, so only a forced rewrite counts against the AI limit.
router.get('/story', review.story);
router.post(
  '/story/refresh',
  chatLimiter,
  validateBody(review.refreshStorySchema),
  review.refreshStory
);

export default router;
