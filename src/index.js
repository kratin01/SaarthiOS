/** Entry point: connect to MongoDB, start listening, shut down cleanly. */
import { env } from './config/env.js';
import { connectDatabaseWithRetry, disconnectDatabase, isDatabaseReady } from './config/db.js';
import { createApp } from './app.js';
import { logger } from './utils/logger.js';
import { envLlmStatus } from './ai/llm.js';

async function main() {
  // Deliberately not awaited: a database that is down should not stop the API
  // from starting, or the app cannot even load to explain what is wrong.
  void connectDatabaseWithRetry();

  const server = createApp().listen(env.PORT, env.BIND_HOST, () => {
    logger.info(`SaarthiOS API on http://localhost:${env.PORT} (${env.NODE_ENV})`);

    if (!isDatabaseReady()) {
      logger.warn('Started before MongoDB was reachable — retrying in the background.');
    }

    if (env.isProd) {
      // Printed because getting it wrong is silent: rate limits start counting
      // the proxy instead of the visitor, and one user can lock out everyone.
      logger.info(`Trusting ${env.TRUST_PROXY} proxy hop(s) for client IPs`);
      logger.info(`Allowed origins: ${env.allowedOrigins.join(', ') || 'none'}`);

      if (env.BIND_HOST === '0.0.0.0') {
        logger.warn(
          `Listening on all interfaces. Behind nginx, set BIND_HOST=127.0.0.1 so port ${env.PORT} cannot be reached directly.`
        );
      }
    }

    const ai = envLlmStatus();
    if (ai.ok) {
      logger.info(`Default AI provider: ${ai.label} · ${ai.model}`);
    } else {
      logger.warn(`No default AI in .env — ${ai.reason} Users can add their own key in Settings.`);
    }

    if (env.googleEnabled) {
      logger.info('Google sign-in enabled');
    } else {
      logger.warn('Google sign-in disabled — GOOGLE_CLIENT_ID is not set.');
    }
  });

  const shutdown = async (signal) => {
    logger.info(`${signal} received, shutting down`);
    server.close(async () => {
      await disconnectDatabase();
      process.exit(0);
    });
    // Do not hang forever if a connection refuses to close.
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((error) => {
  logger.error('Failed to start:', error.message);
  process.exit(1);
});
