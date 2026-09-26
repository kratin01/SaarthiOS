/**
 * Adapter for every service that speaks the OpenAI `/chat/completions` format.
 * That covers OpenAI, Groq, OpenRouter, Together, DeepSeek, Mistral, Ollama,
 * LM Studio, vLLM and most self-hosted gateways.
 */
import { getJson, postJson } from './http.js';
import { ApiError } from '../../utils/ApiError.js';

export function createOpenAIProvider({ apiKey, baseUrl, model, label, audio, timeoutMs }) {
  return {
    label,
    model,

    async complete({ system, user, images = [], json, temperature, maxTokens = 1600 }) {
      const content = images.length
        ? [
            { type: 'text', text: user },
            ...images.map((img) => ({
              type: 'image_url',
              image_url: { url: `data:${img.mimeType};base64,${img.data}` }
            }))
          ]
        : user;

      const body = {
        model,
        temperature,
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content }
        ]
      };

      // Not every OpenAI-compatible host supports this, so it stays opt-in and
      // the caller always has the markdown-fence fallback in json.js.
      if (json) body.response_format = { type: 'json_object' };

      const data = await postJson(`${trimSlash(baseUrl)}/chat/completions`, {
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
        body,
        timeoutMs,
        providerLabel: label
      });

      return data?.choices?.[0]?.message?.content ?? '';
    },

    /**
     * Audio goes to the dedicated transcription endpoint rather than the chat
     * one: `/chat/completions` only accepts audio on a couple of special
     * models. Whether this host has that endpoint at all comes from the
     * catalog — this adapter also serves OpenRouter and Ollama, which do not.
     */
    supportsAudio: Boolean(audio?.model),

    async transcribe({ data, mimeType, filename, language, timeoutMs: callTimeout }) {
      const form = new FormData();
      form.append('file', new Blob([data], { type: mimeType }), filename);
      form.append('model', audio.model);
      // A hint, not a restriction: it still transcribes other languages in the
      // same clip, which is the whole point for code-switched speech.
      if (language) form.append('language', language);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), callTimeout ?? timeoutMs);

      try {
        const response = await fetch(`${trimSlash(baseUrl)}/audio/transcriptions`, {
          method: 'POST',
          headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
          body: form,
          signal: controller.signal
        });
        const text = await response.text();
        if (!response.ok) {
          const error = ApiError.unavailable(`${label} could not transcribe that clip.`);
          error.providerStatus = response.status;
          throw error;
        }
        return JSON.parse(text)?.text ?? '';
      } catch (err) {
        if (err.expected) throw err;
        if (err.name === 'AbortError') {
          throw ApiError.unavailable(`${label} took too long to transcribe that clip.`);
        }
        throw ApiError.unavailable(`Could not reach ${label} to transcribe that clip.`);
      } finally {
        clearTimeout(timer);
      }
    },

    /** Lets Settings show the models this key can actually use. */
    async listModels() {
      const data = await getJson(`${trimSlash(baseUrl)}/models`, {
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
        timeoutMs,
        providerLabel: label
      });
      return (data?.data ?? []).map((m) => m.id).filter(Boolean);
    }
  };
}

const trimSlash = (url) => url.replace(/\/+$/, '');
