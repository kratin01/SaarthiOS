import { Router } from 'express';
import * as admin from '../controllers/adminController.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { authLimiter } from '../middleware/rateLimit.js';

const router = Router();

// The tightest limiter in the app: this is the one route that reads across
// every account, so it should be the least worth probing.
router.use(authLimiter, requireAuth, requireAdmin);
router.get('/overview', admin.overview);

export default router;
