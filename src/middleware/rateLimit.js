/**
 * Request limits.
 * `apiLimiter` protects the whole API, `authLimiter` slows down password
 * guessing, `chatLimiter` keeps AI spend predictable, and `quoteLimiter` keeps
 * us a polite client of the free price provider.
 */
import rateLimit from 'express-rate-limit';

const base = {
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { message: 'Too many requests. Please slow down.' } }
};

export const apiLimiter = rateLimit({ ...base, windowMs: 60_000, limit: 200 });

export const authLimiter = rateLimit({
  ...base,
  windowMs: 15 * 60_000,
  limit: 20,
  message: { error: { message: 'Too many attempts. Try again in a few minutes.' } }
});

export const chatLimiter = rateLimit({
  ...base,
  windowMs: 60_000,
  limit: 20,
  message: { error: { message: 'Give the agents a moment — too many messages at once.' } }
});

export const quoteLimiter = rateLimit({
  ...base,
  windowMs: 60_000,
  limit: 15,
  message: { error: { message: 'Checking prices too often. Try again in a minute.' } }
});
