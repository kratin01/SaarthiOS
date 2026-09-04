import mongoose from 'mongoose';
import { SOURCES } from '../config/constants.js';
import { MAX_CATEGORY_LENGTH } from '../utils/categories.js';

const expenseSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    amount: { type: Number, required: true, min: 0 },
    /**
     * No enum: users can invent their own categories. The allowed set is per
     * user, so it is checked in the service where their list is known.
     */
    category: {
      type: String,
      trim: true,
      lowercase: true,
      maxlength: MAX_CATEGORY_LENGTH,
      default: 'other',
      index: true
    },
    merchant: { type: String, trim: true, maxlength: 120, default: '' },
    note: { type: String, trim: true, maxlength: 300, default: '' },
    date: { type: Date, required: true, default: Date.now, index: true },
    source: { type: String, enum: SOURCES, default: 'manual' },
    /** Links this row back to the chat message that created it. */
    agentRun: { type: mongoose.Schema.Types.ObjectId, ref: 'AgentRun', default: null }
  },
  { timestamps: true }
);

expenseSchema.index({ user: 1, date: -1 });

export const Expense = mongoose.model('Expense', expenseSchema);
