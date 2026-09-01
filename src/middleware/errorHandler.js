/**
 * The last middleware in the chain.
 * Known problems (ApiError, Mongoose validation, duplicate key) become clear
 * messages. Everything else becomes a generic 500 — the details go to the log,
 * never to the client.
 */
import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';
import { logger } from '../utils/logger.js';

export function notFound(req, _res, next) {
  next(ApiError.notFound(`No route for ${req.method} ${req.path}`));
}

// eslint-disable-next-line no-unused-vars -- Express needs all four arguments.
export function errorHandler(err, _req, res, _next) {
  let status = err.status ?? 500;
  let message = err.message ?? 'Something went wrong';
  let details = err.details;

  if (err.name === 'ValidationError') {
    status = 400;
    message = 'Please check the submitted fields';
    details = Object.values(err.errors).map((e) => ({ field: e.path, message: e.message }));
  } else if (err.code === 11000) {
    status = 409;
    const field = Object.keys(err.keyPattern ?? {})[0];
    message = field ? `That ${field} is already in use` : 'That value is already in use';
  } else if (err.name === 'CastError') {
    status = 400;
    message = 'Invalid id';
  }

  // `expected` marks an ApiError we raised on purpose — no stack trace needed.
  if (status >= 500 && !err.expected) {
    logger.error(err.stack ?? err.message);
    if (env.isProd) {
      message = 'Something went wrong';
      details = undefined;
    }
  }

  res.status(status).json({ error: { message, details } });
}
