/**
 * The one place where domain "vocabulary" lives.
 * The AI prompts, the Mongoose models and the client all read from here,
 * so a category can only ever be added in a single file.
 */

export const EXPENSE_CATEGORIES = [
  'food',
  'groceries',
  'transport',
  'shopping',
  'bills',
  'entertainment',
  'health',
  'travel',
  'education',
  'other'
];

export const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack'];

/**
 * Windows every dashboard and agent understands. A single calendar month, written
 * as `2026-08`, is also accepted anywhere one of these is — see `utils/dates.js`.
 */
export const RANGES = ['today', 'week', 'month', 'last_month', 'year', 'all'];

/** Currencies the settings screen offers. `symbol` is what reports print. */
export const CURRENCIES = [
  { code: 'INR', symbol: '₹', label: 'Indian Rupee' },
  { code: 'USD', symbol: '$', label: 'US Dollar' },
  { code: 'EUR', symbol: '€', label: 'Euro' },
  { code: 'GBP', symbol: '£', label: 'British Pound' },
  { code: 'AED', symbol: 'د.إ', label: 'UAE Dirham' },
  { code: 'RUB', symbol: '₽', label: 'Russian Ruble' }
];

/** Falls back to the code itself so an unknown currency still reads sensibly. */
export const currencySymbol = (code) =>
  CURRENCIES.find((c) => c.code === code)?.symbol ?? String(code ?? '').trim();

/** Types where a unit count is meaningful, so the form asks for quantity. */
export const QUANTITY_TYPES = ['stocks'];

/** What the user is aiming for, which sets their calorie and protein targets. */
export const BODY_GOALS = ['lean', 'normal', 'bulky'];

export const INVESTMENT_TYPES = [
  'sip',
  'mutual_fund',
  'liquid_fund',
  'stocks',
  'gold',
  'fixed_deposit',
  'ppf',
  'crypto',
  'other'
];

/** `custom` covers every user-defined agent, whatever they named it. */
export const AGENTS = ['expense', 'health', 'investment', 'profile', 'custom'];

/** Where a record came from: a form, extracted from chat, or read off a file. */
export const SOURCES = ['manual', 'chat', 'import'];

/** Colour + label metadata the client uses for charts and badges. */
export const AGENT_META = {
  expense: { label: 'Expense Agent', color: '#C08457' },
  health: { label: 'Health Agent', color: '#6F9E7E' },
  investment: { label: 'Investment Agent', color: '#6B87A8' },
  profile: { label: 'Profile Agent', color: '#7C8CA8' },
  custom: { label: 'Custom Agent', color: '#8E7CC3' }
};

/** What a custom agent can track. Kept deliberately small — see the README. */
export const CUSTOM_FIELD_TYPES = ['number', 'text'];

/**
 * Icon names the client knows how to draw.
 *
 * Deliberately none of the sidebar icons: an agent using the wallet or leaf is
 * indistinguishable from Expenses or Health in the nav. The old sidebar names
 * stay accepted so agents created before this still validate when edited.
 */
export const CUSTOM_AGENT_ICONS = [
  'spark',
  'dumbbell',
  'book',
  'droplet',
  'heart',
  'target',
  'music',
  'brush',
  'paw',
  'moon'
];

const LEGACY_AGENT_ICONS = ['leaf', 'trend', 'wallet', 'home', 'chat'];

/** What the model accepts. The picker only offers `CUSTOM_AGENT_ICONS`. */
export const STORABLE_AGENT_ICONS = [...CUSTOM_AGENT_ICONS, ...LEGACY_AGENT_ICONS];

/**
 * Slugs a custom agent may not take: the built-in domains the planner already
 * uses, plus the client routes that would collide.
 */
export const RESERVED_AGENT_SLUGS = [
  'expense',
  'expenses',
  'health',
  'investment',
  'investments',
  'chat',
  'settings',
  'dashboard',
  'analyst',
  'orchestrator',
  'auth',
  'ai',
  'meals',
  'import'
];
