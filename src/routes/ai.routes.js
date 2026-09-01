import { Router } from 'express';
import * as ai from '../controllers/aiSettingsController.js';
import * as insights from '../controllers/tipsController.js';
import { requireAuth } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { chatLimiter } from '../middleware/rateLimit.js';

const router = Router();

router.use(requireAuth);
router.get('/settings', ai.status);
router.put('/settings', validateBody(ai.saveSchema), ai.save);
router.delete('/settings', ai.clear);

// Both make a live call to the provider, so they share the chat rate limit.
router.post('/models', chatLimiter, validateBody(ai.draftSchema), ai.models);
router.post('/test', chatLimiter, validateBody(ai.draftSchema), ai.test);

router.post('/tips', chatLimiter, validateBody(insights.tipsSchema), insights.tips);

export default router;
