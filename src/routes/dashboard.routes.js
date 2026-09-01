import { Router } from 'express';
import * as dashboard from '../controllers/dashboardController.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);
router.get('/', dashboard.overview);

export default router;
