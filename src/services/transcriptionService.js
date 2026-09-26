/**
 * Turns a spoken clip into text.
 *
 * This is the fallback for browsers without the Web Speech API (Firefox, and
 * iOS once the app is on the home screen), and it is also the more accurate
 * path for code-switched speech — "2 chai liye 40 rupay ke" is one sentence in
 * two languages, which a single-language recogniser handles badly.
 *
 * It reuses whatever AI provider the user already configured. No second key,
 * no second vendor.
 */
import { ApiError } from '../utils/ApiError.js';
import { logger } from '../utils/logger.js';
import { recordFailure, recordSuccess } from '../utils/serviceHealth.js';
import { buildProvider } from '../ai/providers/index.js';
import { resolveForUser } from './aiSettingsService.js';
import { env } from '../config/env.js';

/** Long enough for a rambled sentence, short enough to stay well inside limits. */
export const MAX_AUDIO_BYTES = 8 * 1024 * 1024;

/** What MediaRecorder actually produces across the browsers that need this. */
export const ACCEPTED_AUDIO_TYPES = [
  'audio/webm',
  'audio/ogg',
  'audio/mp4',
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-m4a',
  'audio/m4a'
];

/** Browsers append codec parameters, e.g. `audio/webm;codecs=opus`. */
export const isAcceptedAudio = (mimetype) =>
  ACCEPTED_AUDIO_TYPES.includes(String(mimetype ?? '').split(';')[0].trim().toLowerCase());

const TIMEOUT_MS = 45_000;

const PROMPT = `You are a transcription engine. Write down exactly what is said in the audio.

Rules:
- Output the words only. No preamble, no quotes, no translation, no commentary.
- The speaker mixes English and Hindi in one sentence. Keep every word in the language it
  was said in, and write Hindi words in Latin script the way people type them: "do chai
  liye 40 rupay ke", not Devanagari and not an English translation.
- Keep numbers as digits.
- Write proper nouns and brand names the way they are spelt: Swiggy, Zomato, Netflix, Uber.
- Add normal punctuation, but do not tidy up grammar or reword anything.
- If the clip has no intelligible speech, output nothing at all.`;

export async function transcribe(user, file) {
  if (!file?.buffer?.length) throw ApiError.badRequest('The recording was empty.');

  const config = await resolveForUser(user._id);
  const provider = buildProvider(config, env.LLM_TIMEOUT_MS);

  if (!provider) {
    throw ApiError.unavailable('Add an AI provider in Settings to use voice input.');
  }
  if (!provider.supportsAudio) {
    throw ApiError.unavailable(
      `${provider.label} cannot transcribe audio. Type the message, or switch to Gemini or OpenAI in Settings.`
    );
  }

  const mimeType = String(file.mimetype).split(';')[0].trim().toLowerCase();
  const started = Date.now();

  try {
    const text = provider.transcribe
      ? await provider.transcribe({
          data: file.buffer,
          mimeType,
          filename: file.originalname || 'voice-note.webm',
          timeoutMs: TIMEOUT_MS
        })
      : await provider.complete({
          system: PROMPT,
          user: 'Transcribe this clip.',
          audio: [{ mimeType, data: file.buffer.toString('base64') }],
          temperature: 0,
          maxTokens: 400
        });

    logger.info(`transcribe · ${provider.label} · ${file.buffer.length}b · ${Date.now() - started}ms`);
    recordSuccess('ai');
    return clean(text);
  } catch (error) {
    recordFailure('ai', error.message);
    throw error;
  }
}

/**
 * Models sometimes wrap the answer in quotes or narrate that the clip was
 * silent, neither of which should end up in the user's message box.
 */
function clean(raw) {
  const text = String(raw ?? '')
    .trim()
    .replace(/^["'`]+|["'`]+$/g, '')
    .trim();

  if (!text) return '';
  if (/^\[?(silence|inaudible|no speech|no audible speech)\b/i.test(text)) return '';
  return text.slice(0, 2000);
}
