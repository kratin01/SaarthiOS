/**
 * An error that is safe to show the user.
 * Anything thrown that is NOT an ApiError is treated as a bug and hidden
 * behind a generic 500 by the error handler.
 */
export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
    this.expected = true;
  }

  static badRequest(message = 'Bad request', details) {
    return new ApiError(400, message, details);
  }

  static unauthorized(message = 'Not authenticated') {
    return new ApiError(401, message);
  }

  static forbidden(message = 'Not allowed') {
    return new ApiError(403, message);
  }

  static notFound(message = 'Not found') {
    return new ApiError(404, message);
  }

  static conflict(message = 'Already exists') {
    return new ApiError(409, message);
  }

  static unavailable(message = 'Service unavailable', details) {
    return new ApiError(503, message, details);
  }
}
