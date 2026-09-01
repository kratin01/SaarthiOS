/** Chat threads, the messages inside them, and the agent activity trace. */
import { z } from 'zod';
import mongoose from 'mongoose';
import { AgentRun } from '../models/AgentRun.js';
import { Conversation } from '../models/Conversation.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { handleMessage } from '../ai/orchestrator.js';
import { readPaging, pageInfo } from '../utils/paging.js';
import { statusForUser } from '../services/aiSettingsService.js';

export const messageSchema = z.object({
  message: z.string().trim().min(1, 'Type something first').max(2000),
  /** Omit to start a new thread. */
  conversationId: z.string().optional()
});

async function loadConversation(userId, id) {
  if (!id) return Conversation.create({ user: userId });

  if (!mongoose.Types.ObjectId.isValid(id)) throw ApiError.badRequest('Invalid conversation');
  const conversation = await Conversation.findOne({ _id: id, user: userId });
  if (!conversation) throw ApiError.notFound('Conversation not found');
  return conversation;
}

export const sendMessage = asyncHandler(async (req, res) => {
  const conversation = await loadConversation(req.user._id, req.body.conversationId);
  const run = await handleMessage({
    user: req.user,
    message: req.body.message,
    conversation
  });

  res.status(201).json({ run, conversationId: String(conversation._id) });
});

/** The thread list for the sidebar, newest first. */
export const listConversations = asyncHandler(async (req, res) => {
  const { limit, offset } = readPaging(req.query, { defaultLimit: 30 });
  const filter = { user: req.user._id, messageCount: { $gt: 0 } };

  const [conversations, total] = await Promise.all([
    Conversation.find(filter).sort({ lastMessageAt: -1, _id: -1 }).skip(offset).limit(limit).lean(),
    Conversation.countDocuments(filter)
  ]);

  res.json({
    conversations,
    page: pageInfo({ limit, offset, total, count: conversations.length })
  });
});

/**
 * One thread, oldest first so the UI renders it directly.
 *
 * The *last* page is served by default rather than the first: you open a chat
 * to see how it ended, and a long thread should not ship hundreds of messages
 * to show the newest one.
 */
export const getConversation = asyncHandler(async (req, res) => {
  const conversation = await loadConversation(req.user._id, req.params.id);
  const { limit } = readPaging(req.query, { defaultLimit: 30 });

  const filter = { conversation: conversation._id };
  const total = await AgentRun.countDocuments(filter);

  // `before` walks backwards through the thread as the user scrolls up.
  const before = Number.parseInt(req.query.before, 10);
  const end = Number.isFinite(before) && before >= 0 ? Math.min(before, total) : total;
  const start = Math.max(end - limit, 0);

  const runs = await AgentRun.find(filter)
    .sort({ createdAt: 1, _id: 1 })
    .skip(start)
    .limit(end - start)
    .lean();

  res.json({
    conversation,
    runs,
    page: { limit, total, oldestIndex: start, hasEarlier: start > 0 }
  });
});

export const deleteConversation = asyncHandler(async (req, res) => {
  const conversation = await loadConversation(req.user._id, req.params.id);
  // Expenses and meals it created are kept on purpose — deleting a chat should
  // not silently delete the user's data.
  await Promise.all([
    AgentRun.deleteMany({ conversation: conversation._id }),
    Conversation.deleteOne({ _id: conversation._id })
  ]);
  res.status(204).end();
});

/** Whether AI is ready for this user, and which provider. Never the key. */
export const aiStatus = asyncHandler(async (req, res) => {
  res.json(await statusForUser(req.user._id));
});
