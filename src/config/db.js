/** Single MongoDB connection, shared by the whole app. */
import mongoose from 'mongoose';
import { env } from './env.js';
import { logger } from '../utils/logger.js';

mongoose.set('strictQuery', true);

let failedAttempts = 0;
let everConnected = false;

/** Cheap enough to call from a request; used to decide whether to serve a 503. */
export const isDatabaseReady = () => mongoose.connection.readyState === 1;

/**
 * "Still connecting" and "cannot connect" look the same from `readyState`, and
 * telling a user the database is down two seconds into a cold start would be
 * both alarming and wrong. An outage is only reported once an attempt has
 * actually failed.
 */
export const databaseState = () => ({
  ready: isDatabaseReady(),
  connecting: !isDatabaseReady() && failedAttempts === 0,
  failedAttempts,
  everConnected
});

export async function connectDatabase() {
  mongoose.connection.on('connected', () => {
    everConnected = true;
    failedAttempts = 0;
    logger.info('MongoDB connected');
  });
  mongoose.connection.on('error', (err) => logger.error('MongoDB error', err.message));
  mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'));

  await mongoose.connect(env.MONGODB_URI, {
    serverSelectionTimeoutMS: 10000,
    maxPoolSize: 10
  });
}

/**
 * Keeps trying in the background.
 *
 * The API starts listening even when the database is down, so the app can load
 * and explain itself instead of the whole deployment looking dead. Mongoose
 * reconnects on its own once a connection has been made; this covers the case
 * where the very first attempt failed.
 */
export function connectDatabaseWithRetry({ intervalMs = 10_000 } = {}) {
  let attempt = 0;

  const tryConnect = async () => {
    attempt += 1;
    try {
      await connectDatabase();
    } catch (error) {
      failedAttempts += 1;
      logger.error(`MongoDB connection attempt ${attempt} failed: ${error.message}`);
      setTimeout(tryConnect, intervalMs).unref();
    }
  };

  return tryConnect();
}

export async function disconnectDatabase() {
  await mongoose.connection.close();
}
