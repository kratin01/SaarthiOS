/**
 * Web search for the Overview insight agent, through Tavily.
 *
 * Google's own search API is closed to new customers, and Gemini's built-in
 * Google Search only works with Gemini and may not be cached. Tavily works with
 * whichever AI provider the user has. A blank key turns search off and the
 * agent still writes insights from the user's own numbers.
 */
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { toDateKey } from '../utils/dates.js';

const ENDPOINT = 'https://api.tavily.com/search';
const TIMEOUT_MS = 10_000;
const MAX_RESULTS = 5;

/** Each search spends a paid credit, so one person cannot use up the month's quota. */
const SEARCHES_PER_USER_PER_DAY = 5;
const usage = new Map();

export const webSearchEnabled = () => Boolean(env.TAVILY_API_KEY);

function takeBudget(userId) {
  const day = toDateKey(new Date());
  const key = String(userId);
  const used = usage.get(key);
  const count = used?.day === day ? used.count : 0;
  if (count >= SEARCHES_PER_USER_PER_DAY) return false;
  usage.set(key, { day, count: count + 1 });
  return true;
}

/** `[{ title, url, content }]`, or `[]` when search is off, over budget or failing. */
export async function searchWeb(query, { userId, country } = {}) {
  if (!webSearchEnabled() || !takeBudget(userId)) return [];

  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.TAVILY_API_KEY}`
      },
      body: JSON.stringify({
        query: String(query).slice(0, 300),
        search_depth: 'basic',
        max_results: MAX_RESULTS,
        ...(country ? { country } : {})
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });

    if (!response.ok) {
      logger.warn(`web search failed · HTTP ${response.status}`);
      return [];
    }

    const data = await response.json();
    return (data?.results ?? [])
      .filter((result) => isWebUrl(result?.url))
      .slice(0, MAX_RESULTS)
      .map((result) => ({
        title: String(result.title ?? '').slice(0, 160),
        url: result.url,
        content: String(result.content ?? '').slice(0, 600)
      }));
  } catch (error) {
    logger.warn(`web search failed · ${error.message}`);
    return [];
  }
}

/** Links end up in an `href`, so only plain web addresses get through. */
function isWebUrl(value) {
  try {
    const { protocol } = new URL(value);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}
