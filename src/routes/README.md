# `routes/` — the API surface

Every URL the server answers, and the middleware each one passes through.

Routes stay thin on purpose: they wire a URL to a controller and nothing else.

---

## Files

| File                     | Mounted at          |
| ------------------------ | ------------------- |
| `index.js`               | `/api`              |
| `auth.routes.js`         | `/api/auth`         |
| `ai.routes.js`           | `/api/ai`           |
| `chat.routes.js`         | `/api/chat`         |
| `dashboard.routes.js`    | `/api/dashboard`    |
| `expense.routes.js`      | `/api/expenses`     |
| `health.routes.js`       | `/api/meals`        |
| `investment.routes.js`   | `/api/investments`  |
| `customAgent.routes.js`  | `/api/agents`       |

`index.js` also serves two small endpoints of its own: `/api/health` for uptime checks and
`/api/meta` for the category lists the client uses to build dropdowns.

It also serves `/api/status`, which reports what is working and carries any notice the operator set
in `.env`. It needs no token on purpose — the sign-in page is exactly where someone needs to be told
the service is having trouble.

Everything after `/health`, `/status` and `/meta` sits behind a small guard that returns a readable
503 when the database is unreachable, instead of letting each query hang and fail obscurely.

### Paging

Every list endpoint takes `?limit=` and `?offset=` and answers with a `page` block:

```json
{ "items": […], "summary": {…}, "page": { "limit": 50, "offset": 0, "total": 143, "hasMore": true } }
```

`limit` defaults to 50 and is capped at 100. `summary` is always computed over the **whole range**,
not the page — the charts and totals must not change as you load more rows.

List queries sort by `_id` last. Without that tiebreaker, rows sharing a date have no stable order
between queries, and `skip` shows the same row on two pages while hiding another.

---

## Endpoints

### Open — no sign-in needed

| Method | Path                 | Does                                    |
| ------ | -------------------- | --------------------------------------- |
| `GET`  | `/api/health`        | Is the server up?                       |
| `GET`  | `/api/meta`          | Allowed categories, meal and fund types |
| `GET`  | `/api/auth/providers`| Is Google sign-in on? Returns the public client id |
| `POST` | `/api/auth/register` | Create an account, returns a token      |
| `POST` | `/api/auth/login`    | Sign in, returns a token                |
| `POST` | `/api/auth/google`   | Sign in with a Google ID token          |

### Signed in — send `Authorization: Bearer <token>`

| Method   | Path                          | Does                                          |
| -------- | ----------------------------- | --------------------------------------------- |
| `GET`    | `/api/auth/me`                | Who am I?                                     |
| `PATCH`  | `/api/auth/me`                | Update name, currency, budget, calorie goal   |
| `GET`    | `/api/ai/settings`            | My AI provider, model and key hint            |
| `PUT`    | `/api/ai/settings`            | Save provider / model / key                   |
| `DELETE` | `/api/ai/settings`            | Drop my key, fall back to the server default  |
| `POST`   | `/api/ai/models`              | List the models this key can use              |
| `POST`   | `/api/ai/test`                | One live call to check the key works          |
| `POST`   | `/api/chat`                   | Send a message (omit `conversationId` for a new thread) |
| `GET`    | `/api/chat/conversations`     | My chat threads, newest first                 |
| `GET`    | `/api/chat/conversations/:id` | Every message in one thread                   |
| `DELETE` | `/api/chat/conversations/:id` | Delete a thread (keeps the data it created)   |
| `GET`    | `/api/chat/status`            | Is AI ready? Which provider and model?        |
| `POST`   | `/api/import/extract`         | Read an uploaded bill or statement. Saves nothing |
| `POST`   | `/api/import/confirm`         | Save the rows the user ticked                 |
| `GET`    | `/api/dashboard`              | Everything the home screen needs. `?period=today\|month` |
| `GET`    | `/api/expenses`               | List + summary. `?range=month&category=food`  |
| `POST`   | `/api/expenses`               | Add one by hand                               |
| `DELETE` | `/api/expenses/:id`           | Remove one                                    |
| `GET`    | `/api/meals`                  | List + nutrition summary. `?range=week`       |
| `POST`   | `/api/meals`                  | Log one by hand                               |
| `DELETE` | `/api/meals/:id`              | Remove one                                    |
| `GET`    | `/api/investments`            | List + summary. `?range=year&type=sip`        |
| `POST`   | `/api/investments`            | Add one by hand                               |
| `DELETE` | `/api/investments/:id`        | Remove one                                    |

`range` accepts `today`, `week`, `month`, `last_month`, `year`, `all`.

---

## What a request passes through

```
request
   │
   ▼
apiLimiter        200 requests a minute (authLimiter and chatLimiter are stricter)
   │
   ▼
requireAuth       reads the Bearer token, loads req.user
   │
   ▼
validateBody      Zod checks the body and replaces it with the clean version
   │
   ▼
controller  →  service  →  MongoDB
   │
   ▼
errorHandler      only if something threw
```

## The two neighbouring folders

**`controllers/`** — one file per area. A controller reads values off the request, calls a service,
and sends the result. It holds no database code and no business rules.

| File                       | Handles                                       |
| -------------------------- | --------------------------------------------- |
| `authController.js`        | Register, login, Google, profile              |
| `aiSettingsController.js`  | AI provider, key, model list, connection test |
| `chatController.js`        | Chat, threads, AI status                      |
| `importController.js`      | Reading bills and statements                  |
| `dashboardController.js`   | The home screen payload                       |
| `expenseController.js`     | Expense list / create / delete                |
| `healthController.js`      | Meal list / create / delete                   |
| `investmentController.js`  | Investment list / create / delete             |

**`middleware/`** — the things every request goes through.

| File               | Does                                                                              |
| ------------------ | --------------------------------------------------------------------------------- |
| `auth.js`          | Verifies the JWT and attaches `req.user`. Also signs new tokens.                   |
| `validate.js`      | Runs a Zod schema over the body or query, so controllers get clean data.           |
| `upload.js`        | Multipart handling for imports. Memory only — nothing touches the disk.            |
| `rateLimit.js`     | Three limits: whole API, auth attempts, chat messages.                             |
| `errorHandler.js`  | Turns known problems into readable messages and unknown ones into a plain 500.     |

---

## Response shapes

Success returns the data directly:

```json
{ "items": [ ... ], "summary": { ... } }
```

Failure always looks the same, whatever went wrong:

```json
{ "error": { "message": "Please check the submitted fields", "details": [ ... ] } }
```
