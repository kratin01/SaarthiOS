/** Verifies the `Authorization: Bearer <token>` header and loads the user. */
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { User } from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const requireAuth = asyncHandler(async (req, _res, next) => {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;

  if (!token) throw ApiError.unauthorized('Sign in to continue');

  let payload;
  try {
    payload = jwt.verify(token, env.JWT_SECRET);
  } catch {
    throw ApiError.unauthorized('Session expired. Please sign in again.');
  }

  const user = await User.findById(payload.sub);
  if (!user) throw ApiError.unauthorized('Account no longer exists');

  req.user = user;
  next();
});

export const signToken = (user) =>
  jwt.sign({ sub: String(user._id) }, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN });

/** Checked against the verified session, never against anything the client sent. */
export const isAdmin = (user) =>
  Boolean(user?.email) && env.adminEmails.includes(user.email.toLowerCase());

export const requireAdmin = asyncHandler(async (req, _res, next) => {
  // Not found rather than forbidden: a 403 confirms the dashboard is there.
  if (!isAdmin(req.user)) throw ApiError.notFound('Not found');
  next();
});
