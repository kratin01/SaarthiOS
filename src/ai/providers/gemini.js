/** Adapter for Google's Gemini `generateContent` API. */
import { getJson, postJson } from './http.js';

export function createGeminiProvider({ apiKey, baseUrl, model, label, audio, timeoutMs }) {
  return {
    label,
    model,
    /** Gemini takes audio on the same endpoint as text, so no extra call path. */
    supportsAudio: Boolean(audio),

    async complete({ system, user, images = [], audio = [], json, temperature, maxTokens = 1600 }) {
      const parts = [
        { text: user },
        ...images.map((img) => ({
          inline_data: { mime_type: img.mimeType, data: img.data }
        })),
        // Audio rides the same inline part as an image; only the mime differs.
        ...audio.map((clip) => ({
          inline_data: { mime_type: clip.mimeType, data: clip.data }
        }))
      ];

      const body = {
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts }],
        generationConfig: {
          temperature,
          maxOutputTokens: maxTokens,
          ...(json ? { responseMimeType: 'application/json' } : {})
        }
      };

      const url = `${trimSlash(baseUrl)}/models/${encodeURIComponent(model)}:generateContent`;

      const data = await postJson(url, {
        headers: { 'x-goog-api-key': apiKey },
        body,
        timeoutMs,
        providerLabel: label
      });

      return (data?.candidates?.[0]?.content?.parts ?? [])
        .map((part) => part.text ?? '')
        .join('');
    },

    async listModels() {
      const data = await getJson(`${trimSlash(baseUrl)}/models?pageSize=200`, {
        headers: { 'x-goog-api-key': apiKey },
        timeoutMs,
        providerLabel: label
      });
      return (data?.models ?? [])
        .filter((m) => (m.supportedGenerationMethods ?? []).includes('generateContent'))
        .map((m) => String(m.name).replace(/^models\//, ''))
        .filter(Boolean);
    }
  };
}

const trimSlash = (url) => url.replace(/\/+$/, '');
