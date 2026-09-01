/**
 * One-off: `googleId` used to default to `null` under a *sparse* unique index.
 * Sparse only skips missing fields, so the second password-only account
 * collided with the first and registration failed with a duplicate key error.
 *
 * This removes the stray nulls and drops the old index. The correct partial
 * index is created automatically on the next server start.
 *
 *   node src/scripts/fixGoogleIdIndex.js
 */
import { connectDatabase, disconnectDatabase } from '../config/db.js';
import { User } from '../models/index.js';
import { logger } from '../utils/logger.js';

async function fix() {
  await connectDatabase();

  const cleared = await User.updateMany({ googleId: null }, { $unset: { googleId: '' } });
  logger.info(`Cleared googleId on ${cleared.modifiedCount} account(s)`);

  const indexes = await User.collection.indexes();
  const stale = indexes.find((ix) => ix.name === 'googleId_1' && !ix.partialFilterExpression);

  if (stale) {
    await User.collection.dropIndex('googleId_1');
    logger.info('Dropped the old sparse googleId index');
  } else {
    logger.info('No stale googleId index to drop');
  }

  await User.syncIndexes();
  logger.info('Indexes rebuilt');

  await disconnectDatabase();
  process.exit(0);
}

fix().catch(async (error) => {
  logger.error(error.message);
  await disconnectDatabase();
  process.exit(1);
});
