import { normaliseCategory } from '../utils/categories.js';

export function resolveQuestion(question, history, message, categories = []) {
  const previous = history.findLast((run) =>
    run.queryContext || run.intent === 'query' || run.intent === 'record'
      || Object.values(run.created ?? {}).some((count) => count > 0)
  );
  const inherited = question.continuation ? previous?.queryContext : null;
  const domains = question.domains?.length
    ? question.domains
    : inherited?.domains?.length
      ? inherited.domains
      : question.scope === 'last_meal' || (question.continuation && previous?.created?.meals)
        ? ['health']
        : ['expense'];
  const sameDomain = inherited?.domains?.some((domain) => domains.includes(domain));
  const scope = question.scope ?? (question.range ? 'period' : null)
    ?? (sameDomain ? inherited.scope : null)
    ?? (question.continuation && domains.includes('health') && previous?.created?.meals
      ? 'last_meal' : 'period');
  let category = question.category || (sameDomain ? inherited.category : null);
  if (question.clearCategory || !domains.includes('expense')) category = null;
  if (category) {
    category = normaliseCategory(category);
    if (category === 'others' && !categories.includes('others')) category = 'other';
  }

  let mealRunId = null;
  if (scope === 'last_meal') {
    const reference = question.referenceTurn != null
      ? history[question.referenceTurn - 1]
      : sameDomain && inherited.scope === 'last_meal'
        ? previous
        : history.findLast((run) => run.created?.meals > 0);
    if (reference?.created?.meals > 0) mealRunId = String(reference._id);
    else if (reference?.queryContext?.scope === 'last_meal') {
      mealRunId = reference.queryContext.mealRunId ? String(reference.queryContext.mealRunId) : null;
    }
  }

  return {
    domains: scope === 'last_meal' ? ['health'] : domains,
    range: question.range ?? (sameDomain ? inherited.range : null) ?? 'month',
    category: scope === 'last_meal' ? null : category || null,
    scope,
    mealRunId,
    text: question.text || message
  };
}