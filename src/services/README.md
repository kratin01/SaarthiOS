# `services/` — the data layer

Everything that reads or writes personal data goes through this folder.

Both routes work through it:

```
HTTP form  →  controller  ─┐
                           ├──→  service  →  MongoDB
chat       →  AI agent   ──┘
```

That means a rule only has to be written once. Whether an expense arrives from a form or from a
sentence, it is created the same way.

---

## Files

| File                   | Looks after                                        |
| ---------------------- | -------------------------------------------------- |
| `expenseService.js`    | Expenses: create, list, delete, summarise           |
| `healthService.js`     | Meals and nutrition                                 |
| `investmentService.js` | Investment contributions                            |
| `dashboardService.js`  | The combined home screen, and the insight lines     |
| `documentService.js`   | Turning an uploaded file into text or images        |
| `importService.js`     | Reading a bill or statement, then saving what was approved |
| `aiSettingsService.js` | Which AI provider and key each user uses            |
| `customAgentService.js`| Agents the user built, and the rows they collect    |
| `bodyProfileService.js`| BMI, and the calorie and protein targets it suggests |
| `marketService.js`     | Live share prices, and turning a company name into a ticker |
| `statusService.js`     | What is working, and what to tell people when it is not |
| `googleAuthService.js` | Verifying Google ID tokens                          |

The first four are data services and share the shape below. The rest talk to files or the outside
world, and are documented at the end.

---

## The shape they share

Each of the first three exposes the same four ideas:

| Function                  | What it gives you                                                   |
| ------------------------- | ------------------------------------------------------------------- |
| `create…(userId, input)`  | Saves one record. Takes `{ source, agentRun }` so chat rows are tagged. |
| `create…s(userId, [ … ])` | Saves several at once — one chat message can contain several.        |
| `list…(userId, opts)`     | Records in a date window, newest first.                              |
| `summarise…(userId, range)` | The numbers the charts need.                                        |

A summary always contains:

* a **total**
* a **breakdown** — by category, by type, by meal
* a **series** — one point per day or per month, with empty days filled in so charts have no gaps

---

## `dashboardService.js`

The only service that reads across all three areas. It returns everything the home screen needs in
one response, so the page makes a single request.

It takes a **period** — `today` (the default) or `month` — and every number on the page follows it:

| | `today` | `month` |
| --- | --- | --- |
| Totals | Today only | Month to date |
| Compared against | Yesterday | Last month |
| Chart | Last 7 days, for context | Each day of the month |
| Calories | Today's total | Average per logged day |
| Budget | Not shown | Shown |

A monthly budget against a single day would be meaningless, and a month's raw calorie total against
a daily goal even more so — hence the two exceptions.

It also builds `insights` — the short lines at the top of the overview:

> "You have used 85% of your monthly budget."
> "Spending today is 62% lower than yesterday. Nice."

These are **plain arithmetic, not AI**. They are instant, free, and available even when no API key
is configured. They reword themselves to match the selected period.

---

## Two details worth knowing

**Date ranges.** Anything taking a `range` accepts `today`, `week`, `month`, `last_month`, `year`
or `all`. `utils/dates.js` turns that word into a real `from`/`to` window, so the API and the AI
agree on what "this month" means.

**Object ids.** Mongoose casts ids in `find()` but *not* inside an aggregation `$match`. Every
aggregation here passes the user id through `toObjectId()`. Forgetting this returns an empty result
with no error, which is a confusing bug to chase.

---

## `documentService.js` and `importService.js`

Importing a bill, receipt or bank statement.

`documentService` turns an upload into something a model can read:

| File | How it is read |
| --- | --- |
| PNG, JPEG, WebP | Sent to the model as an image |
| PDF | Text extracted with `unpdf`, then sent as text |
| CSV, TXT | Sent as text |

Text is capped at 20,000 characters, and a PDF with almost no text is reported as "probably
scanned" rather than silently returning nothing. Files are held in memory and never written to
disk, which removes an entire category of upload problems.

`importService` is deliberately **two steps**:

1. `extractFromFile` returns what the model found and **saves nothing**.
2. `saveApproved` writes only the rows the user ticked, re-validated by the same Zod schemas the
   rest of the app uses, and tagged `source: 'import'`.

One statement can hold fifty lines. Writing those straight into someone's finances on a model's
say-so is not a trade worth making, so the review step is not optional.

---

## `aiSettingsService.js`

Decides which AI provider and key every request should use:

1. What the user saved in Settings — so rotating an expired key is a UI action, not a redeploy.
2. The `.env` values — a default for a fresh deployment, or for users who never set their own.

`statusForUser()` is what Settings and the chat header read. It reports the provider, model and a
masked hint, and `source` so the UI can say whether you are on your own key or the server default.
It never returns the key.

If `ENCRYPTION_KEY` (or `JWT_SECRET`, when that is what is in use) changes, saved keys stop
decrypting. That case is detected and reported as "please enter it again" rather than failing
silently.

---

## `googleAuthService.js`

The browser sends us a Google ID token. This file decides whether to believe it.

1. `verifyIdToken()` checks the signature against Google's public keys, and that the token was
   issued **for our client id** — a token minted for some other app is rejected.
2. `email_verified` must be true. Without that check, someone could claim an address they do not own
   and take over the matching password account.
3. Only then does it return `{ googleId, email, name, avatarUrl }`.

It never returns partly verified data — anything wrong throws an `ApiError`.

When `GOOGLE_CLIENT_ID` is blank the whole feature is off and the endpoint answers with a clear 503.
