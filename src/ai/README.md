# `ai/` — the agents and the AI providers

This folder is the brain. It takes a sentence like

> "I spent ₹200 on food and ₹100 on Rapido. I had paneer, dal and two rotis."

and turns it into rows in the database.

---

## The golden rule

**The AI never writes to MongoDB.**

It only produces JSON. That JSON is checked against a schema, and only then do the agents save
anything. This is what keeps the system predictable — a model cannot invent a category, a negative
amount, or a field that does not exist.

---

## The flow

```
your message
     │
     ▼
orchestrator.js
     │   one AI call: last few turns of this thread + your message → a plan
     ▼
schemas.js        rejects anything that does not fit
     │
     ├─ clarify → ask one question back, save nothing
     │
     ├──────────────┬──────────────┬───────────────┐
     ▼              ▼              ▼               ▼
expenseAgent   healthAgent   investmentAgent   analystAgent
     │              │              │           (only for questions)
     └──────────────┴──────────────┘
                    │
                    ▼
                services/  →  MongoDB
                    │
                    ▼
              AgentRun saved
              (the trace you see in the chat UI)
```

Agents that are needed run **at the same time**, not one after another.

---

## Asking instead of guessing

"I had paneer butter masala" could be 80 kcal or 400 depending on the portion. Silently picking one
and showing it as a number is misleading, so the planner has a fourth intent: `clarify`.

```
You:  I had paneer butter masala
AI:   How much paneer butter masala? I'll log 1 katori (about 150 g) unless you say otherwise.
You:  one katori
AI:   Meal logged — Paneer butter masala (1 katori (150 g)). Roughly 280 kcal, 9 g protein.
```

Nothing is written on the first turn. Three things keep this from becoming annoying:

* It only asks when the portion genuinely changes the answer — curries, rice, meat, sweets.
  "Two rotis and a glass of milk" is recorded straight away.
* The question always contains a default, so "yes" is a valid answer.
* `quantity` is a **required** field on every food item, so a saved meal always says what portion it
  assumed. The confirmation repeats it back to you.

---

## Agents the user builds

Expense, health and investment are written in this folder. A user can add more from
**Settings → Your agents** without anyone touching the code.

They give three things, and each one maps onto a real part of the pipeline:

| They provide | It becomes |
| ------------ | ---------- |
| A **name** — "Workouts" | The agent's id in the plan (`workouts`), its sidebar entry and its URL |
| The **stats** it tracks — Distance (km), Duration (mins) | The schema its data is validated against |
| A **prompt** in their own words | Extra instructions pasted into the planner |

At the start of every message the orchestrator loads that user's active agents and hands them to
`buildPlannerPrompt`, which grows a `"custom"` array and an extra block of rules describing them.
Users with no custom agents get the original prompt unchanged — there is no cost to not using this.

```
You:  Went for a 5 km run this morning, took 32 minutes
AI:   Workouts: Morning run — 5 km distance, 32 mins duration.
```

The safety rule is the same as everywhere else in this folder: **the model proposes, code decides**.
It returns `{ "agent": "workouts", "title": "Morning run", "values": { "distance": 5, ... } }`, and
`customAgentService.coerceValues` throws away any key the user did not define and forces every
number field to be a number. An agent cannot invent a field, and a message naming an agent the user
does not have is dropped rather than guessed at.

### Why there is a limit

`MAX_CUSTOM_AGENTS` in `.env` (default **2**) is a quality dial, not an artificial one. Every agent's
name, fields and prompt are added to the planner prompt on **every single message**, so each one
costs tokens and gives the model one more thing to confuse. Two is comfortable; ten would make the
built-in agents noticeably worse at their jobs. Raise it if you want, and watch your accuracy.

---

## The Tips button

Every data screen has one. It is not part of the chat pipeline — the page posts its domain and the
range it is showing (`{ "domain": "expense", "range": "month" }`) and gets back a headline plus two
to four tips.

The browser never sends any rows. `facts.js` reads the summary from MongoDB on the server, exactly
as the analyst does for a question, and only that summary reaches the model. So a tip can quote your
real numbers but cannot invent one.

Two rules in the prompt matter more than the rest:

* **Be specific or say nothing.** "Spend less" is banned; a tip has to quote the figure it is based
  on. With almost no data logged the model is told to say so rather than pad.
* **No professional advice.** Habits, not diagnoses or specific securities.

It shares the chat rate limit, because it is the same kind of live call to your provider.

---

## Files

