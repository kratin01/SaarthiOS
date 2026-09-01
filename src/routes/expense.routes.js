import { Router } from 'express';
import * as expenses from '../controllers/expenseController.js';
import { requireAuth } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';

const router = Router();

router.use(requireAuth);
router.get('/', expenses.list);
router.post('/', validateBody(expenses.createSchema), expenses.create);
router.patch('/:id', validateBody(expenses.updateSchema), expenses.update);
router.delete('/:id', expenses.remove);

export default router;
