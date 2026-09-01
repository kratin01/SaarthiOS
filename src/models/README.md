# `models/` — what the data looks like

Each file is one MongoDB collection, described with Mongoose.

Every record except `User` belongs to a user and carries a `date`, so every dashboard can filter by
"who" and "when" without extra work.

---

## Files

| File            | Collection      | Holds                                                       |
| --------------- | --------------- | ----------------------------------------------------------- |
| `User.js`       | `users`         | The account, currency, monthly budget and calorie goal       |
| `Expense.js`    | `expenses`      | One thing you spent money on                                 |
| `Meal.js`       | `meals`         | One meal, with its food items and estimated nutrition        |
| `Investment.js` | `investments`   | One contribution — a SIP instalment, a lump sum, and so on   |
| `Conversation.js`| `conversations`| One chat thread                                              |
| `AgentRun.js`   | `agentruns`     | One message in a thread, and what the agents did with it     |
| `AiSetting.js`  | `aisettings`    | Which AI provider a user picked, and their encrypted key     |
| `CustomAgent.js`| `customagents`  | An agent the user built: its name, prompt and the stats it tracks |
| `CustomEntry.js`| `customentries` | One row logged by a custom agent                             |
| `index.js`      | —               | Re-exports all of them so other files have one import        |

---

## `User`

Password is stored as a bcrypt hash in `passwordHash`, which is `select: false` — it is not even
loaded unless a query asks for it. `toJSON()` deletes it as a second safety net, so it can never be
sent to the browser.

`passwordHash` is **optional**: an account created through "Continue with Google" has no password at
all. Those accounts carry `googleId` instead — Google's permanent user id, indexed `unique` and
`sparse` so password-only accounts are still allowed.

An account can have both. That happens when someone signs up with a password and later uses Google
with the same address; the two get linked, which is safe because Google confirms the address is
verified before we accept it.

`monthlyBudget` and `dailyCalorieGoal` are what the dashboard compares against when it says
"you have used 85% of your budget".

`heightCm`, `weightKg` and `bodyGoal` are the body profile filled in on the Health page. They are
null until the user sets them. They are stored rather than just used once because `bodyGoal` decides
how the calorie and protein targets are worked out, and the user can come back and recalculate.

## `Expense`

```
amount     500
category   food          (one of the list in config/constants.js)
merchant   "Swiggy"      optional
date       when it happened
source     "manual" or "chat"
agentRun   which chat message created it, if any
```

## `Meal`

A meal holds a list of `items`, and each item has its own calories and macros.

`totals` is the sum of those items. It is filled in automatically by a `pre('validate')` hook, so
no caller can forget to update it and dashboards never have to add things up at read time.

Nutrition values are **estimates**. The UI says so wherever it shows them.

## `Investment`

Records money going *in*: `amount`, `type` (sip, mutual fund, gold…) and an optional `instrument`
name like "Parag Parikh Flexi Cap".

`amount` is always the **total paid**, never a per-unit price. For shares, `quantity` holds the
number bought, which makes the buy price `amount / quantity` — derived rather than stored, so the
two can never disagree.

`symbol` is the ticker used to fetch a price, e.g. `RELIANCE.NS`. It is usually left blank: the
first time you check prices, it is looked up from `instrument` and written back, so the lookup
happens once per holding and nobody has to know Yahoo's exchange suffixes.

Only types in `QUANTITY_TYPES` (currently just `stocks`) carry a quantity. A SIP contribution is an
amount, not a unit count, so it stays null and is left out of the valuation.

## `AgentRun`

The audit trail. One row per chat message:

* `conversation` — the thread it belongs to
* `message` — what you typed
* `reply` — what came back
* `intent` — `record`, `query`, `clarify` or `chat`
* `steps` — the timeline shown in the Agent Activity panel
* `created` — how many expenses / meals / investments this message produced
* `durationMs` — how long it took

Rows written by chat point back at their `AgentRun`, so you can always trace a number to the
sentence that created it.

## `Conversation`

A chat thread. "New chat" makes one; the sidebar lists them newest first, titled from the first
message.

Threads are not only for tidiness — the orchestrator reads the last few turns of the current thread
before planning. That is what lets "2 bowls" be understood as the answer to the portion question it
asked a moment ago.

Deleting a thread removes its messages but **keeps** the expenses and meals they created. Deleting a
chat should not quietly delete your data.

## `AiSetting`

One row per user: chosen provider, model, optional base URL, and the API key.

The key is stored as AES-256-GCM ciphertext with its own IV and auth tag. `keyHint` holds something
like `AQ.Ab…5xKq` so Settings can show which key is saved without being able to reveal it.

This lives in its own collection rather than on `User` on purpose: `User` is serialised to the
browser on nearly every request, and a secret should never be one forgotten `delete` away from
being sent to the client.

---

## `CustomAgent` and `CustomEntry`

`CustomAgent` is an agent a user built in Settings. `fields` is the interesting part — it is a
schema the user designed, and everything else follows from it: what the AI is allowed to fill in,
what the page shows, and what the add form asks for.

`CustomEntry` holds the rows those agents collect. **Every custom agent shares this one
collection**, keyed by `agent`, rather than getting a collection of its own. A collection per agent
would mean creating collections at runtime, with no fixed indexes and no sensible way to migrate
them later. The compound index `{ user: 1, agent: 1, date: -1 }` makes reads just as fast.

`values` is a `Map` keyed by `fields[].key`, so it is validated by the agent definition rather than
by Mongoose. Renaming a stat in Settings keeps its key, which means existing rows keep their data.

---

## Indexes

Every data collection has a `{ user: 1, date: -1 }` index. That is the shape of almost every query
the app makes: "this user's records, newest first, in a date window".

`users` also has a unique index on `googleId`, and it is **partial**, not sparse:

```js
{ unique: true, partialFilterExpression: { googleId: { $type: 'string' } } }
```

This one is worth understanding. A *sparse* index only skips documents where the field is missing.
If the schema writes `googleId: null` into every password-only account, a sparse unique index treats
those nulls as values — so the **second** password account collides with the first and registration
fails with a duplicate key error. A partial index on `$type: 'string'` ignores nulls and missing
fields alike, so only real Google ids are ever compared.

If you ran an early version of this app, `npm run migrate:google-index` clears the stray nulls and
rebuilds the index.
