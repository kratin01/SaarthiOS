/**
 * Adapter for every service that speaks the OpenAI `/chat/completions` format.
 * That covers OpenAI, Groq, OpenRouter, Together, DeepSeek, Mistral, Ollama,
 * LM Studio, vLLM and most self-hosted gateways.
 */
import { getJson, postJson } from './http.js';

export function createOpenAIProvider({ apiKey, baseUrl, model, label, timeoutMs }) {
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
