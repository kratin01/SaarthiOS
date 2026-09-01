/** Investment Agent — owns SIPs, mutual funds and every other contribution. */
import { investmentDraftSchema } from '../schemas.js';
import * as investmentService from '../../services/investmentService.js';
import { parseDraftDate } from './shared.js';

export const investmentAgent = {
  name: 'investment',
  label: 'Investment Agent',

  async run({ userId, drafts, agentRunId }) {
    const valid = [];
    const rejected = [];

    for (const draft of drafts) {
      const result = investmentDraftSchema.safeParse(draft);
      if (result.success && result.data.amount > 0) {
        valid.push({ ...result.data, date: parseDraftDate(result.data.date) });
      } else {
        rejected.push(draft);
      }
    }

    if (valid.length === 0) {
      return { created: [], rejected, summary: 'No valid investment found in the message.' };
    }

    const created = await investmentService.createInvestments(userId, valid, {
      source: 'chat',
      agentRun: agentRunId
    });

    const total = valid.reduce((sum, i) => sum + i.amount, 0);
    const noun = created.length === 1 ? 'contribution' : 'contributions';

    return {
      created,
      rejected,
      total,
      summary: `Recorded ${created.length} ${noun} totalling ${total}.`
    };
  }
};
