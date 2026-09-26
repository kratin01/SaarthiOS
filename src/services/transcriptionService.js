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
import { resolveTranscriber } from './aiSettingsService.js';
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

const PROMPT = `You are a transcription engine for a personal expense and food tracker.
Write down exactly what is said in the audio.

Rules:
- Output the words only. No preamble, no quotes, no translation, no commentary.
- The speaker mixes Hindi and English in one sentence. Keep every word in the language it was
  said in. Write Hindi in Latin script the way Indians type it, never in Devanagari and never
  translated into English.
- Spell common Hindi words the standard way: aaj, maine, khaye, liye, rupaye, mera, mere, hai,
  kal, abhi, aur, ka, ki, ke, wala, bhai, paise, kitna, kharcha, mahine, saal.
- Use lower case for Hindi words. Only real names keep a capital letter.
- Numbers stay as digits. "do sau" is 200, "dhai hazaar" is 2500, "teen" before a noun stays
  as the word "teen" only if that is how it was said.
- Spell brands the way they are written: Swiggy, Zomato, Netflix, Spotify, Uber, Rapido,
  Dominos, Blinkit, Zepto, Amazon Prime, Hotstar.
- Add normal punctuation, but never tidy up grammar, reorder words or reword anything.
- If the clip has no intelligible speech, output nothing at all.

For example, audio of someone saying they ate three parathas and pay for Netflix should come
out as: "aaj maine lunch mein teen parathe khaye aur ek katori daal makhni, aur mera Netflix
200 rupaye monthly hai"`;

/** Biases Whisper towards the same spelling conventions the prompt above sets. */
const WHISPER_HINT =
  'aaj maine, khaye, rupaye, mahine ka, kharcha, Swiggy, Zomato, Netflix, Rapido, Uber';

export async function transcribe(user, file) {
  if (!file?.buffer?.length) throw ApiError.badRequest('The recording was empty.');

  const config = await resolveTranscriber(user._id);
  const provider = buildProvider(config, env.LLM_TIMEOUT_MS);

  if (!provider) {
    throw ApiError.unavailable('Add an AI provider in Settings to use voice input.');
  }
  if (!provider.supportsAudio) {
    // Nothing this server can reach is able to listen — saying "switch
    // provider" would be useless advice for anyone but an admin.
    throw ApiError.unavailable(
      'Voice input is not available on this server right now. Your words were typed out by the browser instead where it could.'
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
          hint: WHISPER_HINT,
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
