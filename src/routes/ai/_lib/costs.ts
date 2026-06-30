/**
 * AI Provider Cost Tables
 * Pricing data for calculating inference costs
 */

// ============================================
// INPUT COST PER TOKEN ($/token)
// ============================================

export const INPUT_COST_PER_TOKEN: Record<string, number | { text: number; audio: number }> = {
  // OpenAI models
  'gpt-4.1': 0.002 / 1000,
  'gpt-4.1-2025-04-14': 0.002 / 1000,
  'gpt-4.1-mini': 0.0004 / 1000,
  'gpt-4.1-mini-2025-04-14': 0.0004 / 1000,
  'gpt-4.1-nano': 0.0002 / 1000,
  'gpt-4.1-nano-2025-04-14': 0.0002 / 1000,
  'gpt-4o': 0.0025 / 1000,
  'gpt-4o-2024-11-20': 0.0025 / 1000,
  'gpt-4o-2024-08-06': 0.0025 / 1000,
  'gpt-4o-2024-05-13': 0.005 / 1000,
  'gpt-4o-mini': 0.00015 / 1000,
  'gpt-4o-mini-2024-07-18': 0.00015 / 1000,
  'gpt-4-turbo': 0.01 / 1000,
  'gpt-4-turbo-preview': 0.01 / 1000,
  'gpt-4': 0.03 / 1000,
  'gpt-3.5-turbo': 0.003 / 1000,
  'o1': 0.015 / 1000,
  'o1-2024-12-17': 0.015 / 1000,
  'o1-preview': 0.015 / 1000,
  'o1-mini': 0.0011 / 1000,
  'o3': 0.002 / 1000,
  'o3-mini': 0.0011 / 1000,
  'o4-mini': 0.0011 / 1000,

  // OpenAI Embeddings
  'text-embedding-ada-002': 0.0001 / 1000,
  'text-embedding-3-small': 0.00002 / 1000,
  'text-embedding-3-large': 0.00013 / 1000,

  // OpenAI Audio
  'whisper-1': 0.006, // per minute
  'tts-1': 0.015 / 1000, // per char
  'tts-1-hd': 0.03 / 1000, // per char

  // Anthropic models
  'claude-3-5-sonnet-latest': 0.003 / 1000,
  'claude-3-5-sonnet-20241022': 0.003 / 1000,
  'claude-3-5-sonnet-20240620': 0.003 / 1000,
  'claude-3-7-sonnet-latest': 0.003 / 1000,
  'claude-3-7-sonnet-20250219': 0.003 / 1000,
  'claude-3-opus-latest': 0.015 / 1000,
  'claude-3-opus-20240229': 0.015 / 1000,
  'claude-3-sonnet-20240229': 0.003 / 1000,
  'claude-3-haiku-20240307': 0.00025 / 1000,
  'claude-3-5-haiku-20241022': 0.0008 / 1000,

  // DeepSeek models
  'deepseek-chat': 0.00027 / 1000,
  'deepseek-reasoner': 0.00055 / 1000,

  // Groq models
  'llama-3.3-70b-versatile': 0.00059 / 1000,
  'llama-3.1-8b-instant': 0.00005 / 1000,
  'llama-3-70b-8192': 0.00059 / 1000,
  'llama-3-8b-8192': 0.00005 / 1000,
  'mixtral-8x7b-32768': 0.00024 / 1000,
  'gemma2-9b-it': 0.0002 / 1000,

  // Together models
  'meta-llama/Llama-3.3-70B-Instruct-Turbo': 0.00088 / 1000,
  'meta-llama/Llama-3.1-8B-Instruct-Turbo': 0.00018 / 1000,
  'meta-llama/Llama-3.1-70B-Instruct-Turbo': 0.00088 / 1000,
  'meta-llama/Llama-3.1-405B-Instruct-Turbo': 0.0035 / 1000,
  'Qwen/Qwen2.5-72B-Instruct-Turbo': 0.0012 / 1000,
  'deepseek-ai/DeepSeek-V3': 0.00125 / 1000,

  // xAI Grok models
  'grok-2': 0.003 / 1000,
  'grok-2-latest': 0.003 / 1000,
  'grok-2-vision-1212': 0.003 / 1000,
  'grok-beta': 0.005 / 1000,

  // ElevenLabs
  'eleven_multilingual_v2': 0.18 / 1000, // per char
  'eleven_turbo_v2': 0.18 / 1000,
  'eleven_turbo_v2_5': 0.18 / 1000,
};

