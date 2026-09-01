/**
 * Pulls a JSON object out of whatever the model replied with.
 * Models sometimes wrap JSON in ```json fences or add a sentence before it,
 * so we clean up before parsing rather than failing the whole request.
 */
export function extractJson(text) {
  if (!text) return null;

  const cleaned = String(text)
    .replace(/^\uFEFF/, '')
    .replace(/```json/gi, '```')
    .replace(/```/g, '')
    .trim();

  const direct = tryParse(cleaned);
  if (direct) return direct;

  // Fall back to the first balanced `{ ... }` block in the text.
  const start = cleaned.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < cleaned.length; i += 1) {
    const char = cleaned[i];

    if (escaped) {
      escaped = false;
    } else if (char === '\\') {
      escaped = true;
    } else if (char === '"') {
      inString = !inString;
    } else if (!inString && char === '{') {
      depth += 1;
    } else if (!inString && char === '}') {
      depth -= 1;
      if (depth === 0) return tryParse(cleaned.slice(start, i + 1));
    }
  }

  return null;
}

function tryParse(value) {
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === 'object' && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}
