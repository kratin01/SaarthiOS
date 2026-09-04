/**
 * Expense categories.
 *
 * The built-in list covers most spending, but people track things it does not
 * name: a person they lend to, a side project, a specific bill. Rather than
 * forcing everything into "other", a user can invent a category and it becomes
 * theirs from then on, offered in the form and known to the assistant.
 */
import { EXPENSE_CATEGORIES } from '../config/constants.js';

/** Enough room to be useful, few enough that the picker stays readable. */
export const MAX_CUSTOM_CATEGORIES = 20;
export const MAX_CATEGORY_LENGTH = 24;

/**
 * Categories are compared and stored in one canonical form, so "Rahul",
 * "rahul " and "RAHUL" cannot become three separate categories.
 */
export function normaliseCategory(raw) {
  return String(raw ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9 &-]/g, ' ')
    .replace(/[\s-]+/g, ' ')
    .trim()
    .slice(0, MAX_CATEGORY_LENGTH)
    .trim();
}

export const isBuiltInCategory = (category) => EXPENSE_CATEGORIES.includes(category);

/** Everything this user may file an expense under, built-ins first. */
export function categoriesFor(user) {
  return [...EXPENSE_CATEGORIES, ...(user?.customCategories ?? [])];
}
