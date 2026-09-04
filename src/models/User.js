import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { BODY_GOALS } from '../config/constants.js';

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true
    },
    /** Missing for accounts that only ever sign in with Google. */
    passwordHash: { type: String, select: false },
    /**
     * Google's stable user id (`sub`), absent for password-only accounts.
     * `default: undefined` matters: a `null` default would be written to every
     * document, and the unique index below would then see every password user
     * as a duplicate of the last one.
     */
    googleId: { type: String, default: undefined },
    avatarUrl: { type: String, default: '', maxlength: 500 },
    currency: { type: String, default: 'INR', maxlength: 8 },
    /**
     * Categories this user invented, beyond the built-in list. Stored on the
     * user rather than derived from their expenses so a category survives
     * deleting the last row that used it.
     */
    customCategories: { type: [String], default: [] },
    /** Used by the dashboard to show "x% of budget used". Null = no budget set. */
    monthlyBudget: { type: Number, default: null, min: 0 },
    dailyCalorieGoal: { type: Number, default: 2000, min: 0 },
    dailyProteinGoal: { type: Number, default: 0, min: 0 },
    /** Null until the user fills in the body profile on the Health page. */
    heightCm: { type: Number, default: null, min: 50, max: 260 },
    weightKg: { type: Number, default: null, min: 20, max: 400 },
    bodyGoal: { type: String, enum: BODY_GOALS, default: 'normal' }
  },
  { timestamps: true }
);

/**
 * Partial, not sparse: sparse only skips *missing* fields, so a stray `null`
 * would still be indexed and collide with the next one.
 */
userSchema.index(
  { googleId: 1 },
  { unique: true, partialFilterExpression: { googleId: { $type: 'string' } } }
);

userSchema.methods.verifyPassword = function verifyPassword(plain) {
  if (!this.passwordHash) return false;
  return bcrypt.compare(plain, this.passwordHash);
};

userSchema.statics.hashPassword = function hashPassword(plain) {
  return bcrypt.hash(plain, 10);
};

/** Never leak the hash, even if someone forgets `.select()`. */
userSchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete ret.passwordHash;
    delete ret.__v;
    return ret;
  }
});

export const User = mongoose.model('User', userSchema);
