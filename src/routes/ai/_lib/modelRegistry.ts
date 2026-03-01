/**
 * Model-to-provider registry for the unified /v1/chat/completions endpoint.
 * Maps model IDs to their upstream provider and request format.
 */

export type Provider = 'openai' | 'anthropic' | 'groq' | 'together' | 'deepseek' | 'openrouter' | 'xai';
export type RequestFormat = 'openai' | 'anthropic';

export type ModelEntry = {
  provider: Provider;
  format: RequestFormat;
};

export type ProviderConfig = {
  baseUrl: string;
  envKey: string;
  authHeader: string;
  authPrefix: string;
  extraHeaders?: Record<string, string>;
};

export const PROVIDER_CONFIG: Record<Provider, ProviderConfig> = {
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    envKey: 'OPENAI_API_KEY',
    authHeader: 'Authorization',
    authPrefix: 'Bearer ',
  },
  anthropic: {
    baseUrl: 'https://api.anthropic.com/v1',
    envKey: 'ANTHROPIC_API_KEY',
    authHeader: 'x-api-key',
    authPrefix: '',
    extraHeaders: { 'anthropic-version': '2023-06-01' },
  },
  groq: {
    baseUrl: 'https://api.groq.com/openai/v1',
    envKey: 'GROQ_API_KEY',
    authHeader: 'Authorization',
    authPrefix: 'Bearer ',
  },
  together: {
    baseUrl: 'https://api.together.xyz/v1',
    envKey: 'TOGETHER_API_KEY',
    authHeader: 'Authorization',
    authPrefix: 'Bearer ',
  },
  deepseek: {
    baseUrl: 'https://api.deepseek.com/v1',
    envKey: 'DEEPSEEK_API_KEY',
    authHeader: 'Authorization',
    authPrefix: 'Bearer ',
  },
  openrouter: {
    baseUrl: 'https://openrouter.ai/api/v1',
    envKey: 'OPENROUTER_API_KEY',
    authHeader: 'Authorization',
    authPrefix: 'Bearer ',
  },
  xai: {
    baseUrl: 'https://api.x.ai/v1',
    envKey: 'XAI_API_KEY',
    authHeader: 'Authorization',
    authPrefix: 'Bearer ',
  },
};

