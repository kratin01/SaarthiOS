/**
 * The provider catalog.
 *
 * Each entry says:
 *   kind        which adapter file knows how to talk to it
 *   baseUrl     the default API endpoint
 *   model       the default model, used when none is chosen
 *   fallbacks   models to try when the chosen one is overloaded or retired
 *   suggested   a short starting list for the Settings dropdown
 *
 * `suggested` is only a starting point. Settings can also pull the live list
 * from the provider using the user's own key, which is what stops this file
 * going stale as models come and go.
 *
 * Adding a hosted provider that speaks the OpenAI format is one entry here.
 */
export const PROVIDER_CATALOG = {
  openai: {
    kind: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    fallbacks: ['gpt-4.1-mini', 'gpt-4o'],
    keyHelp: 'platform.openai.com → API keys',
    suggested: [
      { id: 'gpt-4o-mini', note: 'Fast and cheap — recommended' },
      { id: 'gpt-4o', note: 'More capable' },
      { id: 'gpt-4.1-mini', note: 'Fast' },
      { id: 'gpt-4.1', note: 'Most capable' }
    ]
  },
  gemini: {
    kind: 'gemini',
    label: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    // Pinned on purpose. `gemini-flash-lite-latest` is the cheapest tier and is
    // regularly 503 "experiencing high demand" or 30s+ when it does answer,
    // which reads to a user as the app being broken. 2.5-flash replies in
    // about a second and is not thinking-by-default like `flash-latest`.
    model: 'gemini-2.5-flash',
    fallbacks: ['gemini-flash-latest', 'gemini-pro-latest'],
    keyHelp: 'aistudio.google.com → Get API key',
    suggested: [
      { id: 'gemini-2.5-flash', note: 'Fast and steady — recommended' },
      { id: 'gemini-flash-latest', note: 'Newest flash, slower and busier' },
      { id: 'gemini-flash-lite-latest', note: 'Cheapest, but often overloaded' },
      { id: 'gemini-pro-latest', note: 'Most capable, slowest' }
    ]
  },
  anthropic: {
    kind: 'anthropic',
    label: 'Anthropic Claude',
    baseUrl: 'https://api.anthropic.com/v1',
    model: 'claude-3-5-haiku-latest',
    keyHelp: 'console.anthropic.com → API keys',
    suggested: [
      { id: 'claude-3-5-haiku-latest', note: 'Fast — recommended' },
      { id: 'claude-sonnet-4-5', note: 'More capable' }
    ]
  },
  groq: {
    kind: 'openai',
    label: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    model: 'llama-3.3-70b-versatile',
    keyHelp: 'console.groq.com → API keys',
    suggested: [{ id: 'llama-3.3-70b-versatile', note: 'Very fast' }]
  },
  openrouter: {
    kind: 'openai',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'meta-llama/llama-3.3-70b-instruct',
    keyHelp: 'openrouter.ai → Keys',
    suggested: [{ id: 'meta-llama/llama-3.3-70b-instruct', note: 'Open weights' }]
  },
  together: {
    kind: 'openai',
    label: 'Together AI',
    baseUrl: 'https://api.together.xyz/v1',
    model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    keyHelp: 'api.together.xyz → API keys',
    suggested: [{ id: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', note: 'Open weights' }]
  },
  deepseek: {
    kind: 'openai',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    keyHelp: 'platform.deepseek.com → API keys',
    suggested: [{ id: 'deepseek-chat', note: 'General purpose' }]
  },
  mistral: {
    kind: 'openai',
    label: 'Mistral',
    baseUrl: 'https://api.mistral.ai/v1',
    model: 'mistral-large-latest',
    keyHelp: 'console.mistral.ai → API keys',
    suggested: [
      { id: 'mistral-small-latest', note: 'Fast' },
      { id: 'mistral-large-latest', note: 'More capable' }
    ]
  },
  ollama: {
    kind: 'openai',
    label: 'Ollama (on your machine)',
    baseUrl: 'http://localhost:11434/v1',
    model: 'llama3.1',
    keyOptional: true,
    keyHelp: 'No key needed — just run Ollama locally',
    suggested: [{ id: 'llama3.1', note: 'Whatever you have pulled' }]
  },
  lmstudio: {
    kind: 'openai',
    label: 'LM Studio (on your machine)',
    baseUrl: 'http://localhost:1234/v1',
    model: 'local-model',
    keyOptional: true,
    keyHelp: 'No key needed — start the LM Studio server',
    suggested: [{ id: 'local-model', note: 'Whatever is loaded' }]
  },
  custom: {
    kind: 'openai',
    label: 'Custom OpenAI-compatible endpoint',
    baseUrl: '',
    model: '',
    keyOptional: true,
    keyHelp: 'Any server that speaks the OpenAI chat format',
    suggested: []
  }
};

export const PROVIDER_NAMES = Object.keys(PROVIDER_CATALOG);

/** What the Settings dropdowns need. Contains no secrets. */
export const publicCatalog = () =>
  PROVIDER_NAMES.map((name) => {
    const preset = PROVIDER_CATALOG[name];
    return {
      id: name,
      label: preset.label,
      defaultModel: preset.model,
      defaultBaseUrl: preset.baseUrl,
      keyOptional: Boolean(preset.keyOptional),
      keyHelp: preset.keyHelp ?? '',
      suggested: preset.suggested ?? []
    };
  });
