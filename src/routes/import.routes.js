import { Router } from 'express';
import * as imports from '../controllers/importController.js';
import { requireAuth } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { singleDocument } from '../middleware/upload.js';
import { chatLimiter } from '../middleware/rateLimit.js';

const router = Router();

router.use(requireAuth);

// Reading a document is an AI call, so it shares the chat rate limit.
router.post('/extract', chatLimiter, singleDocument, imports.extract);
router.post('/confirm', validateBody(imports.confirmSchema), imports.confirm);

export default router;
