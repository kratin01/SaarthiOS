/**
 * Wraps an async route handler so a rejected promise reaches Express'
 * error middleware. Saves a try/catch in every controller.
 */
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
