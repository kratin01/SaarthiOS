import mongoose from 'mongoose';
import { AGENTS } from '../config/constants.js';

/**
 * One row per chat message. It stores the conversation *and* the trace of what
 * each agent did, which is what the "Agent Activity" panel renders.
 */
const stepSchema = new mongoose.Schema(
  {
    agent: { type: String, default: 'orchestrator' },
    label: { type: String, required: true },
    status: { type: String, enum: ['running', 'done', 'skipped', 'failed'], default: 'done' },
    detail: { type: String, default: '' },
    at: { type: Date, default: Date.now }
  },
  { _id: false }
);

const agentRunSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    conversation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Conversation',
      required: true,
      index: true
    },
    message: { type: String, required: true, maxlength: 4000 },
    reply: { type: String, default: '' },
    /** `record` saved data, `query` answered a question, `clarify` asked one back. */
    intent: { type: String, enum: ['record', 'query', 'chat', 'clarify'], default: 'chat' },
    agentsUsed: [{ type: String, enum: AGENTS }],
    steps: { type: [stepSchema], default: [] },
    /** Counts of what was written, so the UI can say "2 expenses, 1 meal". */
    created: {
      expenses: { type: Number, default: 0 },
      meals: { type: Number, default: 0 },
      investments: { type: Number, default: 0 },
      custom: { type: Number, default: 0 }
    },
    status: { type: String, enum: ['completed', 'failed'], default: 'completed' },
    error: { type: String, default: '' },
    durationMs: { type: Number, default: 0 }
  },
  { timestamps: true }
);

agentRunSchema.index({ user: 1, createdAt: -1 });
agentRunSchema.index({ conversation: 1, createdAt: 1 });

export const AgentRun = mongoose.model('AgentRun', agentRunSchema);
