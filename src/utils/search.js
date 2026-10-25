/** Case-insensitive "contains any of these words" filter over a few text fields. */
export function keywordFilter(fields, keywords = []) {
  if (!keywords?.length) return {};
  const patterns = keywords.map((word) => new RegExp(escapeRegExp(word), 'i'));
  return { $or: fields.flatMap((field) => patterns.map((pattern) => ({ [field]: pattern }))) };
}

// Words come from the model, so they must never be read as regex syntax.
const escapeRegExp = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