const MODEL_REGISTRY: Record<string, ModelEntry> = {
  // OpenAI
  'gpt-4.1':                    { provider: 'openai', format: 'openai' },
  'gpt-4.1-2025-04-14':         { provider: 'openai', format: 'openai' },
  'gpt-4.1-mini':               { provider: 'openai', format: 'openai' },
  'gpt-4.1-mini-2025-04-14':    { provider: 'openai', format: 'openai' },
  'gpt-4.1-nano':               { provider: 'openai', format: 'openai' },
  'gpt-4.1-nano-2025-04-14':    { provider: 'openai', format: 'openai' },
  'gpt-4o':                     { provider: 'openai', format: 'openai' },
  'gpt-4o-2024-11-20':          { provider: 'openai', format: 'openai' },
  'gpt-4o-2024-08-06':          { provider: 'openai', format: 'openai' },
  'gpt-4o-2024-05-13':          { provider: 'openai', format: 'openai' },
  'gpt-4o-mini':                { provider: 'openai', format: 'openai' },
  'gpt-4o-mini-2024-07-18':     { provider: 'openai', format: 'openai' },
  'gpt-4-turbo':                { provider: 'openai', format: 'openai' },
  'gpt-4-turbo-preview':        { provider: 'openai', format: 'openai' },
  'gpt-4':                      { provider: 'openai', format: 'openai' },
  'gpt-3.5-turbo':              { provider: 'openai', format: 'openai' },
  'o1':                         { provider: 'openai', format: 'openai' },
  'o1-2024-12-17':              { provider: 'openai', format: 'openai' },
  'o1-preview':                 { provider: 'openai', format: 'openai' },
  'o1-mini':                    { provider: 'openai', format: 'openai' },
  'o3':                         { provider: 'openai', format: 'openai' },
  'o3-mini':                    { provider: 'openai', format: 'openai' },
  'o4-mini':                    { provider: 'openai', format: 'openai' },

  // Anthropic
  'claude-3-7-sonnet-latest':   { provider: 'anthropic', format: 'anthropic' },
  'claude-3-7-sonnet-20250219': { provider: 'anthropic', format: 'anthropic' },
  'claude-3-5-sonnet-latest':   { provider: 'anthropic', format: 'anthropic' },
  'claude-3-5-sonnet-20241022': { provider: 'anthropic', format: 'anthropic' },
  'claude-3-5-sonnet-20240620': { provider: 'anthropic', format: 'anthropic' },
  'claude-3-opus-latest':       { provider: 'anthropic', format: 'anthropic' },
  'claude-3-opus-20240229':     { provider: 'anthropic', format: 'anthropic' },
  'claude-3-sonnet-20240229':   { provider: 'anthropic', format: 'anthropic' },
  'claude-3-haiku-20240307':    { provider: 'anthropic', format: 'anthropic' },
  'claude-3-5-haiku-20241022':  { provider: 'anthropic', format: 'anthropic' },

  // DeepSeek
  'deepseek-chat':              { provider: 'deepseek', format: 'openai' },
  'deepseek-reasoner':          { provider: 'deepseek', format: 'openai' },

  // Groq
  'llama-3.3-70b-versatile':    { provider: 'groq', format: 'openai' },
  'llama-3.1-8b-instant':       { provider: 'groq', format: 'openai' },
  'llama-3-70b-8192':           { provider: 'groq', format: 'openai' },
  'llama-3-8b-8192':            { provider: 'groq', format: 'openai' },
  'mixtral-8x7b-32768':         { provider: 'groq', format: 'openai' },
  'gemma2-9b-it':               { provider: 'groq', format: 'openai' },

  // Together
  'meta-llama/Llama-3.3-70B-Instruct-Turbo':  { provider: 'together', format: 'openai' },
  'meta-llama/Llama-3.1-8B-Instruct-Turbo':   { provider: 'together', format: 'openai' },
  'meta-llama/Llama-3.1-70B-Instruct-Turbo':  { provider: 'together', format: 'openai' },
  'meta-llama/Llama-3.1-405B-Instruct-Turbo': { provider: 'together', format: 'openai' },
  'Qwen/Qwen2.5-72B-Instruct-Turbo':         { provider: 'together', format: 'openai' },
  'deepseek-ai/DeepSeek-V3':                  { provider: 'together', format: 'openai' },

  // xAI
  'grok-2-latest':              { provider: 'xai', format: 'openai' },
  'grok-2':                     { provider: 'xai', format: 'openai' },
  'grok-2-vision-1212':         { provider: 'xai', format: 'openai' },
  'grok-beta':                  { provider: 'xai', format: 'openai' },

  // OpenRouter
  'openai/gpt-4.1':                     { provider: 'openrouter', format: 'openai' },
  'openai/gpt-4o-mini':                 { provider: 'openrouter', format: 'openai' },
  'anthropic/claude-3.7-sonnet':        { provider: 'openrouter', format: 'openai' },
  'anthropic/claude-3.5-sonnet':        { provider: 'openrouter', format: 'openai' },
  'deepseek/deepseek-chat':             { provider: 'openrouter', format: 'openai' },
  'meta-llama/llama-3.3-70b-instruct':  { provider: 'openrouter', format: 'openai' },
};

/**
 * Resolve a model ID to its provider and format.
 * Unknown models with a slash are routed to OpenRouter (pass-through).
 */
export function resolveProvider(modelId: string): ModelEntry | null {
  const entry = MODEL_REGISTRY[modelId];
  if (entry) return entry;

  // Models with org/name pattern (e.g. "mistralai/Mistral-7B") → OpenRouter pass-through
  if (modelId.includes('/')) {
    return { provider: 'openrouter', format: 'openai' };
  }

  return null;
}

export function listModels(): Array<{ id: string; provider: Provider }> {
  return Object.entries(MODEL_REGISTRY).map(([id, entry]) => ({
    id,
    provider: entry.provider,
  }));
}
