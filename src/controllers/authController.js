/** Register, sign in, read and update the signed-in account. */
import { z } from 'zod';
import { User } from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { signToken } from '../middleware/auth.js';
import { googleStatus, verifyGoogleToken } from '../services/googleAuthService.js';
import { computeBodyTargets } from '../services/bodyProfileService.js';
import { BODY_GOALS } from '../config/constants.js';

export const registerSchema = z.object({
  name: z.string().trim().min(2, 'Name is too short').max(80),
  email: z.string().trim().toLowerCase().email('Enter a valid email'),
  password: z.string().min(8, 'Use at least 8 characters').max(128)
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email'),
  password: z.string().min(1, 'Password is required')
});

export const updateProfileSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  currency: z.string().trim().min(1).max(8).optional(),
  monthlyBudget: z.coerce.number().min(0).nullable().optional(),
  dailyCalorieGoal: z.coerce.number().min(0).max(20000).optional(),
  dailyProteinGoal: z.coerce.number().min(0).max(1000).optional(),
  heightCm: z.coerce.number().min(50).max(260).nullable().optional(),
  weightKg: z.coerce.number().min(20).max(400).nullable().optional(),
  bodyGoal: z.enum(BODY_GOALS).optional()
});

/** Preview only — nothing is saved until the user accepts the numbers. */
export const bodyTargetsSchema = z.object({
  heightCm: z.coerce.number().min(50).max(260),
  weightKg: z.coerce.number().min(20).max(400),
  bodyGoal: z.enum(BODY_GOALS).default('normal')
});

export const googleSchema = z.object({
  credential: z.string().min(1, 'Missing Google credential').max(4000)
});

export const register = asyncHandler(async (req, res) => {
  const { name, email, password } = req.body;

  const existing = await User.findOne({ email }).select('+passwordHash');
  if (existing) {
    throw ApiError.conflict(
      existing.googleId && !existing.passwordHash
        ? 'That email is already registered with Google. Use "Continue with Google".'
        : 'An account with that email already exists'
    );
  }

  const user = await User.create({
    name,
    email,
    passwordHash: await User.hashPassword(password)
  });

  res.status(201).json({ token: signToken(user), user: user.toJSON() });
});

export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const user = await User.findOne({ email }).select('+passwordHash');

  if (user && !user.passwordHash) {
    throw ApiError.unauthorized('This account uses Google sign-in. Use "Continue with Google".');
  }
  // Same message for both cases so the response cannot confirm which emails exist.
  if (!user || !(await user.verifyPassword(password))) {
    throw ApiError.unauthorized('Email or password is incorrect');
  }

  res.json({ token: signToken(user), user: user.toJSON() });
});

/**
 * Sign in or sign up with a Google ID token.
 *
 * Three cases, in order:
 *   1. We already know this Google account  → sign in.
 *   2. The email exists as a password account → link the two. Safe because
 *      Google told us the address is verified.
 *   3. Neither → create a new account.
 */
export const googleSignIn = asyncHandler(async (req, res) => {
  const profile = await verifyGoogleToken(req.body.credential);

  let user = await User.findOne({ googleId: profile.googleId });

  if (!user) {
    user = await User.findOne({ email: profile.email });

    if (user) {
      user.googleId = profile.googleId;
      if (!user.avatarUrl) user.avatarUrl = profile.avatarUrl;
      await user.save();
    } else {
      user = await User.create({
        name: profile.name,
        email: profile.email,
        googleId: profile.googleId,
        avatarUrl: profile.avatarUrl
      });
    }
  } else if (profile.avatarUrl && user.avatarUrl !== profile.avatarUrl) {
    user.avatarUrl = profile.avatarUrl;
    await user.save();
  }

  res.json({ token: signToken(user), user: user.toJSON() });
});

/** Public: tells the sign-in page whether to show the Google button. */
export const providers = asyncHandler(async (_req, res) => {
  res.json({ google: googleStatus() });
});

export const me = asyncHandler(async (req, res) => {
  res.json({ user: req.user.toJSON() });
});

export const updateProfile = asyncHandler(async (req, res) => {
  Object.assign(req.user, req.body);
  await req.user.save();
  res.json({ user: req.user.toJSON() });
});

/**
 * Works out BMI and suggested targets without saving anything. The user edits
 * the numbers first and saves them through `updateProfile`.
 */
export const bodyTargets = asyncHandler(async (req, res) => {
  res.json(computeBodyTargets(req.body));
});
