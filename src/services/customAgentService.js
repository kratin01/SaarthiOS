/**
 * Everything about user-built agents: their definitions and their entries.
 *
 * The rule that matters here is the same one the rest of the app follows — the
 * AI proposes, this file decides. A custom agent's `fields` array is the only
 * thing that says what may be stored, so `coerceValues` is the gate every
 * chat-written row passes through.
 */
import { CustomAgent } from '../models/CustomAgent.js';
import { CustomEntry } from '../models/CustomEntry.js';
import { RESERVED_AGENT_SLUGS } from '../config/constants.js';
import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';
import { toObjectId } from '../utils/ids.js';
import { resolveRange } from '../utils/dates.js';

/** "Gym Sessions" -> "gym-sessions" */
export function slugify(value) {
  return String(value)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

/** "Distance (km)" -> "distance" */
function fieldKey(label) {
  return (
    slugify(label).replace(/-/g, '_') || `field_${Math.random().toString(36).slice(2, 7)}`
  );
}

/** Field labels must be unique inside one agent or `values` would collide. */
function prepareFields(fields) {
  const seen = new Set();
  return fields.map((field) => {
    let key = fieldKey(field.label);
    while (seen.has(key)) key = `${key}_2`;
    seen.add(key);
    return {
      key,
      label: field.label.trim(),
      type: field.type ?? 'number',
      unit: (field.unit ?? '').trim()
    };
  });
}

export function capacity() {
  return env.MAX_CUSTOM_AGENTS;
}

export async function listAgents(userId, { activeOnly = false } = {}) {
  const filter = { user: userId };
  if (activeOnly) filter.active = true;
  return CustomAgent.find(filter).sort({ createdAt: 1 }).lean();
}

export async function getAgent(userId, id) {
  const agent = await CustomAgent.findOne({ _id: id, user: userId });
  if (!agent) throw ApiError.notFound('Agent not found');
  return agent;
}

export async function getAgentBySlug(userId, slug) {
  const agent = await CustomAgent.findOne({ user: userId, slug }).lean();
  if (!agent) throw ApiError.notFound('Agent not found');
  return agent;
}

export async function createAgent(userId, input) {
  const used = await CustomAgent.countDocuments({ user: userId });
  if (used >= env.MAX_CUSTOM_AGENTS) {
    throw ApiError.badRequest(
      `You can have ${env.MAX_CUSTOM_AGENTS} custom ${
        env.MAX_CUSTOM_AGENTS === 1 ? 'agent' : 'agents'
      }. Delete one to add another.`
    );
  }

  const slug = slugify(input.name);
  if (!slug) throw ApiError.badRequest('Give the agent a name using letters or numbers.');
  if (RESERVED_AGENT_SLUGS.includes(slug)) {
    throw ApiError.badRequest(`"${input.name}" is a built-in name. Pick a different one.`);
  }
  if (await CustomAgent.exists({ user: userId, slug })) {
    throw ApiError.conflict('You already have an agent with that name.');
  }

  return CustomAgent.create({
    user: userId,
    name: input.name.trim(),
    slug,
    description: input.description ?? '',
    prompt: input.prompt ?? '',
    fields: prepareFields(input.fields),
    icon: input.icon ?? 'spark',
    active: input.active ?? true
  });
}

export async function updateAgent(userId, id, input) {
  const agent = await getAgent(userId, id);

  if (input.name && slugify(input.name) !== agent.slug) {
    const slug = slugify(input.name);
    if (!slug) throw ApiError.badRequest('Give the agent a name using letters or numbers.');
    if (RESERVED_AGENT_SLUGS.includes(slug)) {
      throw ApiError.badRequest(`"${input.name}" is a built-in name. Pick a different one.`);
    }
    if (await CustomAgent.exists({ user: userId, slug, _id: { $ne: agent._id } })) {
      throw ApiError.conflict('You already have an agent with that name.');
    }
    agent.name = input.name.trim();
    agent.slug = slug;
  }

  if (input.description !== undefined) agent.description = input.description;
  if (input.prompt !== undefined) agent.prompt = input.prompt;
  if (input.icon !== undefined) agent.icon = input.icon;
  if (input.active !== undefined) agent.active = input.active;

  // Renaming a stat keeps its key, so existing rows keep their data. Removing a
  // stat leaves the old value on old rows; it simply stops being displayed.
  if (input.fields) {
    const byLabel = new Map(agent.fields.map((f) => [f.label.toLowerCase(), f.key]));
    agent.fields = prepareFields(input.fields).map((f) => ({
      ...f,
      key: byLabel.get(f.label.toLowerCase()) ?? f.key
    }));
  }

  await agent.save();
  return agent;
}

export async function deleteAgent(userId, id) {
  const agent = await getAgent(userId, id);
  await CustomEntry.deleteMany({ user: userId, agent: agent._id });
  await agent.deleteOne();
  return agent;
}

/**
 * Keeps only the fields this agent declared, and forces each one to its
 * declared type. Anything the model invented is dropped here.
 */
export function coerceValues(agent, raw = {}) {
  const values = {};

  for (const field of agent.fields) {
    const incoming = raw[field.key] ?? raw[field.label] ?? raw[field.label?.toLowerCase()];
    if (incoming === undefined || incoming === null || incoming === '') continue;

    if (field.type === 'number') {
      const n = Number(String(incoming).replace(/[^0-9.-]/g, ''));
      if (Number.isFinite(n)) values[field.key] = n;
    } else {
      values[field.key] = String(incoming).slice(0, 200);
    }
  }

  return values;
}

export function createEntry(userId, agent, input, { source = 'manual', agentRun = null } = {}) {
  return CustomEntry.create({
    user: userId,
    agent: agent._id,
    title: input.title,
    values: coerceValues(agent, input.values),
    note: input.note ?? '',
    date: input.date ?? new Date(),
    source,
    agentRun
  });
}

export function createEntries(userId, agent, inputs, options) {
  return Promise.all(inputs.map((input) => createEntry(userId, agent, input, options)));
}

export async function listEntries(userId, agentId, { range = 'month', limit = 50, offset = 0 } = {}) {
  const { from, to } = resolveRange(range);
  const filter = { user: userId, agent: agentId, date: { $gte: from, $lte: to } };

  const [items, total] = await Promise.all([
    CustomEntry.find(filter).sort({ date: -1, createdAt: -1, _id: -1 }).skip(offset).limit(limit).lean(),
    CustomEntry.countDocuments(filter)
  ]);

  return { items, total };
}

export async function deleteEntry(userId, id) {
  const deleted = await CustomEntry.findOneAndDelete({ _id: id, user: userId });
  if (!deleted) throw ApiError.notFound('Entry not found');
  return deleted;
}

export async function updateEntry(userId, id, input) {
  const entry = await CustomEntry.findOne({ _id: id, user: userId });
  if (!entry) throw ApiError.notFound('Entry not found');

  const agent = await CustomAgent.findOne({ _id: entry.agent, user: userId });
  if (!agent) throw ApiError.notFound('Agent not found');

  if (input.title !== undefined) entry.title = input.title;
  if (input.note !== undefined) entry.note = input.note;
  if (input.date !== undefined) entry.date = input.date;
  // Re-checked against the definition, exactly as a chat-written row would be.
  if (input.values !== undefined) entry.values = coerceValues(agent, input.values);

  await entry.save();
  return entry;
}

/**
 * Totals and averages for every numeric stat, plus a daily series so the page
 * can draw a chart without knowing what the agent tracks.
 */
export async function summariseEntries(userId, agent, range = 'month') {
  const { from, to, label } = resolveRange(range);
  const match = { user: toObjectId(userId), agent: toObjectId(agent._id), date: { $gte: from, $lte: to } };

  const numericFields = agent.fields.filter((f) => f.type === 'number');

  const sums = {};
  const byDaySums = {};
  for (const field of numericFields) {
    sums[`total_${field.key}`] = { $sum: { $ifNull: [`$values.${field.key}`, 0] } };
    byDaySums[field.key] = { $sum: { $ifNull: [`$values.${field.key}`, 0] } };
  }

  const [rows] = await CustomEntry.aggregate([
    { $match: match },
    {
      $facet: {
        totals: [{ $group: { _id: null, count: { $sum: 1 }, ...sums } }],
        byDay: [
          {
            $group: {
              _id: { $dateToString: { format: '%Y-%m-%d', date: '$date' } },
              count: { $sum: 1 },
              ...byDaySums
            }
          },
          { $sort: { _id: 1 } }
        ]
      }
    }
  ]);

  const head = rows.totals?.[0] ?? {};
  const count = head.count ?? 0;

  const totals = numericFields.map((field) => {
    const total = head[`total_${field.key}`] ?? 0;
    return {
      key: field.key,
      label: field.label,
      unit: field.unit,
      total: round(total),
      average: count ? round(total / count) : 0
    };
  });

  return {
    range: label,
    from,
    to,
    count,
    totals,
    byDay: (rows.byDay ?? []).map(({ _id, ...rest }) => ({ date: _id, ...rest }))
  };
}

const round = (n) => Math.round(n * 100) / 100;
