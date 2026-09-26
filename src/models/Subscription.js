import mongoose from 'mongoose';
import { BILLING_CYCLES, SOURCES, SUBSCRIPTION_CATEGORIES } from '../config/constants.js';

/**
 * A recurring service, recorded once rather than every time it charges.
 *
 * There are no payment rows behind this. `startedOn` plus `cycle` is enough to
 * work out how many times it has charged, which is the whole point: nobody is
 * going to log Netflix by hand twelve times a year.
 */
const subscriptionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    /** What it is called, e.g. "Netflix". */
    name: { type: String, required: true, trim: true, maxlength: 80 },
    amount: { type: Number, required: true, min: 0 },
    cycle: { type: String, enum: BILLING_CYCLES, default: 'monthly', index: true },
    category: { type: String, enum: SUBSCRIPTION_CATEGORIES, default: 'other', index: true },
    /** First charge. Everything paid-to-date is counted forward from here. */
    startedOn: { type: Date, required: true, default: Date.now, index: true },
    /**
     * When it was cancelled. `null` means it is still running.
     * A cancelled subscription is kept rather than deleted — what you used to
     * pay for is the most interesting part of the history.
     */
    endedOn: { type: Date, default: null },
    note: { type: String, trim: true, maxlength: 300, default: '' },
    source: { type: String, enum: SOURCES, default: 'manual' },
    agentRun: { type: mongoose.Schema.Types.ObjectId, ref: 'AgentRun', default: null }
  },
  { timestamps: true }
);

subscriptionSchema.index({ user: 1, endedOn: 1 });
subscriptionSchema.index({ user: 1, startedOn: -1 });

/** One person should not end up with two Netflix rows by saying it twice. */
subscriptionSchema.index(
  { user: 1, name: 1 },
  { unique: true, collation: { locale: 'en', strength: 2 }, partialFilterExpression: { endedOn: null } }
);

export const Subscription = mongoose.model('Subscription', subscriptionSchema);
