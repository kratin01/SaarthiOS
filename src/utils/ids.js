/**
 * Mongoose casts `find()` filters automatically but not aggregation pipelines,
 * so every `$match` on a user id goes through this helper.
 */
import mongoose from 'mongoose';
import { ApiError } from './ApiError.js';

export function toObjectId(value) {
  if (value instanceof mongoose.Types.ObjectId) return value;
  if (mongoose.Types.ObjectId.isValid(value)) return new mongoose.Types.ObjectId(String(value));
  throw ApiError.badRequest('Invalid id');
}
