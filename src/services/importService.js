/**
 * Reading a bill or statement and turning it into records.
 *
 * Two deliberate steps: **extract** returns what the model found and saves
 * nothing, then **confirm** saves only the rows the user ticked. One file can
 * contain fifty lines, and writing those straight to someone's finances on a
 * model's say-so is not a trade worth making.
 */
import { askJson } from '../ai/llm.js';
import { documentPlanSchema } from '../ai/schemas.js';
import { buildDocumentPrompt } from '../ai/prompts.js';
import { readDocument } from './documentService.js';
import { resolveForUser } from './aiSettingsService.js';
import * as expenseService from './expenseService.js';
import * as healthService from './healthService.js';
import * as investmentService from './investmentService.js';
import { toDateKey } from '../utils/dates.js';
import { categoriesFor } from '../utils/categories.js';
import { parseDraftDate } from '../ai/agents/shared.js';

export async function extractFromFile(user, file) {
  const document = await readDocument(file);
  const config = await resolveForUser(user._id);

  const instruction =
    document.kind === 'image'
      ? 'Read the attached image and extract every transaction on it.'
      : `Read this document and extract every transaction.\n\n---\n${document.text}\n---`;

  const plan = await askJson({
    config,
    system: buildDocumentPrompt({
      today: toDateKey(new Date()),
      currency: user.currency,
      categories: categoriesFor(user)
    }),
    user: instruction,
    images: document.images,
    schema: documentPlanSchema,
    // Statements can be long; leave room for many rows.
    maxTokens: 4000
  });

  return {
    documentType: plan.documentType || 'Document',
    summary: plan.summary,
    // Real dates, so the client can show and edit them.
    expenses: plan.expenses.map((e) => ({ ...e, date: parseDraftDate(e.date) })),
    meals: plan.meals.map((m) => ({ ...m, date: parseDraftDate(m.date) })),
    investments: plan.investments.map((i) => ({ ...i, date: parseDraftDate(i.date) }))
  };
}

/** Saves the reviewed rows. Everything has already been re-validated by Zod. */
export async function saveApproved(userId, { expenses, meals, investments }) {
  const options = { source: 'import' };

  const [savedExpenses, savedMeals, savedInvestments] = await Promise.all([
    expenseService.createExpenses(userId, expenses, options),
    healthService.createMeals(userId, meals, options),
    investmentService.createInvestments(userId, investments, options)
  ]);

  return {
    expenses: savedExpenses.length,
    meals: savedMeals.length,
    investments: savedInvestments.length
  };
}
