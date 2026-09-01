/** Helpers shared by all agents. */

/**
 * The AI returns dates as `YYYY-MM-DD` strings, or nothing at all.
 * Anything unusable becomes "now" rather than failing the whole message.
 */
export function parseDraftDate(value) {
  if (!value) return new Date();
  const parsed = new Date(`${value}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return new Date();

  // Guard against a model hallucinating a date years in the future.
  const oneDayAhead = new Date(Date.now() + 86_400_000);
  return parsed > oneDayAhead ? new Date() : parsed;
}
