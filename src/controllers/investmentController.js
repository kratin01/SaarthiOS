/** Manual CRUD for investments and the portfolio summary. */
import { asyncHandler } from '../utils/asyncHandler.js';
import { investmentInputSchema, investmentUpdateSchema } from '../ai/schemas.js';
import { readPaging, pageInfo } from '../utils/paging.js';
import * as investmentService from '../services/investmentService.js';

export const createSchema = investmentInputSchema;
export const updateSchema = investmentUpdateSchema;

export const list = asyncHandler(async (req, res) => {
  const { range = 'year', type } = req.query;
  const { limit, offset } = readPaging(req.query);

  const [result, summary] = await Promise.all([
    investmentService.listInvestments(req.user._id, { range, type, limit, offset }),
    investmentService.summariseInvestments(req.user._id, range)
  ]);

  res.json({
    items: result.items,
    summary,
    page: pageInfo({ limit, offset, total: result.total, count: result.items.length })
  });
});

export const create = asyncHandler(async (req, res) => {
  const investment = await investmentService.createInvestment(req.user._id, req.body);
  res.status(201).json({ investment });
});

export const remove = asyncHandler(async (req, res) => {
  await investmentService.deleteInvestment(req.user._id, req.params.id);
  res.status(204).end();
});

export const update = asyncHandler(async (req, res) => {
  const investment = await investmentService.updateInvestment(req.user._id, req.params.id, req.body);
  res.json({ investment });
});

/** Live prices and profit/loss for holdings that have a unit count. */
export const holdings = asyncHandler(async (req, res) => {
  const { range = 'all' } = req.query;
  const result = await investmentService.valueHoldings(req.user._id, {
    range,
    currency: req.user.currency
  });
  res.json(result);
});
