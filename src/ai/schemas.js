/**
 * The contract between the AI and the database.
 *
 * The model returns JSON, this file decides whether that JSON is acceptable,
 * and only then do the agents write anything. Anything outside these shapes is
 * rejected — the AI can never invent a category or a negative amount.
 */
import { z } from 'zod';
import { MEAL_TYPES, INVESTMENT_TYPES, BODY_GOALS } from '../config/constants.js';

const money = z.coerce.number().finite().min(0).max(100_000_000);

/**
 * Models write `null` where they mean "nothing here", and Zod's `.default()`
 * only fires for missing/undefined keys. Without these two helpers a stray
 * `"clarify": null` fails the whole plan and the user sees
 * "The AI response did not match the expected format".
 */
const text = (max) =>
  z
    .string()
    .max(max)
    .nullish()
    .transform((v) => v ?? '');

const number = (max) =>
  z.coerce
    .number()
    .finite()
    .min(0)
    .max(max)
    .nullish()
    .transform((v) => v ?? 0);

const list = (item) =>
  z
    .array(item)
    .nullish()
    .transform((v) => v ?? []);

const grams = number(5000);

/** Accepts `2026-08-31`; anything else falls back to "now" in the agent. */
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullish();

/**
 * A category name can be anything the user invented, so this never rejects.
 * Losing a whole expense because a model returned an odd category would be a
 * far worse outcome than filing it under "other".
 */
const categoryText = z
  .any()
  .transform((v) => (typeof v === 'string' ? v.slice(0, 60) : ''));

export const expenseDraftSchema = z.object({
  amount: money,
  // The set of valid names is per user, so `expenseService.resolveCategory`
  // decides what this becomes.
  category: categoryText,
  merchant: text(120),
  note: text(300),
  date: isoDate
});

export const foodItemDraftSchema = z.object({
  name: z.string().min(1).max(120),
  /** Required: an estimate is only honest if it says what portion it assumed. */
  quantity: z.string().min(1).max(60),
  calories: number(10000),
  protein: grams,
  carbs: grams,
  fat: grams
});

export const mealDraftSchema = z.object({
  mealType: z.enum(MEAL_TYPES).catch('snack'),
  items: z.array(foodItemDraftSchema).min(1),
  note: text(300),
  date: isoDate
});

export const investmentDraftSchema = z.object({
  amount: money,
  type: z.enum(INVESTMENT_TYPES).catch('other'),
  instrument: text(140),
  /** Units bought. Null for anything that is not counted in units. */
  quantity: z.coerce
    .number()
    .positive()
    .max(10_000_000)
    .nullish()
    .transform((v) => v ?? null),
  /** Ticker if the model is confident; resolved from the name otherwise. */
  symbol: text(20),
  note: text(300),
  date: isoDate
});

/**
 * A row for a user-built agent. `values` stays loose on purpose: the real
 * checking happens in customAgentService.coerceValues, which is the only place
 * that knows which fields this particular agent declared.
 */
export const customDraftSchema = z.object({
  agent: z.string().min(1).max(40),
  title: z.string().min(1).max(140),
  values: z
    .record(z.union([z.string(), z.number(), z.boolean()]))
    .nullish()
    .transform((v) => v ?? {}),
  note: text(300),
  date: isoDate
});

export const questionSchema = z.object({
  // `.catch` because the model likes to answer with a category such as
  // "travel" instead of the domain that owns it. Custom agent slugs are
  // allowed through untouched and filtered against the user's own agents later.
  domains: z
    .array(z.string().max(40))
    .nullish()
    .transform((v) => (v?.length ? [...new Set(v)] : ['expense'])),
  range: z.enum(['today', 'week', 'month', 'last_month', 'year', 'all']).catch('month')
});

/**
 * Settings the user can change by talking, such as a monthly budget or their
 * height and weight.
 *
 * Every field is optional and `null` means the same as absent. The shared
 * `number()` helper is deliberately not used: it turns a missing value into 0,
 * which here would wipe a budget instead of leaving it alone. An out-of-range
 * value is dropped rather than failing, so one bad figure cannot cost the user
 * the rest of the message.
 */
