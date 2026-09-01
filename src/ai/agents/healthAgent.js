/**
 * Health & Nutrition Agent — owns meals and their estimated nutrition.
 *
 * Nutrition values arrive as AI estimates. The agent keeps them within sane
 * bounds and always labels them as estimates in its summary.
 */
import { mealDraftSchema } from '../schemas.js';
import * as healthService from '../../services/healthService.js';
import { parseDraftDate } from './shared.js';

export const healthAgent = {
  name: 'health',
  label: 'Health Agent',

  async run({ userId, drafts, agentRunId }) {
    const valid = [];
    const rejected = [];

    for (const draft of drafts) {
      const result = mealDraftSchema.safeParse(draft);
      if (result.success) {
        valid.push({ ...result.data, date: parseDraftDate(result.data.date) });
      } else {
        rejected.push(draft);
      }
    }

    if (valid.length === 0) {
      return { created: [], rejected, summary: 'No meal details found in the message.' };
    }

    const created = await healthService.createMeals(userId, valid, {
      source: 'chat',
      agentRun: agentRunId
    });

    const totals = created.reduce(
      (acc, meal) => ({
        calories: acc.calories + meal.totals.calories,
        protein: acc.protein + meal.totals.protein
      }),
      { calories: 0, protein: 0 }
    );
    const round = (n) => Math.round(n);
    const itemCount = created.reduce((sum, meal) => sum + meal.items.length, 0);

    return {
      created,
      rejected,
      totals: { calories: round(totals.calories), protein: round(totals.protein) },
      summary: `Logged ${itemCount} food item${itemCount === 1 ? '' : 's'} at roughly ${round(totals.calories)} kcal (estimated).`
    };
  }
};
