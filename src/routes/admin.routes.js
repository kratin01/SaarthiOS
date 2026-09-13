import { Router } from 'express';
import * as admin from '../controllers/adminController.js';
import * as sharedAi from '../controllers/sharedAiController.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { authLimiter, chatLimiter } from '../middleware/rateLimit.js';
import { validateBody } from '../middleware/validate.js';
import { saveSchema, draftSchema } from '../controllers/aiSettingsController.js';

const router = Router();

// The tightest limiter in the app: this is the one route that reads across
// every account, so it should be the least worth probing.
router.use(authLimiter, requireAuth, requireAdmin);
router.get('/overview', admin.overview);

router.get('/ai', sharedAi.status);
router.put('/ai', validateBody(saveSchema), sharedAi.save);
router.delete('/ai', sharedAi.clear);
// These reach the provider, so they share the chat limiter rather than sitting
// behind a limit meant for cheap local reads.
router.post('/ai/models', chatLimiter, validateBody(draftSchema), sharedAi.models);
router.post('/ai/test', chatLimiter, validateBody(draftSchema), sharedAi.test);

export default router;
