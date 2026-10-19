/** Linking outside apps such as Swiggy, from Settings or from the chat. */
import { z } from 'zod';
import { asyncHandler } from '../utils/asyncHandler.js';
import * as connections from '../services/connectionService.js';

export const startSchema = z.object({
  /** Where the browser lands once the app's sign-in is done. */
  returnTo: z.enum(['settings', 'chat']).default('settings')
});

export const completeSchema = z.object({
  state: z.string().min(16).max(200),
  code: z.string().min(1).max(4000)
});

export const list = asyncHandler(async (req, res) => {
  res.json({ apps: await connections.listConnections(req.user._id) });
});

/** Answers with the app's sign-in page; the browser goes there next. */
export const start = asyncHandler(async (req, res) => {
  res.json(
    await connections.startConnection(req.user._id, req.params.app, {
      origin: req.get('origin'),
      returnTo: req.body.returnTo
    })
  );
});

export const complete = asyncHandler(async (req, res) => {
  res.json(await connections.completeConnection(req.user._id, req.body));
});

export const disconnect = asyncHandler(async (req, res) => {
  await connections.disconnect(req.user._id, req.params.app);
  res.json({ apps: await connections.listConnections(req.user._id) });
});
