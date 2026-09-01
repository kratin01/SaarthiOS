import { Router } from 'express';
import * as investments from '../controllers/investmentController.js';
import { requireAuth } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { quoteLimiter } from '../middleware/rateLimit.js';

const router = Router();

router.use(requireAuth);
router.get('/', investments.list);
// Before `/:id` so "holdings" is not read as an id.
router.get('/holdings', quoteLimiter, investments.holdings);
router.post('/', validateBody(investments.createSchema), investments.create);
router.patch('/:id', validateBody(investments.updateSchema), investments.update);
router.delete('/:id', investments.remove);

export default router;
