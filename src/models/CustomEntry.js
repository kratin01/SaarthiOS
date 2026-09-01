import mongoose from 'mongoose';
import { SOURCES } from '../config/constants.js';

/**
 * One logged row for a custom agent.
 *
 * Every custom agent shares this single collection rather than getting one of
 * its own. Creating collections at runtime would mean no fixed indexes, no way
 * to migrate, and an unbounded number of them. A compound index on
 * (user, agent, date) makes this just as fast to read.
 *
 * `values` is keyed by `CustomAgent.fields[].key`, so the shape is validated by
 * the agent definition rather than by Mongoose.
 */
const customEntrySchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    agent: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CustomAgent',
      required: true,
      index: true
    },
    /** Short human label for the row: "Morning run", "Chapter 4". */
    title: { type: String, required: true, trim: true, maxlength: 140 },
    values: { type: Map, of: mongoose.Schema.Types.Mixed, default: () => new Map() },
    note: { type: String, trim: true, maxlength: 300, default: '' },
    date: { type: Date, required: true, default: Date.now },
    source: { type: String, enum: SOURCES, default: 'manual' },
    agentRun: { type: mongoose.Schema.Types.ObjectId, ref: 'AgentRun', default: null }
  },
  { timestamps: true }
);

customEntrySchema.index({ user: 1, agent: 1, date: -1 });

export const CustomEntry = mongoose.model('CustomEntry', customEntrySchema);
