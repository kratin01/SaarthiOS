import { Router } from 'express';
import * as meals from '../controllers/healthController.js';
import { requireAuth } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';

const router = Router();

router.use(requireAuth);
router.get('/', meals.list);
router.post('/', validateBody(meals.createSchema), meals.create);
router.patch('/:id', validateBody(meals.updateSchema), meals.update);
router.delete('/:id', meals.remove);

export default router;