// ============================================
// OUTPUT COST PER TOKEN ($/token)
// ============================================

export const OUTPUT_COST_PER_TOKEN: Record<string, number | { text: number; audio: number }> = {
  // OpenAI models
  'gpt-4.1': 0.008 / 1000,
  'gpt-4.1-2025-04-14': 0.008 / 1000,
  'gpt-4.1-mini': 0.0016 / 1000,
  'gpt-4.1-mini-2025-04-14': 0.0016 / 1000,
  'gpt-4.1-nano': 0.0004 / 1000,
  'gpt-4.1-nano-2025-04-14': 0.0004 / 1000,
  'gpt-4o': 0.01 / 1000,
  'gpt-4o-2024-11-20': 0.01 / 1000,
  'gpt-4o-2024-08-06': 0.01 / 1000,
  'gpt-4o-2024-05-13': 0.015 / 1000,
  'gpt-4o-mini': 0.0006 / 1000,
  'gpt-4o-mini-2024-07-18': 0.0006 / 1000,
  'gpt-4-turbo': 0.03 / 1000,
  'gpt-4-turbo-preview': 0.03 / 1000,
  'gpt-4': 0.06 / 1000,
  'gpt-3.5-turbo': 0.006 / 1000,
  'o1': 0.06 / 1000,
  'o1-2024-12-17': 0.06 / 1000,
  'o1-preview': 0.06 / 1000,
  'o1-mini': 0.0044 / 1000,
  'o3': 0.008 / 1000,
  'o3-mini': 0.0044 / 1000,
  'o4-mini': 0.0044 / 1000,

  // Anthropic models
  'claude-3-5-sonnet-latest': 0.015 / 1000,
  'claude-3-5-sonnet-20241022': 0.015 / 1000,
  'claude-3-5-sonnet-20240620': 0.015 / 1000,
  'claude-3-7-sonnet-latest': 0.015 / 1000,
  'claude-3-7-sonnet-20250219': 0.015 / 1000,
  'claude-3-opus-latest': 0.075 / 1000,
  'claude-3-opus-20240229': 0.075 / 1000,
  'claude-3-sonnet-20240229': 0.015 / 1000,
  'claude-3-haiku-20240307': 0.00125 / 1000,
  'claude-3-5-haiku-20241022': 0.004 / 1000,

  // DeepSeek models
  'deepseek-chat': 0.0011 / 1000,
  'deepseek-reasoner': 0.00219 / 1000,

  // Groq models
  'llama-3.3-70b-versatile': 0.00079 / 1000,
  'llama-3.1-8b-instant': 0.00008 / 1000,
  'llama-3-70b-8192': 0.00079 / 1000,
  'llama-3-8b-8192': 0.00008 / 1000,
  'mixtral-8x7b-32768': 0.00024 / 1000,
  'gemma2-9b-it': 0.0002 / 1000,

  // Together models (same as input for most)
  'meta-llama/Llama-3.3-70B-Instruct-Turbo': 0.00088 / 1000,
  'meta-llama/Llama-3.1-8B-Instruct-Turbo': 0.00018 / 1000,
  'meta-llama/Llama-3.1-70B-Instruct-Turbo': 0.00088 / 1000,
  'meta-llama/Llama-3.1-405B-Instruct-Turbo': 0.0035 / 1000,
  'Qwen/Qwen2.5-72B-Instruct-Turbo': 0.0012 / 1000,
  'deepseek-ai/DeepSeek-V3': 0.00125 / 1000,

  // xAI Grok models
  'grok-2': 0.015 / 1000,
  'grok-2-latest': 0.015 / 1000,
  'grok-2-vision-1212': 0.015 / 1000,
  'grok-beta': 0.015 / 1000,
};

