/** Adapter for Anthropic's `/messages` API. */
import { getJson, postJson } from './http.js';

export function createAnthropicProvider({ apiKey, baseUrl, model, label, timeoutMs }) {
  return {
    label,
    model,

    async complete({ system, user, images = [], json, temperature, maxTokens = 1600 }) {
      const content = images.length
        ? [
            ...images.map((img) => ({
              type: 'image',
              source: { type: 'base64', media_type: img.mimeType, data: img.data }
            })),
            { type: 'text', text: user }
          ]
        : user;

      // Claude has no JSON mode, so we prefill the reply with `{` — it then has
      // no choice but to continue with a JSON object.
      const messages = [{ role: 'user', content }];
      if (json) messages.push({ role: 'assistant', content: '{' });

      const data = await postJson(`${trimSlash(baseUrl)}/messages`, {
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: { model, system, messages, temperature, max_tokens: maxTokens },
        timeoutMs,
        providerLabel: label
      });

      const text = (data?.content ?? []).map((block) => block.text ?? '').join('');
      return json ? `{${text}` : text;
    },

    async listModels() {
      const data = await getJson(`${trimSlash(baseUrl)}/models?limit=100`, {
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        timeoutMs,
        providerLabel: label
      });
      return (data?.data ?? []).map((m) => m.id).filter(Boolean);
    }
  };
}

const trimSlash = (url) => url.replace(/\/+$/, '');
