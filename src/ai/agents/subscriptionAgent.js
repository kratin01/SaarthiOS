/** Subscription Agent — owns the recurring services nobody logs twice. */
import { subscriptionDraftSchema } from '../schemas.js';
import * as subscriptionService from '../../services/subscriptionService.js';
import { parseDraftDate } from './shared.js';

export const subscriptionAgent = {
  name: 'subscription',
  label: 'Subscription Agent',

  async run({ userId, drafts, agentRunId }) {
    const valid = [];
    const rejected = [];

    for (const draft of drafts) {
      const result = subscriptionDraftSchema.safeParse(draft);
      if (result.success && result.data.amount > 0 && result.data.name.trim()) {
        valid.push({ ...result.data, startedOn: parseDraftDate(result.data.startedOn) });
      } else {
        rejected.push(draft);
      }
    }

    if (valid.length === 0) {
      return { created: [], rejected, summary: 'No valid subscription found in the message.' };
    }

    const created = await subscriptionService.createSubscriptions(userId, valid, {
      source: 'chat',
      agentRun: agentRunId
    });

    // What it costs a month is the number worth repeating back, whatever the
    // cycle the user happened to say it in.
    const monthly = created.reduce(
      (sum, row) => sum + subscriptionService.monthlyCost(row),
      0
    );

    return {
      created,
      rejected,
      total: monthly,
      names: created.map((row) => row.name),
      summary: `Tracking ${created.length} subscription${created.length === 1 ? '' : 's'}.`
    };
  }
};
