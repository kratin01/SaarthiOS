/**
 * Date helpers used by the dashboards.
 * Everything works on the server's local timezone, which keeps "today" honest
 * for a single-user personal app.
 */

export const startOfDay = (d = new Date()) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

export const endOfDay = (d = new Date()) => {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
};

export const startOfMonth = (d = new Date()) => new Date(d.getFullYear(), d.getMonth(), 1);

export const endOfMonth = (d = new Date()) =>
  new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);

export const addDays = (d, days) => {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
};

export const addMonths = (d, months) => {
  const x = new Date(d);
  x.setMonth(x.getMonth() + months);
  return x;
};

/** `2026-08-31` — used as a chart x-axis key and as a grouping key. */
export const toDateKey = (d) => {
  const x = new Date(d);
  const m = String(x.getMonth() + 1).padStart(2, '0');
  const day = String(x.getDate()).padStart(2, '0');
  return `${x.getFullYear()}-${m}-${day}`;
};

/** `2026-08` */
export const toMonthKey = (d) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`;
};

/**
 * Turns a friendly range name into a `{ from, to, label }` window.
 * Used by both the REST endpoints (?range=month) and the AI question flow.
 */
export function resolveRange(range = 'month', now = new Date()) {
  switch (range) {
    case 'today':
      return { from: startOfDay(now), to: endOfDay(now), label: 'today' };
    case 'week':
      return { from: startOfDay(addDays(now, -6)), to: endOfDay(now), label: 'the last 7 days' };
    case 'last_month': {
      const prev = addMonths(now, -1);
      return { from: startOfMonth(prev), to: endOfMonth(prev), label: 'last month' };
    }
    case 'year':
      return {
        from: new Date(now.getFullYear(), 0, 1),
        to: endOfDay(now),
        label: 'this year'
      };
    case 'all':
      return { from: new Date(0), to: endOfDay(now), label: 'all time' };
    case 'month':
    default:
      return { from: startOfMonth(now), to: endOfDay(now), label: 'this month' };
  }
}

/** Builds an ordered list of empty day buckets so charts never have gaps. */
export function dayBuckets(from, to) {
  const buckets = [];
  for (let d = startOfDay(from); d <= to; d = addDays(d, 1)) {
    buckets.push(toDateKey(d));
  }
  return buckets;
}