| File              | What it does                                                                                                                                 |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `orchestrator.js` | The coordinator. Gets the plan, decides which agents to call, collects their results, writes the reply, and saves the trace as an `AgentRun`. Passes the last 5 turns of the thread to the planner and the analyst. |
| `llm.js`          | The universal controller. `askText()` and `askJson()` are the only two functions the rest of the app uses. Nothing else knows which model is on. |
| `schemas.js`      | The contract. Every shape the AI is allowed to return, written as Zod schemas. Also reused to validate manually submitted forms.                 |
| `prompts.js`      | All prompt wording, in one place, so tuning the AI never means editing logic.                                                                    |
| `facts.js`        | Reads a user's real numbers out of MongoDB for a set of domains. Shared by the analyst and the tips button so neither can drift from the other.   |
| `tips.js`         | The "Tips" button. Same contract as the analyst: fetch the numbers first, let the model only reason about them.                                  |
| `json.js`         | Pulls a JSON object out of a reply, even when the model wraps it in ``` fences or adds a sentence first.                                        |

### `agents/`

| File                  | What it does                                                                                                     |
| --------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `expenseAgent.js`     | Validates and saves expense rows. Reports how many it saved and the total.                                          |
| `healthAgent.js`      | Validates and saves meals with their estimated nutrition. Always calls the numbers estimates.                        |
| `investmentAgent.js`  | Validates and saves investment contributions.                                                                        |
| `customAgent.js`      | Built at runtime from a user's own agent definition. Same contract as the three above — the difference is that its schema comes from the database rather than this folder. |
| `analystAgent.js`     | For questions, not for saving. Fetches real numbers from MongoDB first, then asks the model to phrase them.           |
| `shared.js`           | Turns the AI's `YYYY-MM-DD` string into a real date, and falls back to "now" if it is missing or nonsensical.        |
| `index.js`            | Re-exports the agents so the orchestrator has one import.                                                            |

### `providers/`

| File            | What it does                                                                                                       |
| --------------- | -------------------------------------------------------------------------------------------------------------------- |
| `catalog.js`    | The list of supported providers with their default endpoint and model. Adding a hosted provider is one line here.     |
| `index.js`      | Reads `.env` and builds the one provider the app will use. Also reports *why* AI is off when it is.                   |
| `openai.js`     | Talks to anything using the OpenAI `/chat/completions` format.                                                        |
| `gemini.js`     | Talks to Google's `generateContent` API.                                                                             |
| `anthropic.js`  | Talks to Anthropic's `/messages` API.                                                                                |
| `http.js`       | Shared POST helper: timeouts, and turning a provider's error blob into one readable sentence.                         |

---

## Using any AI key

There are two places a key can come from, checked in this order:

1. **Settings in the app** — each user picks a provider, pastes a key and chooses a model. Stored
   encrypted. This is how you rotate an expired key without redeploying.
2. **`server/.env`** — the default for a fresh deployment.

Either way it is two values:

```ini
LLM_PROVIDER=gemini
LLM_API_KEY=your-key
```

| `LLM_PROVIDER` | Talks to                     | Default model                            | Key needed |
| -------------- | ---------------------------- | ---------------------------------------- | ---------- |
| `openai`       | OpenAI                       | `gpt-4o-mini`                            | yes        |
| `gemini`       | Google Gemini                | `gemini-flash-lite-latest`               | yes        |
| `anthropic`    | Anthropic Claude             | `claude-3-5-haiku-latest`                | yes        |
| `groq`         | Groq                         | `llama-3.3-70b-versatile`                | yes        |
| `openrouter`   | OpenRouter                   | `meta-llama/llama-3.3-70b-instruct`      | yes        |
| `together`     | Together AI                  | `meta-llama/Llama-3.3-70B-Instruct-Turbo`| yes        |
| `deepseek`     | DeepSeek                     | `deepseek-chat`                          | yes        |
| `mistral`      | Mistral                      | `mistral-large-latest`                   | yes        |
| `ollama`       | Ollama on your machine       | `llama3.1`                               | no         |
| `lmstudio`     | LM Studio on your machine    | `local-model`                            | no         |
| `custom`       | Any OpenAI-compatible server | set `LLM_MODEL` yourself                 | optional   |

Override the model or endpoint any time:

```ini
LLM_MODEL=gpt-4o
LLM_BASE_URL=https://my-gateway.internal/v1
```

Two things guided the default models:

* Prefer a `-latest` style alias. Pinned model names get retired, and then every request fails
  with a 404.
* Prefer the small/fast tier. Turning a sentence into JSON is not hard work, and the larger models
  now reason before answering — on Gemini that was 15 seconds versus under one.

If you want more capability, set `LLM_MODEL` yourself. Nothing else has to change.

### Adding a provider

* **Speaks the OpenAI format?** Add one entry to `catalog.js`. Done.
* **Has its own format?** Add a file to `providers/` that returns an object with `complete()` and
  `listModels()`, then register it in `providers/index.js`.

Settings can also call `listModels()` with the user's key, so the dropdown shows what that key can
actually use rather than a hardcoded list that goes stale.

---

## Why there are two AI calls, sometimes

* **Saving something** → one call. The confirmation ("Expense of ₹300 recorded") is written by
  code, not the model. It costs nothing, is always the same, and can never contain a made-up number.
* **Asking a question** → two calls. The first works out what you are asking; the second turns the
  real figures into a sentence.

## When the model misbehaves

`askJson()` retries once, telling the model exactly which field was wrong. If the second attempt
also fails it raises a clear 503 rather than saving half-understood data.

Two things in `schemas.js` stop most of those retries happening at all:

* **`null` is treated as "empty".** Models write `"clarify": null` where they mean `""`, and Zod's
  `.default()` only fires for *missing* keys. Every optional field goes through a helper that maps
  `null` to `''`, `0` or `[]`.
* **Enums self-correct.** `.catch()` means an unexpected value falls back to a sensible default
  instead of failing the whole plan. Asking "how much on travel?" used to break because the model
  answered with the category `travel` where a domain was expected; now it lands on `expense`.

The HTTP form schemas deliberately keep strict enums — a bad category from a client is a caller
bug and should get a 400, not be quietly filed under "other".

Provider errors are translated too, so a user sees "Google Gemini is rate limiting you" or
"...does not have that model. Pick another one in Settings" rather than a bare status code.
