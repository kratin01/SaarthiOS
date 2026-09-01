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
export const AGENTS = ['expense', 'health', 'investment', 'custom'];

/** Where a record came from: a form, extracted from chat, or read off a file. */
export const SOURCES = ['manual', 'chat', 'import'];

/** Colour + label metadata the client uses for charts and badges. */
export const AGENT_META = {
  expense: { label: 'Expense Agent', color: '#C08457' },
  health: { label: 'Health Agent', color: '#6F9E7E' },
  investment: { label: 'Investment Agent', color: '#6B87A8' },
  custom: { label: 'Custom Agent', color: '#8E7CC3' }
};

/** What a custom agent can track. Kept deliberately small — see the README. */
export const CUSTOM_FIELD_TYPES = ['number', 'text'];

/** Icon names the client knows how to draw. */
export const CUSTOM_AGENT_ICONS = ['spark', 'leaf', 'trend', 'wallet', 'home', 'chat'];

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
