/**
 * Reads a `?range=` query param.
 *
 * It throws rather than falling back to a default on purpose: a silent fallback
 * answers a question nobody asked. Ask for August, get "this month" back, and
 * the numbers look real — which is a far worse failure than an error message.
 */
import { RANGES } from '../config/constants.js';
import { isMonthRange } from './dates.js';
import { ApiError } from './ApiError.js';

export function readRange(value, fallback = 'month') {
  if (value === undefined || value === '') return fallback;

  const range = String(value);
  if (RANGES.includes(range) || isMonthRange(range)) return range;

  throw ApiError.badRequest(`"${range}" is not a period I can show`);
}
