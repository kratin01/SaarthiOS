/**
 * Expense Agent — owns everything about money going out.
 *
 * The AI has already produced draft rows. This agent re-validates them against
 * the schema, normalises dates, saves them, and reports back what it did.
 */
import { expenseDraftSchema } from '../schemas.js';
import * as expenseService from '../../services/expenseService.js';
import { parseDraftDate } from './shared.js';

export const expenseAgent = {
  name: 'expense',
  label: 'Expense Agent',

  async run({ userId, drafts, agentRunId }) {
    const valid = [];
    const rejected = [];

    for (const draft of drafts) {
      const result = expenseDraftSchema.safeParse(draft);
      if (result.success && result.data.amount > 0) {
        valid.push({ ...result.data, date: parseDraftDate(result.data.date) });
      } else {
        rejected.push(draft);
      }
    }

    if (valid.length === 0) {
      return { created: [], rejected, summary: 'No valid expense found in the message.' };
    }

    const created = await expenseService.createExpenses(userId, valid, {
      source: 'chat',
      agentRun: agentRunId
    });

    const total = valid.reduce((sum, e) => sum + e.amount, 0);
    const noun = created.length === 1 ? 'expense' : 'expenses';

    return {
      created,
      rejected,
      total,
      summary: `Recorded ${created.length} ${noun} totalling ${total}.`
    };
  }
};
