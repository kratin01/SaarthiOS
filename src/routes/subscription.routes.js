import { Router } from 'express';
import * as subscriptions from '../controllers/subscriptionController.js';
import { requireAuth } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';

const router = Router();

router.use(requireAuth);
router.get('/', subscriptions.list);
router.post('/', validateBody(subscriptions.createSchema), subscriptions.create);
router.patch('/:id', validateBody(subscriptions.updateSchema), subscriptions.update);
router.delete('/:id', subscriptions.remove);

export default router;
