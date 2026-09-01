import mongoose from 'mongoose';
import { INVESTMENT_TYPES, SOURCES } from '../config/constants.js';

const investmentSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    amount: { type: Number, required: true, min: 0 },
    type: { type: String, enum: INVESTMENT_TYPES, default: 'other', index: true },
    /** Fund / stock / scheme name, e.g. "Parag Parikh Flexi Cap". */
    instrument: { type: String, trim: true, maxlength: 140, default: '' },
    /** Units bought. Only asked for on types in QUANTITY_TYPES. */
    quantity: { type: Number, default: null, min: 0 },
    /**
     * Ticker used to look the price up, e.g. "RELIANCE.NS".
     * Filled in automatically from `instrument` the first time prices are
     * checked, so nobody has to know Yahoo's suffixes.
     */
    symbol: { type: String, trim: true, uppercase: true, maxlength: 20, default: '' },
    note: { type: String, trim: true, maxlength: 300, default: '' },
    date: { type: Date, required: true, default: Date.now, index: true },
    source: { type: String, enum: SOURCES, default: 'manual' },
    agentRun: { type: mongoose.Schema.Types.ObjectId, ref: 'AgentRun', default: null }
  },
  { timestamps: true }
);

investmentSchema.index({ user: 1, date: -1 });

export const Investment = mongoose.model('Investment', investmentSchema);
