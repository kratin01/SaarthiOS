/**
 * Custom Agent — the runtime half of a user-built agent.
 *
 * There is one of these for every custom agent the user made. It behaves like
 * the built-in agents: re-validate the AI's drafts, drop anything that does not
 * match the definition, save, and report back.
 */
import { customDraftSchema } from '../schemas.js';
import * as customAgentService from '../../services/customAgentService.js';
import { parseDraftDate } from './shared.js';

/** Built per definition so the orchestrator can treat it like any other agent. */
export function buildCustomAgent(definition) {
  return {
    name: 'custom',
    slug: definition.slug,
    label: `${definition.name} Agent`,
    definition,

    async run({ userId, drafts, agentRunId }) {
      const valid = [];
      const rejected = [];

      for (const draft of drafts) {
        const result = customDraftSchema.safeParse(draft);
        if (!result.success) {
          rejected.push(draft);
          continue;
        }

        const values = customAgentService.coerceValues(definition, result.data.values);

        // A row with a title but no recognised stats is still worth keeping —
        // "went for a run" is a real entry even if no distance was given.
        valid.push({
          title: result.data.title,
          values,
          note: result.data.note,
          date: parseDraftDate(result.data.date)
        });
      }

      if (valid.length === 0) {
        return {
          created: [],
          rejected,
          summary: `Nothing valid for ${definition.name} in the message.`
        };
      }

      const created = await customAgentService.createEntries(userId, definition, valid, {
        source: 'chat',
        agentRun: agentRunId
      });

      return {
        created,
        rejected,
        summary: `Recorded ${created.length} ${definition.name} ${
          created.length === 1 ? 'entry' : 'entries'
        }.`
      };
    }
  };
}
