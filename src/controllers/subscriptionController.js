/** Manual CRUD for subscriptions plus the running-cost summary. */
import { asyncHandler } from '../utils/asyncHandler.js';
import { subscriptionInputSchema, subscriptionUpdateSchema } from '../ai/schemas.js';
import { readPaging, pageInfo } from '../utils/paging.js';
import * as subscriptionService from '../services/subscriptionService.js';

export const createSchema = subscriptionInputSchema;
export const updateSchema = subscriptionUpdateSchema;

const STATUSES = ['all', 'active', 'cancelled'];

export const list = asyncHandler(async (req, res) => {
  const status = STATUSES.includes(req.query.status) ? req.query.status : 'all';
  const { limit, offset } = readPaging(req.query);

  const [result, summary] = await Promise.all([
    subscriptionService.listSubscriptions(req.user._id, { status, limit, offset }),
    subscriptionService.summariseSubscriptions(req.user._id)
  ]);

  res.json({
    items: result.items,
    summary,
    page: pageInfo({ limit, offset, total: result.total, count: result.items.length })
  });
});

export const create = asyncHandler(async (req, res) => {
  const subscription = await subscriptionService.createSubscription(req.user._id, req.body);
  res.status(201).json({ subscription: subscriptionService.describe(subscription.toObject()) });
});

export const update = asyncHandler(async (req, res) => {
  const subscription = await subscriptionService.updateSubscription(
    req.user._id,
    req.params.id,
    req.body
  );
  res.json({ subscription: subscriptionService.describe(subscription.toObject()) });
});

export const remove = asyncHandler(async (req, res) => {
  await subscriptionService.deleteSubscription(req.user._id, req.params.id);
  res.status(204).end();
});
