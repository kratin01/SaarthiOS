/**
 * Runs a Zod schema over `req.body` (or query) and replaces it with the parsed
 * result, so controllers always receive clean, typed data.
 */
import { ApiError } from '../utils/ApiError.js';

export const validateBody = (schema) => (req, _res, next) => {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    return next(ApiError.badRequest('Please check the submitted fields', formatIssues(result.error)));
  }
  req.body = result.data;
  next();
};

const formatIssues = (error) =>
  error.issues.map((issue) => ({
    field: issue.path.join('.') || 'body',
    message: issue.message
  }));
