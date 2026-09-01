import mongoose from 'mongoose';
import { EXPENSE_CATEGORIES, SOURCES } from '../config/constants.js';

const expenseSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    amount: { type: Number, required: true, min: 0 },
    category: { type: String, enum: EXPENSE_CATEGORIES, default: 'other', index: true },
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
