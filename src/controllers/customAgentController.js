/** CRUD for user-built agents and the rows they collect. */
import { z } from 'zod';
import { asyncHandler } from '../utils/asyncHandler.js';
import { customEntryInputSchema, customEntryUpdateSchema } from '../ai/schemas.js';
import { readPaging, pageInfo } from '../utils/paging.js';
import { CUSTOM_FIELD_TYPES, CUSTOM_AGENT_ICONS } from '../config/constants.js';
import * as customAgentService from '../services/customAgentService.js';

const fieldSchema = z.object({
  label: z.string().min(1).max(40),
  type: z.enum(CUSTOM_FIELD_TYPES).default('number'),
  unit: z.string().max(12).default('')
});

export const createSchema = z.object({
  name: z.string().min(2).max(40),
  description: z.string().max(160).default(''),
  prompt: z.string().max(1000).default(''),
  fields: z.array(fieldSchema).min(1).max(6),
  icon: z.enum(CUSTOM_AGENT_ICONS).default('spark'),
  active: z.boolean().default(true)
});

export const updateSchema = createSchema.partial();

export const entrySchema = customEntryInputSchema;
export const entryUpdateSchema = customEntryUpdateSchema;

export const list = asyncHandler(async (req, res) => {
  const agents = await customAgentService.listAgents(req.user._id);
  res.json({ agents, max: customAgentService.capacity() });
});

export const create = asyncHandler(async (req, res) => {
  const agent = await customAgentService.createAgent(req.user._id, req.body);
  res.status(201).json({ agent, max: customAgentService.capacity() });
});

export const update = asyncHandler(async (req, res) => {
  const agent = await customAgentService.updateAgent(req.user._id, req.params.id, req.body);
  res.json({ agent });
});

export const remove = asyncHandler(async (req, res) => {
  await customAgentService.deleteAgent(req.user._id, req.params.id);
  res.status(204).end();
});

/** The agent's own page: its definition, its rows and its totals. */
export const detail = asyncHandler(async (req, res) => {
  const { range = 'month' } = req.query;
  const { limit, offset } = readPaging(req.query);
  const agent = await customAgentService.getAgentBySlug(req.user._id, req.params.slug);

  const [result, summary] = await Promise.all([
    customAgentService.listEntries(req.user._id, agent._id, { range, limit, offset }),
    customAgentService.summariseEntries(req.user._id, agent, range)
  ]);

  res.json({
    agent,
    items: result.items,
    summary,
    page: pageInfo({ limit, offset, total: result.total, count: result.items.length })
  });
});

export const createEntry = asyncHandler(async (req, res) => {
  const agent = await customAgentService.getAgentBySlug(req.user._id, req.params.slug);
  const entry = await customAgentService.createEntry(req.user._id, agent, req.body);
  res.status(201).json({ entry });
});

export const removeEntry = asyncHandler(async (req, res) => {
  await customAgentService.deleteEntry(req.user._id, req.params.id);
  res.status(204).end();
});

export const updateEntry = asyncHandler(async (req, res) => {
  const entry = await customAgentService.updateEntry(req.user._id, req.params.id, req.body);
  res.json({ entry });
});
