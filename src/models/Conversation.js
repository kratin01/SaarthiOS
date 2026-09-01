import mongoose from 'mongoose';

/**
 * A chat thread. "New chat" creates one of these; every message in the thread
 * points back at it.
 *
 * Threads also give the orchestrator short-term memory: it reads the last few
 * turns of the same conversation, which is what lets a reply like "2 bowls"
 * answer the question it just asked.
 */
const conversationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, default: 'New chat', maxlength: 120 },
    lastMessageAt: { type: Date, default: Date.now },
    messageCount: { type: Number, default: 0 }
  },
  { timestamps: true }
);

conversationSchema.index({ user: 1, lastMessageAt: -1 });

/** Titles come from the first message — short, and no extra AI call. */
conversationSchema.statics.titleFrom = function titleFrom(message) {
  const clean = String(message).replace(/\s+/g, ' ').trim();
  if (clean.length <= 48) return clean || 'New chat';
  return `${clean.slice(0, 45).trimEnd()}…`;
};

export const Conversation = mongoose.model('Conversation', conversationSchema);
