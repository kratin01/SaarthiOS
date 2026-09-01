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
      customDefinitions
    });

    const reply = await askText({
      config,
      system: buildAnalystPrompt({ today: toDateKey(new Date()), currency: user.currency }),
      // The history matters: "and on travel?" only makes sense after the
      // question before it.
      user: `${buildConversationContext(history)}Question: ${message}\n\nData:\n${JSON.stringify(facts, null, 2)}`,
      maxTokens: 500
    });

    return { reply, facts };
  }
};
