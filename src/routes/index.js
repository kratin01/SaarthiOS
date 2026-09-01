/** Mounts every feature router under a single `/api` prefix. */
import { Router } from 'express';
import authRoutes from './auth.routes.js';
import aiRoutes from './ai.routes.js';
import chatRoutes from './chat.routes.js';
import importRoutes from './import.routes.js';
import dashboardRoutes from './dashboard.routes.js';
import expenseRoutes from './expense.routes.js';
import healthRoutes from './health.routes.js';
import investmentRoutes from './investment.routes.js';
import customAgentRoutes from './customAgent.routes.js';
import { buildStatus } from '../services/statusService.js';
import { databaseState } from '../config/db.js';
import { ApiError } from '../utils/ApiError.js';
import { EXPENSE_CATEGORIES, MEAL_TYPES, INVESTMENT_TYPES } from '../config/constants.js';

const router = Router();

router.get('/health', (_req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

/**
 * Public on purpose: the sign-in page is exactly where someone needs to be told
 * the database is down, and nothing here is sensitive.
 */
router.get('/status', (_req, res) => res.json(buildStatus()));

/**
 * Everything below needs the database. Answering immediately with a sentence
 * beats letting each query hang for the driver's selection timeout and then
 * fail with something unreadable.
 */
router.use((_req, _res, next) => {
  const db = databaseState();
  // While the first connection is still in flight, let it through: Mongoose
  // buffers the query and runs it a moment later, which beats a cold-start 503.
  if (db.ready || db.connecting) return next();
  next(
    ApiError.unavailable(
      'We cannot reach the database right now, so nothing can be saved or loaded. Please try again in a few minutes.'
    )
  );
});

/** Lets the client build dropdowns without hardcoding the same lists twice. */
router.get('/meta', (_req, res) =>
  res.json({
    expenseCategories: EXPENSE_CATEGORIES,
    mealTypes: MEAL_TYPES,
    investmentTypes: INVESTMENT_TYPES
  })
);

router.use('/auth', authRoutes);
router.use('/ai', aiRoutes);
router.use('/chat', chatRoutes);
router.use('/import', importRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/expenses', expenseRoutes);
router.use('/meals', healthRoutes);
router.use('/investments', investmentRoutes);
router.use('/agents', customAgentRoutes);

export default router;
