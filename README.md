# SaarthiOS — API

The SaarthiOS backend. It handles accounts, stores personal data, and runs the AI agents.

Runs on Node.js 18.17+ with plain ES modules — no build step, no TypeScript compile.

> The web app lives in its own repository, **SaarthiOS_Web**. This one serves only JSON;
> it never renders a page. See [DEPLOYMENT.md](DEPLOYMENT.md) for how the two fit together.

---

## Run it

```powershell
npm install
Copy-Item .env.example .env    # then fill in MONGODB_URI and your AI key
npm run dev                    # auto-restarts on file changes
```

The API listens on `http://localhost:5000`. Run the web app separately and it proxies `/api` here.

| Command        | What it does                                    |
| -------------- | ----------------------------------------------- |
| `npm run dev`  | Start with auto-reload                          |
| `npm start`    | Start once (use this in production)             |
| `npm run seed` | Fill an account with sample data — see below    |
| `npm run migrate:conversations` | One-off: move pre-threads chat messages into a thread |
| `npm run migrate:google-index` | One-off: repair the `googleId` index (see below) |

```powershell
npm run seed -- your@email.com
```

---

## The folders

```
src/
├── index.js        starts everything
├── app.js          builds the Express app
├── config/         settings, database connection, shared word lists
├── models/         what the data looks like in MongoDB
├── services/       reads and writes for each area of life
├── ai/             the agents, the orchestrator and the AI providers
├── controllers/    turns an HTTP request into a service call
├── routes/         which URL goes to which controller
├── middleware/     auth, validation, rate limits, error handling
├── utils/          small shared helpers
└── scripts/        one-off scripts (sample data)
```

Each of the bigger folders has its own README.

---

## Top-level files

| File          | What it does                                                                                              |
| ------------- | --------------------------------------------------------------------------------------------------------- |
| `src/index.js`| Connects to MongoDB, starts the HTTP server, and shuts down cleanly on Ctrl+C. Also prints whether AI is on. |
| `src/app.js`  | Assembles Express: security headers, CORS, compression, JSON parsing, request logs, routes, error handling.  |

## `config/`

| File           | What it does                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------------- |
| `env.js`       | Reads `.env`, checks every value, and exits with a clear message if something is missing or malformed.    |
| `db.js`        | Opens the one MongoDB connection the whole app shares, and logs connect/disconnect events.                |
| `constants.js` | The allowed categories, meal types and investment types. Changing a list here changes it everywhere.       |

## `utils/`

| File             | What it does                                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------------- |
| `ApiError.js`    | An error that is safe to show a user. Anything else is treated as a bug and hidden behind a 500.    |
| `asyncHandler.js`| Wraps async route handlers so a failed promise reaches the error handler instead of hanging.        |
| `logger.js`      | Timestamped `info` / `warn` / `error` logging.                                                      |
| `dates.js`       | Start/end of day, month, and the `?range=month` → date window conversion. Also builds chart buckets. |
| `ids.js`         | Converts a user id to a MongoDB ObjectId. Needed because aggregations do not cast automatically.    |

## `scripts/`

| File      | What it does                                                                       |
| --------- | ------------------------------------------------------------------------------------ |
| `seed.js` | Fills an existing account with ~45 days of believable sample data. Safe to re-run.    |

---

## Where things happen

```
HTTP request
    │
    ▼
middleware   auth → rate limit → validate the body
    │
    ▼
route        picks the controller
    │
    ▼
controller   pulls values off the request
    │
    ▼
service      talks to MongoDB
```

Chat is the one path that takes a detour through `ai/` before reaching the services.

---

## Security notes

* Passwords are hashed with bcrypt and never returned, even by accident — the User model strips the
  hash in `toJSON()`.
* Login returns the same message for a wrong password and an unknown email, so the API cannot be
  used to discover which addresses have accounts.
* Google ID tokens are verified server-side against Google's public keys, and only accepted when the
  email is marked verified. The browser is never trusted.
* API keys saved from Settings are encrypted with AES-256-GCM before they touch MongoDB, and are
  never sent back to the browser — only a masked hint.
* Every query is scoped to `req.user._id`, so one account can never read another's data.
* Sessions are stateless JWTs. A token that is expired, tampered with, signed by a different
  secret, or belongs to a deleted account is rejected the same way — 401, and the client clears it
  and returns to sign-in.
* Rate limits sit on the whole API, tighter on auth, tighter still on chat.
* API keys stay on the server. The browser only ever learns *whether* AI is configured.

---

## Sign in with Google

Optional. Set one value in `.env` and restart:

```ini
GOOGLE_CLIENT_ID=xxxxx.apps.googleusercontent.com
```

There is **no client secret**. This uses the Google Identity Services ID-token flow: the browser
gets a signed token, the server verifies it, and then issues its own JWT like any other sign-in.

Leave it blank and the button simply does not appear — email and password keep working.

See [src/services/googleAuthService.js](src/services/googleAuthService.js) for the verification step.
