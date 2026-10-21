import { Router } from 'express';
import * as dashboard from '../controllers/dashboardController.js';
import { requireAuth } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { chatLimiter } from '../middleware/rateLimit.js';

const router = Router();

router.use(requireAuth);
router.get('/', dashboard.overview);
router.get('/activity', dashboard.activity);
// Plain reads are cached for the day; only the refresh buttons are AI-limited.
router.get('/insights', dashboard.insights);
router.post(
  '/insights/refresh',
  chatLimiter,
  validateBody(dashboard.refreshInsightsSchema),
  dashboard.refreshInsights
);
router.get('/inspiration', dashboard.inspiration);
router.post('/inspiration/refresh', chatLimiter, dashboard.refreshInspiration);

export default router;
