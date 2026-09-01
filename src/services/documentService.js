/**
 * Turns an uploaded file into something a model can read.
 *
 * Images go to the model as images (any vision-capable provider).
 * PDFs and CSVs are converted to text first, which means they also work with
 * text-only models.
 *
 * Nothing is ever written to disk — files live in memory for the length of one
 * request, which removes a whole class of path and cleanup problems.
 */
import { extractText, getDocumentProxy } from 'unpdf';
import { ApiError } from '../utils/ApiError.js';

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const TEXT_TYPES = ['text/csv', 'text/plain', 'application/vnd.ms-excel'];
const PDF_TYPE = 'application/pdf';

export const ACCEPTED_TYPES = [...IMAGE_TYPES, ...TEXT_TYPES, PDF_TYPE];

/** Long statements would blow up the context window and the bill with it. */
const MAX_TEXT_CHARS = 20_000;

export function isAccepted(mimetype) {
  return ACCEPTED_TYPES.includes(mimetype);
}

/**
 * @returns {{ kind: 'image'|'text', text?: string, images?: {mimeType: string, data: string}[] }}
 */
export async function readDocument(file) {
  if (!file?.buffer?.length) throw ApiError.badRequest('The file was empty.');

  if (IMAGE_TYPES.includes(file.mimetype)) {
    return {
      kind: 'image',
      images: [{ mimeType: file.mimetype, data: file.buffer.toString('base64') }]
    };
  }

  if (file.mimetype === PDF_TYPE) {
    const text = await readPdf(file.buffer);
    return { kind: 'text', text };
  }

  if (TEXT_TYPES.includes(file.mimetype)) {
    const text = file.buffer.toString('utf8').trim();
    if (!text) throw ApiError.badRequest('That file has no readable text.');
    return { kind: 'text', text: text.slice(0, MAX_TEXT_CHARS) };
  }

  throw ApiError.badRequest('Upload a PDF, CSV or an image of the bill.');
}

async function readPdf(buffer) {
  let text;
  try {
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    ({ text } = await extractText(pdf, { mergePages: true }));
  } catch {
    throw ApiError.badRequest('That PDF could not be read. Try exporting it again, or upload a CSV.');
  }

  const clean = String(text ?? '').replace(/\n{3,}/g, '\n\n').trim();

  // A scanned statement is images wrapped in a PDF, so there is nothing to read.
  if (clean.length < 20) {
    throw ApiError.badRequest(
      'That PDF looks scanned rather than digital. Upload a screenshot of it instead, or a CSV export.'
    );
  }

  return clean.slice(0, MAX_TEXT_CHARS);
}
