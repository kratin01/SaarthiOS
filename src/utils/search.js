/**
 * Case-insensitive "contains any of these words" filter over a few text fields.
 * Spaces, dots, hyphens and underscores are ignored inside a word, so "haircut"
 * also finds "Hair cutting" and "hair-cut", and "hair cut" finds "Haircut".
 */
export function keywordFilter(fields, keywords = []) {
  const patterns = (keywords ?? [])
    .map(loosePattern)
    .filter(Boolean)
    .map((pattern) => new RegExp(pattern, 'i'));
  if (!patterns.length) return {};
  return { $or: fields.flatMap((field) => patterns.map((pattern) => ({ [field]: pattern }))) };
}

const SEPARATORS = '[\\s._-]*';

// Words come from the model, so every character is escaped before it is joined.
const loosePattern = (word) =>
  [...String(word).replace(/[\s._-]+/g, '')].map(escapeRegExp).join(SEPARATORS);

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
