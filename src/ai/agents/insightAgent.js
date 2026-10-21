/**
 * The insight agent behind the Overview.
 *
 * It writes two things: a few observations about the user's own numbers, and
 * one line of inspiration in the style they picked. Like every agent it never
 * touches the database. It may ask for one web search; the server runs it
 * (within a daily budget) and asks again with the results.
 */
import { askJson } from '../llm.js';
import { inspirationSchema, overviewInsightsSchema } from '../schemas.js';
import { buildInspirationPrompt, buildOverviewInsightsPrompt } from '../prompts.js';
import { collectFacts } from '../facts.js';
import * as customAgentService from '../../services/customAgentService.js';
import { searchWeb, webSearchEnabled } from '../../services/webSearchService.js';
import { toDateKey } from '../../utils/dates.js';

/** Tavily can favour one country's results, which matters for rules and schemes. */
const searchCountry = (user) => (user.currency === 'INR' ? 'india' : undefined);

async function askWithSearch({ user, config, system, prompt, schema, temperature }) {
  const first = await askJson({ config, system, user: prompt, schema, temperature });
  const query = first.search?.query;
  if (!query) return { answer: first, results: [] };

  const results = await searchWeb(query, { userId: user._id, country: searchCountry(user) });
  if (!results.length) return { answer: first, results: [] };

  const numbered = results.map((result, index) => ({ number: index + 1, ...result }));
  const answer = await askJson({
    config,
    system,
    schema,
    temperature,
    user: `${prompt}\n\nWeb results for "${query}":\n${JSON.stringify(numbered, null, 2)}`
  });
  return { answer, results };
}

function linkFor(results, source) {
  const hit = source ? results[source - 1] : null;
  return hit ? { title: hit.title || new URL(hit.url).hostname, url: hit.url } : null;
}

export async function writeInsights({ user, period, dashboard, config }) {
  const range = period === 'month' ? 'month' : 'week';
  const agents = await customAgentService.listAgents(user._id, { activeOnly: true });

  const details = await collectFacts({
    userId: user._id,
    domains: ['expense', 'health', 'investment', 'subscription', ...agents.map((a) => a.slug)],
    range,
    customDefinitions: agents
  });

  const overview = {
    period: dashboard.periodLabel,
    comparedWith: dashboard.previousLabel,
    goals: {
      monthlyBudget: user.monthlyBudget,
      dailyCalorieGoal: user.dailyCalorieGoal,
      dailyProteinGoal: user.dailyProteinGoal
    },
    expenses: dashboard.expenses,
    health: dashboard.health,
    investedThisMonth: dashboard.investments,
    subscriptions: dashboard.subscriptions,
    customAgents: dashboard.agents.map(({ name, count, stat }) => ({ name, entries: count, stat }))
  };

  const { answer, results } = await askWithSearch({
    user,
    config,
    system: buildOverviewInsightsPrompt({
      today: toDateKey(new Date()),
      currency: user.currency,
      period,
      canSearch: webSearchEnabled()
    }),
    prompt: `Overview:\n${JSON.stringify(overview, null, 2)}\n\nDetails (${range}):\n${JSON.stringify(details, null, 2)}`,
    schema: overviewInsightsSchema
  });

  return answer.insights.map((insight) => ({
    tone: insight.tone,
    text: insight.text,
    link: linkFor(results, insight.source)
  }));
}

export async function writeInspiration({ user, kind, recent, config }) {
  const prompt = recent.length
    ? `Recently shown, do not repeat:\n${recent.map((line) => `- ${line}`).join('\n')}`
    : 'Recently shown: nothing yet.';

  const { answer, results } = await askWithSearch({
    user,
    config,
    system: buildInspirationPrompt({
      today: toDateKey(new Date()),
      kind,
      canSearch: webSearchEnabled()
    }),
    prompt,
    schema: inspirationSchema,
    // Higher than the default so a refresh reads like a new line, not a rewording.
    temperature: 0.9
  });

  const shown = kind !== 'mix' ? kind : answer.kind === 'mix' ? 'affirmation' : answer.kind;

  return {
    kind: shown,
    text: answer.text.replace(/^["\u201C]+|["\u201D]+$/g, '').trim(),
    author: answer.author,
    original: shown === 'gita' ? answer.original : '',
    meaning: answer.meaning,
    link: linkFor(results, answer.source)
  };
}
