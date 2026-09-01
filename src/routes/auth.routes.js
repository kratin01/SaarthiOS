import { Router } from 'express';
import * as auth from '../controllers/authController.js';
import { requireAuth } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { authLimiter } from '../middleware/rateLimit.js';

const router = Router();

router.get('/providers', auth.providers);
router.post('/register', authLimiter, validateBody(auth.registerSchema), auth.register);
router.post('/login', authLimiter, validateBody(auth.loginSchema), auth.login);
router.post('/google', authLimiter, validateBody(auth.googleSchema), auth.googleSignIn);
router.get('/me', requireAuth, auth.me);
router.patch('/me', requireAuth, validateBody(auth.updateProfileSchema), auth.updateProfile);
router.post(
  '/me/body-targets',
  requireAuth,
  validateBody(auth.bodyTargetsSchema),
  auth.bodyTargets
);

export default router;