const optionalNumber = (min, max) =>
  z.coerce
    .number()
    .finite()
    .min(min)
    .max(max)
    .nullish()
    .transform((v) => (v == null ? undefined : v))
    .catch(undefined);

export const profileDraftSchema = z.object({
  monthlyBudget: optionalNumber(0, 100000000),
  dailyCalorieGoal: optionalNumber(500, 20000),
  dailyProteinGoal: optionalNumber(10, 1000),
  heightCm: optionalNumber(50, 260),
  weightKg: optionalNumber(20, 400),
  bodyGoal: z
    .enum(BODY_GOALS)
    .nullish()
    .transform((v) => v ?? undefined)
    .catch(undefined)
});

/** What the orchestrator asks the model to produce for every chat message. */
export const planSchema = z.object({
  intent: z.enum(['record', 'query', 'chat', 'clarify']).catch('chat'),
  expenses: list(expenseDraftSchema),
  meals: list(mealDraftSchema),
  investments: list(investmentDraftSchema),
  custom: list(customDraftSchema),
  profile: profileDraftSchema.nullish().transform((v) => v ?? {}),
  question: questionSchema.nullish(),
  /** The single short question to ask back when intent is `clarify`. */
  clarify: text(300),
  message: text(600)
});

/**
 * Shape of the HTTP body for manually created records.
 * The enums go back to being strict here: a form posting an unknown meal type
 * is a caller bug and should get a 400. Category is the exception, because
 * naming a new one is a feature rather than a mistake.
 */
export const expenseInputSchema = expenseDraftSchema.extend({
  date: z.coerce.date().optional()
});

export const mealInputSchema = mealDraftSchema.extend({
  mealType: z.enum(MEAL_TYPES).default('snack'),
  date: z.coerce.date().optional(),
  items: z.array(foodItemDraftSchema.extend({ quantity: text(60) })).min(1)
});

export const investmentInputSchema = investmentDraftSchema.extend({
  type: z.enum(INVESTMENT_TYPES).default('other'),
  date: z.coerce.date().optional(),
  /**
   * Stricter than the AI path: a ticker typed into the form ends up in an
   * outbound URL, so anything that is not ticker-shaped is a 400 rather than
   * something to clean up later.
   */
  symbol: z
    .string()
    .max(20)
    .regex(/^[A-Za-z0-9][A-Za-z0-9.\-&^=]*$/, 'That does not look like a ticker symbol')
    .or(z.literal(''))
    .nullish()
    .transform((v) => v ?? '')
});

export const customEntryInputSchema = customDraftSchema
  .omit({ agent: true })
  .extend({ date: z.coerce.date().optional() });

/**
 * Editing an existing row. Every field is optional so the client can send only
 * what changed, and anything left out keeps its stored value.
 */
export const expenseUpdateSchema = expenseInputSchema.partial();
export const mealUpdateSchema = mealInputSchema.partial();
export const investmentUpdateSchema = investmentInputSchema.partial();
export const customEntryUpdateSchema = customEntryInputSchema.partial();

/** What the "Tips" button gets back. */
export const tipsSchema = z.object({
  headline: text(300),
  tips: list(
    z.object({
      title: z.string().min(1).max(80),
      detail: text(400)
    })
  )
});

/**
 * What the model returns after reading an uploaded bill or statement.
 * Nothing here is saved directly — the user reviews it first.
 */
export const documentPlanSchema = z.object({
  documentType: text(60),
  summary: text(300),
  expenses: list(expenseDraftSchema),
  meals: list(mealDraftSchema),
  investments: list(investmentDraftSchema)
});

/** The rows the user ticked, posted back for saving. */
export const importConfirmSchema = z
  .object({
    expenses: list(expenseInputSchema),
    meals: list(mealInputSchema),
    investments: list(investmentInputSchema)
  })
  .refine(
    (v) => v.expenses.length + v.meals.length + v.investments.length > 0,
    'Select at least one row to import.'
  );
