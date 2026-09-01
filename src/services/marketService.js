/**
 * Live stock prices.
 *
 * Yahoo Finance is used because it needs no API key and covers NSE, BSE and the
 * US markets, which is what this app's users hold. It is an unofficial endpoint
 * though, so every call here is allowed to fail: a price that cannot be fetched
 * shows as "unavailable" rather than breaking the page or, worse, showing a
 * stale number as if it were live.
 */
import { logger } from '../utils/logger.js';
import { recordFailure, recordSuccess } from '../utils/serviceHealth.js';

const QUOTE_URL = 'https://query1.finance.yahoo.com/v8/finance/chart';
const SEARCH_URL = 'https://query1.finance.yahoo.com/v1/finance/search';

/** Yahoo rejects requests without one. */
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (compatible; SaarthiOS/1.0)' };

const TIMEOUT_MS = 8000;
const QUOTE_TTL_MS = 60_000;
const SYMBOL_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * The only thing standing between user input and an outbound URL, so it is
 * deliberately strict: letters, digits and the few punctuation marks real
 * tickers use. No slashes, no protocol, nothing that could redirect the request.
 */
const SYMBOL_PATTERN = /^[A-Z0-9][A-Z0-9.\-&^=]{0,19}$/;

export const isValidSymbol = (symbol) => SYMBOL_PATTERN.test(String(symbol ?? '').toUpperCase());

const quoteCache = new Map();
const symbolCache = new Map();

function cached(store, key, ttl) {
  const hit = store.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.value;
  store.delete(key);
  return undefined;
}

async function getJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: HEADERS, signal: controller.signal });
    if (!res.ok) throw new Error(`quote provider returned ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Turns "Reliance" into "RELIANCE.NS" so the user never has to know that a
 * ticker needs an exchange suffix. Indian listings are preferred when the
 * user's currency is INR, because "Reliance" also matches a US company.
 */
export async function resolveSymbol(name, { preferCurrency = 'INR' } = {}) {
  const query = String(name ?? '').trim();
  if (query.length < 2) return null;

  const key = `${query.toLowerCase()}|${preferCurrency}`;
  const hit = cached(symbolCache, key, SYMBOL_TTL_MS);
  if (hit !== undefined) return hit;

  let resolved = null;
  try {
    const data = await getJson(`${SEARCH_URL}?q=${encodeURIComponent(query)}&quotesCount=8`);
    const equities = (data?.quotes ?? []).filter(
      (q) => q.symbol && (q.quoteType === 'EQUITY' || q.quoteType === 'ETF')
    );

    // NSI is Yahoo's code for the NSE; BSE is Bombay.
    const indian = equities.find((q) => ['NSI', 'BSE'].includes(q.exchange));
    const pick = preferCurrency === 'INR' && indian ? indian : equities[0];

    if (pick && isValidSymbol(pick.symbol)) resolved = pick.symbol.toUpperCase();
  } catch (error) {
    logger.warn(`symbol lookup failed for "${query}": ${error.message}`);
    return null; // Not cached: a network blip should not poison the result for a day.
  }

  symbolCache.set(key, { at: Date.now(), value: resolved });
  return resolved;
}

/** One live price, or null if it could not be fetched. */
export async function getQuote(symbol) {
  const ticker = String(symbol ?? '').toUpperCase();
  if (!isValidSymbol(ticker)) return null;

  const hit = cached(quoteCache, ticker, QUOTE_TTL_MS);
  if (hit !== undefined) return hit;

  try {
    const data = await getJson(
      `${QUOTE_URL}/${encodeURIComponent(ticker)}?interval=1d&range=1d`
    );
    const meta = data?.chart?.result?.[0]?.meta;
    if (!meta?.regularMarketPrice) return null;

    const quote = {
      symbol: meta.symbol ?? ticker,
      price: meta.regularMarketPrice,
      currency: meta.currency ?? '',
      exchange: meta.fullExchangeName ?? '',
      at: new Date().toISOString()
    };

    quoteCache.set(ticker, { at: Date.now(), value: quote });
    recordSuccess('prices');
    return quote;
  } catch (error) {
    logger.warn(`quote failed for ${ticker}: ${error.message}`);
    recordFailure('prices', error.message);
    return null;
  }
}

/** Fetched together so one slow ticker does not hold up the rest. */
export async function getQuotes(symbols) {
  const unique = [...new Set(symbols.filter(Boolean).map((s) => s.toUpperCase()))];
  const results = await Promise.all(unique.map((symbol) => getQuote(symbol)));

  const map = new Map();
  unique.forEach((symbol, i) => {
    if (results[i]) map.set(symbol, results[i]);
  });
  return map;
}
