/** Manual CRUD for meals and the nutrition summary. */
import { asyncHandler } from '../utils/asyncHandler.js';
import { mealInputSchema, mealUpdateSchema } from '../ai/schemas.js';
import { readPaging, pageInfo } from '../utils/paging.js';
import * as healthService from '../services/healthService.js';

export const createSchema = mealInputSchema;
export const updateSchema = mealUpdateSchema;

export const list = asyncHandler(async (req, res) => {
  const { range = 'week' } = req.query;
  const { limit, offset } = readPaging(req.query);

  const [result, summary] = await Promise.all([
    healthService.listMeals(req.user._id, { range, limit, offset }),
    healthService.summariseNutrition(req.user._id, range)
  ]);

  res.json({
    items: result.items,
    summary,
    page: pageInfo({ limit, offset, total: result.total, count: result.items.length })
  });
});

export const create = asyncHandler(async (req, res) => {
  const meal = await healthService.createMeal(req.user._id, req.body);
  res.status(201).json({ meal });
});

export const remove = asyncHandler(async (req, res) => {
  await healthService.deleteMeal(req.user._id, req.params.id);
  res.status(204).end();
});

export const update = asyncHandler(async (req, res) => {
  const meal = await healthService.updateMeal(req.user._id, req.params.id, req.body);
  res.json({ meal });
});
