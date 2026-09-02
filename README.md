# SaarthiOS API

SaarthiOS is a small personal app for the everyday things that are easy to lose track of: what you
spent, what you ate, and what you put away. Instead of filling forms, you say what happened and
the app files it for you.

**Live at [saarthios.space](https://saarthios.space)**

This is the backend. It serves JSON and never renders a page. The web app lives in
[SaarthiOS_Web](https://github.com/kratin01/SaarthiOS_Web).

---

## What this service does

- **Understands plain sentences.** *"spent 250 on lunch and 80 on auto"* becomes two expenses with
  the right amounts and categories. *"had 2 rotis and dal"* becomes a meal with calories and
  macros. One sentence can touch several areas at once, and it asks a follow up when a portion is
  genuinely unclear.
- **Stores your money, meals and investments,** and does the arithmetic behind every dashboard:
  totals, trends, category splits and period comparisons.
- **Works out health targets** from height, weight and goal, so calories and protein are
  calculated rather than looked up.
- **Fetches live share prices** on request, so a portfolio can be compared against what was paid.
  Only when asked, so nothing is quietly stale.
- **Reads documents.** Bank statement PDFs and CSVs, and photos of bills, become rows you can
  review before anything is saved.
- **Runs trackers you invent.** A user can define their own agent, with their own fields, and it
  starts understanding sentences about it straight away.
- **Keeps your keys safe.** Users can bring their own AI key from any of eleven providers, stored
  encrypted and never sent back to the browser.

## How it works

```
request → auth → rate limit → validate → controller → service → MongoDB
                                    │
                              chat only ↓
                          orchestrator → agents → AI provider
```

An orchestrator reads the message, decides which agents it touches, runs them, and answers once.

**The AI never writes to the database.** A model returns JSON, Zod validates it against a strict
schema, and only then does a service save it. A malformed or invented response fails validation
instead of corrupting anything. That rule is what the rest of the design rests on.

Any of eleven providers can sit behind it, including OpenAI, Gemini, Anthropic, Groq and a local
Ollama. Swapping one is an environment variable, not a code change.

**Stack:** Node.js 22, Express, MongoDB with Mongoose, Zod and JWT. Plain ES modules, so there is
no build step.

---

## Quick start

Needs **Node.js 22 or newer** and a MongoDB connection string.

```bash
npm install
cp .env.example .env     # fill in MONGODB_URI, JWT_SECRET and an AI key
npm run dev
```

Listens on `http://localhost:5000`. Run the web app separately and it forwards `/api` here.

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start with auto-reload |
| `npm start` | Start once, used in production |
| `npm run seed -- you@example.com` | Fill an existing account with about 45 days of sample data |
| `npm run migrate:conversations` | One off: move pre-threads chat into a thread |
| `npm run migrate:google-index` | One off: repair the `googleId` index |

## Configuration

Every value is checked on boot, so a missing or malformed setting stops the process with a clear
message rather than failing quietly later. The full list with comments is in
[.env.example](.env.example).

| Variable | Notes |
| --- | --- |
| `MONGODB_URI` | **Required.** |
| `JWT_SECRET` | **Required.** Any long random string. |
| `ENCRYPTION_KEY` | Encrypts AI keys saved in Settings. Set it, or rotating `JWT_SECRET` breaks every saved key. |
| `NODE_ENV` | `production` in production, otherwise internal errors get sent to users. |
| `CLIENT_ORIGIN` | Exact origins allowed by CORS, comma separated, no trailing slash. |
| `TRUST_PROXY` | How many proxies sit in front. `1` for nginx alone, `2` behind Cloudflare. Set it too low and every visitor shares one rate limit. |
| `BIND_HOST` | `127.0.0.1` behind nginx, so the port cannot be reached from outside. |
| `TZ` | The timezone "today" is measured in. Left unset on a UTC server, anyone ahead of UTC sees yesterday's numbers after midnight. |
| `LLM_PROVIDER` and `LLM_API_KEY` | The default AI for everyone. Users can override it with their own. |
| `GOOGLE_CLIENT_ID` | Optional. Blank hides the Google button and email sign-in still works. |
| `NOTICE_*` | Set one to a sentence and it appears in the app within a minute, without a redeploy. |

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
├── controllers/   turn an HTTP request into a service call
├── routes/        which URL goes to which controller
├── middleware/    auth, validation, rate limits, error handling
├── utils/         dates, errors, logging, paging
└── scripts/       seeds and one off migrations
```

`services/`, `ai/`, `routes/` and `models/` each have a README explaining that layer.

## Security

- Passwords are hashed with bcrypt, and the `User` model strips the hash in `toJSON()`.
- Sign-in gives the same message for a wrong password and an unknown email, so the API cannot be
  used to find out which addresses have accounts.
- Google ID tokens are verified on the server against Google's public keys, and only accepted when
  the email is verified. The browser is never trusted.
- AI keys are encrypted with AES-256-GCM before storage and never returned. The client only ever
  receives a masked hint.
- Every query is scoped to `req.user._id`, so one account cannot reach another's data.
- Rate limits apply across the API, tighter on auth, tighter still on chat.

## Deployment

Runs under PM2 behind nginx. The web app is built to static files and served from the same origin,
so `/` is the app and `/api` comes here. No CORS in production and no second domain.

Two settings are easy to get wrong and silent when you do: `TRUST_PROXY`, where a wrong value
makes every visitor share a rate limit, and `TZ`, where a wrong value shows yesterday's data. Both
are printed at startup in production so a mismatch shows up in the logs.

---

## Contributing

Contributions are very welcome, whether that is a bug report, a rough idea, or a pull request.

```bash
git clone https://github.com/kratin01/SaarthiOS.git
cd SaarthiOS && npm install
cp .env.example .env
npm run dev
```

A few things worth knowing before you open a PR:

1. **Never let a model write to the database.** New AI behaviour returns JSON, gets a Zod schema,
   and a service saves it.
2. **Keep the rules in `services/`.** Controllers read the request and call a service. They do not
   hold business logic.
3. **Scope every query to the signed-in user.** No exceptions.
4. **Add new config to `config/env.js`** with a Zod rule and a default, and document it in
   `.env.example`.
5. **Never commit secrets.** `.env` is ignored, and it should stay that way.

Please say what you changed and how you checked it. If it touches money, calories or dates,
mention what you tested against, because those are the parts people actually rely on. Small PRs
are easier to review and get merged faster.
