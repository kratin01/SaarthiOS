/**
 * Analyst Agent — answers questions about data the user already has.
 *
 * It never guesses: the numbers are fetched from MongoDB first and handed to
 * the model as JSON. The model's only job is to phrase them.
 */
import { askText } from '../llm.js';
import { buildAnalystPrompt, buildConversationContext } from '../prompts.js';
import { collectFacts } from '../facts.js';
import { toDateKey } from '../../utils/dates.js';

export const analystAgent = {
  name: 'analyst',
  label: 'Analyst',

  async run({ user, question, message, config, history = [], customDefinitions = [] }) {
    const range = question.range ?? 'month';
    const domains = question.domains ?? ['expense'];

    const facts = await collectFacts({
      userId: user._id,
      domains,
      range,
      category: question.category,
      scope: question.scope,
      mealRunId: question.mealRunId,
      customDefinitions
    });

    if (facts.nutrition?.referenceMissing) {
      return {
        reply: 'I could not find the saved meal referenced in this conversation. Which meal would you like me to break down?',
        facts
      };
    }

    const reply = await askText({
      config,
      system: buildAnalystPrompt({ today: toDateKey(new Date()), currency: user.currency }),
      // The history matters: "and on travel?" only makes sense after the
      // question before it.
      user: `${buildConversationContext(history)}${message}\n\nResolved question:\n${JSON.stringify({
        text: question.text || message,
        domains,
        range: question.scope === 'last_meal' ? null : range,
        category: question.category ?? null,
        scope: question.scope ?? 'period'
      })}\n\nData:\n${JSON.stringify(facts, null, 2)}`,
      // A table of rows needs far more room than a two sentence summary, and a
      // reply cut off mid-table is worse than no table.
      maxTokens: 1500
    });

    return { reply, facts };
  }
};
