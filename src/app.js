/** Builds the Express app: security, parsing, routes, error handling. */
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import { env } from './config/env.js';
import routes from './routes/index.js';
import { apiLimiter } from './middleware/rateLimit.js';
import { notFound, errorHandler } from './middleware/errorHandler.js';

export function createApp() {
  const app = express();

  // How many proxies to believe when working out the client's IP. The rate
  // limiter depends on getting this right — see TRUST_PROXY in config/env.js.
  app.set('trust proxy', env.TRUST_PROXY);

  app.use(helmet());
  app.use(
    cors({
      origin: (origin, callback) => {
        // No origin = same-origin request or a tool like curl.
        if (!origin || env.allowedOrigins.includes(origin)) return callback(null, true);
        callback(new Error('Origin not allowed by CORS'));
      },
      credentials: true
    })
  );
  app.use(compression());
  app.use(express.json({ limit: '256kb' }));
  app.use(morgan(env.isProd ? 'combined' : 'dev'));

  app.use('/api', apiLimiter, routes);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