// ============================================
// IMAGE GENERATION COSTS ($/image or $/megapixel)
// ============================================

export const IMAGE_GENERATION_COSTS: Record<string, Record<string, Record<string, number>>> = {
  // OpenAI DALL-E
  'dall-e-3': {
    standard: {
      '1024x1024': 0.04,
      '1024x1792': 0.08,
      '1792x1024': 0.08,
    },
    hd: {
      '1024x1024': 0.08,
      '1024x1792': 0.12,
      '1792x1024': 0.12,
    },
    default: { default: 0.12 },
  },
  'dall-e-2': {
    standard: {
      '1024x1024': 0.02,
      '512x512': 0.018,
      '256x256': 0.016,
    },
    default: { default: 0.02 },
  },

  // Stability AI
  'stable-diffusion-xl-1024-v1-0': {
    default: { default: 0.02 },
  },
  'stable-diffusion-3': {
    default: { default: 0.035 },
  },
  'stable-diffusion-3-medium': {
    default: { default: 0.035 },
  },
  'stable-image-core': {
    default: { default: 0.03 },
  },
  'stable-image-ultra': {
    default: { default: 0.08 },
  },
};

// ============================================
// FAL.AI COSTS (various pricing models)
// ============================================

export const FAL_AI_COSTS: Record<string, { type: 'per_image' | 'per_megapixel' | 'per_second' | 'per_video'; rate: number }> = {
  'fal-ai/flux/dev': { type: 'per_megapixel', rate: 0.025 },
  'fal-ai/flux/schnell': { type: 'per_megapixel', rate: 0.003 },
  'fal-ai/flux-pro/v1.1': { type: 'per_megapixel', rate: 0.04 },
  'fal-ai/flux-pro/v1.1-ultra': { type: 'per_megapixel', rate: 0.06 },
  'fal-ai/recraft-v3': { type: 'per_image', rate: 0.04 },
  'fal-ai/ideogram/v2': { type: 'per_image', rate: 0.08 },
  'fal-ai/ideogram/v2/turbo': { type: 'per_image', rate: 0.04 },
  'fal-ai/kling-video/v1/standard/image-to-video': { type: 'per_second', rate: 0.05 },
  'fal-ai/kling-video/v1/pro/image-to-video': { type: 'per_second', rate: 0.10 },
  'fal-ai/minimax-video/image-to-video': { type: 'per_video', rate: 0.50 },
  'fal-ai/luma-dream-machine/image-to-video': { type: 'per_video', rate: 0.40 },
};

// ============================================
// WORLDLABS COSTS
// ============================================

export const WORLDLABS_COSTS: Record<string, number> = {
  'gaia-1': 0.10, // per generation
};

// ============================================
// DEFAULT/FALLBACK COSTS
// ============================================

// Fallback when a model is absent from the per-model tables above (e.g. an
// OpenRouter pass-through id we don't track, or a brand-new frontier model).
// Set to a CONSERVATIVE frontier tier (~GPT-4o / Claude-Sonnet pricing) rather
// than a rounding error: the old $1/$2-per-1M default undercharged unlisted
// frontier models 15–100×, an always-on revenue leak. Listed models are
// unaffected — add new models to the tables to bill them exactly. For
// OpenRouter we additionally bill the upstream's authoritative `usage.cost`
// when present (see routes/ai/openrouter.ts). (Audit C2, 2026-06-29.)
export const DEFAULT_INPUT_COST_PER_TOKEN = 5 / 1_000_000; // $5 / 1M input tokens
export const DEFAULT_OUTPUT_COST_PER_TOKEN = 15 / 1_000_000; // $15 / 1M output tokens
