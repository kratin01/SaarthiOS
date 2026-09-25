/** Manual CRUD for expenses (the chat path goes through the orchestrator). */
import { asyncHandler } from '../utils/asyncHandler.js';
import { expenseInputSchema, expenseUpdateSchema } from '../ai/schemas.js';
import { readPaging, pageInfo } from '../utils/paging.js';
import { readRange } from '../utils/range.js';
import { sendWorkbook } from '../utils/excel.js';
import * as expenseService from '../services/expenseService.js';
import * as reportService from '../services/reportService.js';

export const createSchema = expenseInputSchema;
export const updateSchema = expenseUpdateSchema;

export const list = asyncHandler(async (req, res) => {
  const { category } = req.query;
  const range = readRange(req.query.range);
  const { limit, offset } = readPaging(req.query);

  const [result, summary] = await Promise.all([
    expenseService.listExpenses(req.user._id, { range, category, limit, offset }),
    expenseService.summariseExpenses(req.user._id, range)
  ]);

  res.json({
    items: result.items,
    summary,
    page: pageInfo({ limit, offset, total: result.total, count: result.items.length })
  });
});

export const create = asyncHandler(async (req, res) => {
  const expense = await expenseService.createExpense(req.user._id, req.body);
  res.status(201).json({ expense });
});

/** The same window the screen is showing, as a spreadsheet. */
export const report = asyncHandler(async (req, res) => {
  const range = readRange(req.query.range);
  const { filename, buffer } = await reportService.buildExpenseReport(req.user, range);
  sendWorkbook(res, filename, buffer);
});

export const remove = asyncHandler(async (req, res) => {
  await expenseService.deleteExpense(req.user._id, req.params.id);
  res.status(204).end();
});

export const update = asyncHandler(async (req, res) => {
  const expense = await expenseService.updateExpense(req.user._id, req.params.id, req.body);
  res.json({ expense });
});
