/**
 * Reads and validates environment variables once, at startup.
 * If something required is missing the process exits with a readable message
 * instead of failing later with a confusing error.
 */
import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(5000),
  CLIENT_ORIGIN: z.string().default('http://localhost:5173'),

  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),

  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  JWT_EXPIRES_IN: z.string().default('7d'),

  /** Blank turns "Continue with Google" off; the app still works with email + password. */
  GOOGLE_CLIENT_ID: z.string().default(''),

  /** Encrypts API keys saved from Settings. Falls back to JWT_SECRET when unset. */
  ENCRYPTION_KEY: z.string().default(''),

  /**
   * How many agents a user may build. Every one of them is described in the
   * planner prompt on every chat message, so this is a cost and accuracy dial,
   * not just a product limit.
   */
  MAX_CUSTOM_AGENTS: z.coerce.number().int().min(0).max(10).default(2),

  /**
   * How many proxies sit in front of this server. Express uses it to work out
   * the real client IP, which is what the rate limiter counts against.
   *
   *   1  direct behind one proxy (Render, or nginx on its own)
   *   2  Cloudflare in front of nginx
   *
   * Too low and every visitor looks like the proxy, so one person hitting a
   * limit locks out everybody.
   */
  TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(1),

  /**
   * Operator notices. Set any of these to a sentence and it appears in the app
   * straight away — no redeploy, no code change. Blank means nothing is shown.
   * Use them when something is known to be broken so users read your words
   * instead of guessing from a failure.
   */
  NOTICE_GLOBAL: z.string().max(300).default(''),
  NOTICE_CHAT: z.string().max(300).default(''),
  NOTICE_PRICES: z.string().max(300).default(''),
  NOTICE_IMPORT: z.string().max(300).default(''),

  LLM_PROVIDER: z.string().default('openai'),
  LLM_API_KEY: z.string().default(''),
  LLM_MODEL: z.string().default(''),
  LLM_BASE_URL: z.string().default(''),
  LLM_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.2),
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(45000)
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const problems = parsed.error.issues.map((i) => `  • ${i.path.join('.')}: ${i.message}`);
  console.error('\nInvalid environment configuration:\n' + problems.join('\n'));
  console.error('\nCheck server/.env against server/.env.example.\n');
  process.exit(1);
}

const raw = parsed.data;

export const env = Object.freeze({
  ...raw,
  isProd: raw.NODE_ENV === 'production',
  googleClientId: raw.GOOGLE_CLIENT_ID.trim(),
  googleEnabled: raw.GOOGLE_CLIENT_ID.trim().length > 0,
  notices: Object.freeze({
    global: raw.NOTICE_GLOBAL.trim(),
    chat: raw.NOTICE_CHAT.trim(),
    prices: raw.NOTICE_PRICES.trim(),
    import: raw.NOTICE_IMPORT.trim()
  }),
  /** CLIENT_ORIGIN may hold a comma separated list. */
  allowedOrigins: raw.CLIENT_ORIGIN.split(',')
    .map((o) => o.trim())
    .filter(Boolean)
});
