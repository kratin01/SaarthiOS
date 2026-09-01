/**
 * One-off: chats used to be a single flat list. Threads were added later.
 * This puts every message that has no thread into one "Earlier chats" thread
 * per user, so nothing disappears from the sidebar.
 *
 *   node src/scripts/migrateConversations.js
 */
import { connectDatabase, disconnectDatabase } from '../config/db.js';
import { AgentRun, Conversation } from '../models/index.js';
import { logger } from '../utils/logger.js';

async function migrate() {
  await connectDatabase();

  const userIds = await AgentRun.distinct('user', {
    $or: [{ conversation: { $exists: false } }, { conversation: null }]
  });

  if (userIds.length === 0) {
    logger.info('Nothing to migrate.');
    await disconnectDatabase();
    process.exit(0);
  }

  for (const userId of userIds) {
    const orphans = await AgentRun.find({
      user: userId,
      $or: [{ conversation: { $exists: false } }, { conversation: null }]
    })
      .sort({ createdAt: 1 })
      .lean();

    const conversation = await Conversation.create({
      user: userId,
      title: 'Earlier chats',
      messageCount: orphans.length,
      lastMessageAt: orphans[orphans.length - 1]?.createdAt ?? new Date()
    });

    await AgentRun.updateMany(
      { _id: { $in: orphans.map((o) => o._id) } },
      { $set: { conversation: conversation._id } }
    );

    logger.info(`Moved ${orphans.length} messages for user ${userId}`);
  }

  await disconnectDatabase();
  process.exit(0);
}

migrate().catch(async (error) => {
  logger.error(error.message);
  await disconnectDatabase();
  process.exit(1);
});
