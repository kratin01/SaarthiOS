/**
 * The orchestrator — the brain that sits between the user and the agents.
 *
 * Flow for every chat message:
 *   1. Ask the model to turn the sentence into a validated JSON plan, giving it
 *      the last few turns of this conversation as context.
 *   2. Either ask one question back, or fan out to the agents in parallel.
 *   3. Build the reply — written by code for saves, by the analyst for questions.
 *   4. Save the whole trace as an AgentRun so the UI can show what happened.
 *
 * The model never touches MongoDB. It only produces the plan in step 1.
 */
import { AgentRun } from '../models/AgentRun.js';
import { Conversation } from '../models/Conversation.js';
import { askJson } from './llm.js';
import { planSchema } from './schemas.js';
import { buildPlannerPrompt, buildConversationContext } from './prompts.js';
import {
  expenseAgent,
  healthAgent,
  investmentAgent,
  profileAgent,
  analystAgent,
  buildCustomAgent
} from './agents/index.js';
import { resolveForUser } from '../services/aiSettingsService.js';
import * as customAgentService from '../services/customAgentService.js';
import { toDateKey } from '../utils/dates.js';
import { categoriesFor } from '../utils/categories.js';
import { logger } from '../utils/logger.js';

/** How much of the thread the agents get to see. */
const CONTEXT_TURNS = 5;

export async function handleMessage({ user, message, conversation }) {
  const startedAt = Date.now();

  // Whichever provider this user configured in Settings, or the .env default.
  const aiConfig = await resolveForUser(user._id);

  // Only active agents reach the prompt — pausing one should stop it competing
  // for the model's attention, not just hide it from the sidebar.
  const customDefinitions = await customAgentService.listAgents(user._id, { activeOnly: true });
  const customAgents = customDefinitions.map(buildCustomAgent);
  const customBySlug = new Map(customAgents.map((agent) => [agent.slug, agent]));

  const previous = await AgentRun.find({ conversation: conversation._id })
    .sort({ createdAt: -1 })
    .limit(CONTEXT_TURNS)
    .select('message reply')
    .lean();
  const history = previous.reverse();

  // Created up front so every record written below can point back at this run.
  const run = await AgentRun.create({
    user: user._id,
    conversation: conversation._id,
    message,
    steps: []
  });
  const steps = [];
  const step = (agent, label, detail = '', status = 'done') =>
    steps.push({ agent, label, detail, status, at: new Date() });

  try {
    step('orchestrator', 'Understanding your message');

    const plan = await askJson({
      config: aiConfig,
      system: buildPlannerPrompt({
        today: toDateKey(new Date()),
        currency: user.currency,
        customAgents: customDefinitions,
        categories: categoriesFor(user)
      }),
      user: buildConversationContext(history) + message,
      schema: planSchema
    });

    const context = { userId: user._id, agentRunId: run._id };
    const agentsUsed = [];
    const created = { expenses: 0, meals: 0, investments: 0, custom: 0 };
    let reply = '';

    if (plan.intent === 'clarify' && plan.clarify) {
      // Nothing is saved — we hand the question straight back to the user.
      reply = plan.clarify;
      step('orchestrator', 'Needs one detail', plan.clarify);
    } else if (plan.intent === 'query' && plan.question) {
      const domains = resolveDomains(plan.question.domains, customBySlug);
      step('orchestrator', `Reading your ${labelDomains(domains, customBySlug)} data`);
      const result = await analystAgent.run({
        user,
        question: { ...plan.question, domains },
        message,
        config: aiConfig,
        history,
        customDefinitions
      });
      reply = result.reply;
      step('analyst', 'Answer prepared');
    } else {
      const jobs = [];

      if (plan.expenses.length) {
        agentsUsed.push('expense');
        jobs.push(
          expenseAgent
            .run({ ...context, drafts: plan.expenses })
            .then((r) => ({ agent: expenseAgent, result: r }))
        );
      }
      if (plan.meals.length) {
        agentsUsed.push('health');
        jobs.push(
          healthAgent
            .run({ ...context, drafts: plan.meals })
            .then((r) => ({ agent: healthAgent, result: r }))
        );
      }
      if (plan.investments.length) {
        agentsUsed.push('investment');
        jobs.push(
          investmentAgent
            .run({ ...context, drafts: plan.investments })
            .then((r) => ({ agent: investmentAgent, result: r }))
        );
      }

      if (Object.values(plan.profile ?? {}).some((v) => v !== undefined)) {
        agentsUsed.push('profile');
        jobs.push(
          profileAgent
            .run({ ...context, draft: plan.profile })
            .then((r) => ({ agent: profileAgent, result: r }))
        );
      }

      // Drafts naming an agent the user does not have (or has paused) are
      // dropped rather than guessed at.
      for (const [slug, drafts] of groupBySlug(plan.custom)) {
        const agent = customBySlug.get(slug);
        if (!agent) continue;
        agentsUsed.push('custom');
        jobs.push(agent.run({ ...context, drafts }).then((r) => ({ agent, result: r })));
      }

      const outcomes = await Promise.all(jobs);

      for (const { agent, result } of outcomes) {
        // The profile agent changes settings rather than creating rows, so it
        // reports on `changed` instead.
        const did = agent.name === 'profile' ? result.changed.length : result.created.length;
        step(agent.name, agent.label, result.summary, did ? 'done' : 'skipped');
        if (agent.name === 'expense') created.expenses = result.created.length;
        if (agent.name === 'health') created.meals = result.created.length;
        if (agent.name === 'investment') created.investments = result.created.length;
        if (agent.name === 'custom') created.custom += result.created.length;
      }

      reply = outcomes.length
        ? composeSaveReply(outcomes, user.currency)
        : plan.message || "I didn't find anything to record. Try telling me what you spent or ate.";
    }

    step('orchestrator', 'Completed');

    run.set({
      reply,
      intent: plan.intent,
      agentsUsed: [...new Set(agentsUsed)],
      steps,
      created,
      status: 'completed',
      durationMs: Date.now() - startedAt
    });
    await run.save();

    await touchConversation(conversation, message);

    return run.toObject();
  } catch (error) {
    logger.error('orchestrator failed', error.message);
    step('orchestrator', 'Failed', error.message, 'failed');

    run.set({
      steps,
      status: 'failed',
      error: error.message,
      reply: error.expected
        ? error.message
        : 'Something went wrong while processing that. Please try again.',
      durationMs: Date.now() - startedAt
    });
    await run.save();

    await touchConversation(conversation, message);

    throw error;
  }
}

