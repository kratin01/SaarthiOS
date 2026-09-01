/**
 * Shared paging rules.
 *
 * Every list in the app used to stop at a fixed cap and say nothing, so a user
 * with 150 expenses simply never saw 50 of them. Returning a total alongside
 * the rows is what lets the UI say "showing 50 of 143" instead of quietly
 * lying.
 */
export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 100;

/** Query strings arrive as text and can hold anything. */
export function readPaging(query = {}, { defaultLimit = DEFAULT_LIMIT } = {}) {
  const limit = Number.parseInt(query.limit, 10);
  const offset = Number.parseInt(query.offset, 10);

  // Nonsense like `limit=-5` falls back to the default rather than being
  // clamped to 1, which would silently return a single row.
  const usableLimit = Number.isFinite(limit) && limit > 0 ? Math.min(limit, MAX_LIMIT) : defaultLimit;

  return {
    limit: usableLimit,
    offset: Number.isFinite(offset) && offset > 0 ? offset : 0
  };
}

/** The shape every paginated endpoint returns under `page`. */
export function pageInfo({ limit, offset, total, count }) {
  return { limit, offset, total, hasMore: offset + count < total };
}
