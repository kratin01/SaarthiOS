import { Router } from 'express';
import * as chat from '../controllers/chatController.js';
import { requireAuth } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { chatLimiter } from '../middleware/rateLimit.js';

const router = Router();

router.use(requireAuth);
router.get('/status', chat.aiStatus);
router.get('/conversations', chat.listConversations);
router.get('/conversations/:id', chat.getConversation);
router.delete('/conversations/:id', chat.deleteConversation);
router.post('/', chatLimiter, validateBody(chat.messageSchema), chat.sendMessage);

export default router;