/** Keeps the thread list ordered, and names a thread after its first message. */
async function touchConversation(conversation, message) {
  const update = { lastMessageAt: new Date(), $inc: { messageCount: 1 } };
  if (conversation.messageCount === 0) {
    update.title = Conversation.titleFrom(message);
  }
  const { $inc, ...set } = update;
  await Conversation.updateOne({ _id: conversation._id }, { $set: set, $inc });
}

/**
 * Written in code rather than by the model: saving data should always produce
 * the same confirmation, cost nothing extra and never hallucinate a number.
 */
function composeSaveReply(outcomes, currency) {
  const parts = [];

  for (const { agent, result } of outcomes) {
    if (agent.name === 'profile') {
      if (result.changed.length) parts.push(result.summary);
      continue;
    }
    if (!result.created.length) continue;

    if (agent.name === 'expense') {
      parts.push(`${result.created.length === 1 ? 'Expense' : 'Expenses'} of ${money(result.total, currency)} recorded.`);
    }
    if (agent.name === 'health') {
      // Say the portion out loud — an estimate is only honest if you can see
      // what it assumed, and correct it.
      const items = result.created.flatMap((m) =>
        m.items.map((i) => (i.quantity ? `${i.name} (${i.quantity})` : i.name))
      );
      const t = result.totals;
      parts.push(
        `Meal logged — ${items.slice(0, 4).join(', ')}. Roughly ${t.calories} kcal, ${t.protein} g protein. These are estimates for that portion.`
      );
    }
    if (agent.name === 'investment') {
      parts.push(`Investment of ${money(result.total, currency)} recorded.`);
    }
    if (agent.name === 'custom') {
      // Read the numbers back so a wrong one is obvious immediately, the same
      // reason the health agent repeats the portion it assumed.
      const summarised = result.created.slice(0, 3).map((entry) => {
        const stats = agent.definition.fields
          .map((field) => {
            const value = entry.values?.get?.(field.key) ?? entry.values?.[field.key];
            if (value === undefined || value === null || value === '') return null;
            return `${value}${field.unit ? ` ${field.unit}` : ''} ${field.label.toLowerCase()}`;
          })
          .filter(Boolean);

        return stats.length ? `${entry.title} — ${stats.join(', ')}` : entry.title;
      });

      parts.push(`${agent.definition.name}: ${summarised.join('; ')}.`);
    }
  }

  if (!parts.length) return 'I understood the message but nothing was valid enough to save.';
  return parts.join(' ');
}

const money = (amount, currency) =>
  `${currency} ${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(amount)}`;

/** One agent can be given several rows from a single message. */
function groupBySlug(drafts) {
  const grouped = new Map();
  for (const draft of drafts) {
    if (!draft?.agent) continue;
    const list = grouped.get(draft.agent) ?? [];
    list.push(draft);
    grouped.set(draft.agent, list);
  }
  return grouped;
}

/**
 * The planner is free-text about domains, so a slug the user does not own gets
 * dropped here rather than reaching the analyst.
 */
function resolveDomains(domains, customBySlug) {
  const allowed = domains.filter(
    (d) => ['expense', 'health', 'investment'].includes(d) || customBySlug.has(d)
  );
  return allowed.length ? allowed : ['expense'];
}

function labelDomains(domains, customBySlug) {
  return domains
    .map((d) => customBySlug.get(d)?.definition.name.toLowerCase() ?? d)
    .join(' and ');
}
