# SaarthiOS — API

Backend for [SaarthiOS](https://saarthios.space): accounts, personal data, and the AI agents that
read and write it.

JSON only — it never renders a page. The web client lives in
[SaarthiOS_Web](https://github.com/kratin01/SaarthiOS_Web).

**Stack:** Node.js 22 · Express · MongoDB (Mongoose) · Zod · JWT

---

## How it works

You type `spent 250 on lunch` and an orchestrator decides which agents that touches, runs them,
and replies once.

```
request → auth → rate limit → validate → controller → service → MongoDB
                                    │
                              chat only ↓
                          orchestrator → agents → AI provider
```

**The AI never writes to the database.** A model returns JSON, Zod validates it against a strict
schema, and only then does a service persist it. A malformed or hallucinated response fails
validation instead of corrupting data — this is the rule the whole design rests on.

Any of 11 providers can back it (OpenAI, Gemini, Anthropic, Groq, Ollama and more). Swapping one
is an environment variable, not a code change.

---

## Quick start

Requires **Node.js 22+** and a MongoDB connection string.

```bash
npm install
cp .env.example .env     # fill in MONGODB_URI, JWT_SECRET and your AI key
npm run dev
```

Listens on `http://localhost:5000`. Start the web app separately — it proxies `/api` here.

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start with auto-reload |
| `npm start` | Start once — use this in production |
| `npm run seed -- you@example.com` | Fill an existing account with ~45 days of sample data |
| `npm run migrate:conversations` | One-off: move pre-threads chat into a thread |
| `npm run migrate:google-index` | One-off: repair the `googleId` index |

---

## Configuration

Every variable is validated on boot — a missing or malformed value stops the process with a clear
message instead of failing later. Full list with comments in [.env.example](.env.example).

| Variable | Notes |
| --- | --- |
| `MONGODB_URI` | **Required.** |
| `JWT_SECRET` | **Required.** Any long random string. |
| `ENCRYPTION_KEY` | Encrypts AI keys saved in Settings. Set it, or rotating `JWT_SECRET` breaks every saved key. |
| `NODE_ENV` | `production` in production, otherwise internal errors are sent to users. |
| `CLIENT_ORIGIN` | Exact origin(s) allowed by CORS, comma-separated, no trailing slash. |
| `TRUST_PROXY` | Proxy hops in front: `1` for nginx alone, `2` behind Cloudflare. Too low and one visitor's rate limit locks out everyone. |
| `BIND_HOST` | `127.0.0.1` behind nginx, so the port is unreachable from outside. |
| `TZ` | The timezone "today" is bucketed in. Left unset on a UTC server, anyone ahead of UTC sees yesterday's data after midnight. |
| `LLM_PROVIDER` / `LLM_API_KEY` | Default AI for everyone. Users can override with their own key. |
| `GOOGLE_CLIENT_ID` | Optional. Blank hides the Google button; email sign-in keeps working. |
| `NOTICE_*` | Set to a sentence and it appears in the app within a minute, no redeploy. |

---

## Project structure

```
src/
├── index.js       start up, connect, shut down cleanly
├── app.js         assemble Express: security, CORS, logging, routes, errors
├── config/        validated env, database connection, shared constants
├── models/        Mongoose schemas
├── services/      all reads and writes, one module per area of life
├── ai/            orchestrator, agents, prompts, provider clients
├── controllers/   HTTP request → service call
├── routes/        URL → controller
├── middleware/    auth, validation, rate limits, error handling
├── utils/         dates, errors, logging, paging
└── scripts/       seeds and one-off migrations
```

`services/`, `ai/`, `routes/` and `models/` each have their own README explaining that layer.

---

## Security

- Passwords are hashed with bcrypt, and the `User` model strips the hash in `toJSON()`.
- Sign-in returns the same message for a wrong password and an unknown email, so the API can't be
  used to discover which addresses have accounts.
- Google ID tokens are verified server-side against Google's public keys and only accepted when
  the email is verified. The browser is never trusted.
- AI keys users save are encrypted with AES-256-GCM before storage and never returned — the client
  only receives a masked hint.
- Every query is scoped to `req.user._id`, so one account cannot reach another's data.
- Rate limits apply across the API, tighter on auth, tighter still on chat.

---

## Deployment

Runs under PM2 behind nginx. The web app is built to static files and served from the same origin,
so `/` is the app and `/api` proxies here — no CORS in production and no second domain.

Two settings are easy to get wrong and silent when you do: `TRUST_PROXY` (wrong value makes every
visitor share one rate limit) and `TZ` (wrong value shows yesterday's data). Both are printed at
startup in production so a mismatch is visible in the logs.

---

## Contributing

Issues and pull requests are welcome.

```bash
git clone https://github.com/kratin01/SaarthiOS.git
cd SaarthiOS && npm install
cp .env.example .env
npm run dev
```

Before opening a PR:

1. **Never let a model write to the database.** New AI behaviour returns JSON, gets a Zod schema,
   and a service persists it.
2. **Keep rules in `services/`.** Controllers read the request and call a service; they don't hold
   business logic.
3. **Scope every query to the signed-in user.** No exceptions.
4. **Add new config to `config/env.js`** with a Zod rule and a default, and document it in
   `.env.example`.
5. **Never commit secrets.** `.env` is ignored; keep it that way.

Say what you changed and how you verified it. If it touches money, calories or dates, mention what
you tested against — those are the parts people actually rely on.
