import { Router } from 'express';
import * as connections from '../controllers/connectionController.js';
import { requireAuth } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { chatLimiter } from '../middleware/rateLimit.js';

const router = Router();

router.use(requireAuth);
router.get('/', connections.list);
// Both call the app's servers, so they share the chat rate limit.
router.post('/complete', chatLimiter, validateBody(connections.completeSchema), connections.complete);
router.post('/:app/start', chatLimiter, validateBody(connections.startSchema), connections.start);
router.delete('/:app', connections.disconnect);

export default router;
