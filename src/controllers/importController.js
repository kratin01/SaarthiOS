/** Importing records from an uploaded bill, receipt or bank statement. */
import { asyncHandler } from '../utils/asyncHandler.js';
import { importConfirmSchema } from '../ai/schemas.js';
import { extractFromFile, saveApproved } from '../services/importService.js';

export const confirmSchema = importConfirmSchema;

/** Reads the file and returns what it found. Saves nothing. */
export const extract = asyncHandler(async (req, res) => {
  res.json(await extractFromFile(req.user, req.file));
});

/** Saves the rows the user ticked in the review step. */
export const confirm = asyncHandler(async (req, res) => {
  const created = await saveApproved(req.user._id, req.body);
  res.status(201).json({ created });
});
