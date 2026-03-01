/**
 * Translate between OpenAI and Anthropic request/response formats.
 * All other providers (Groq, Together, DeepSeek, xAI, OpenRouter) use OpenAI format natively.
 */

import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// Request: OpenAI → Anthropic
// ---------------------------------------------------------------------------

type OpenAIMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
};

export function openaiToAnthropic(body: Record<string, unknown>): Record<string, unknown> {
  const messages = (body.messages ?? []) as OpenAIMessage[];

  // Extract system messages
  const systemParts: string[] = [];
  const nonSystemMessages: Array<{ role: string; content: unknown }> = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      const text = typeof msg.content === 'string'
        ? msg.content
        : (msg.content as Array<{ text?: string }>).map(c => c.text ?? '').join('');
      systemParts.push(text);
    } else {
      nonSystemMessages.push({ role: msg.role, content: msg.content });
    }
  }

  const anthropicBody: Record<string, unknown> = {
    model: body.model,
    messages: nonSystemMessages,
    max_tokens: (body.max_tokens as number) || 4096,
  };

  if (systemParts.length > 0) {
    anthropicBody.system = systemParts.join('\n\n');
  }

  if (body.stream) anthropicBody.stream = true;
  if (body.temperature !== undefined) anthropicBody.temperature = body.temperature;
  if (body.top_p !== undefined) anthropicBody.top_p = body.top_p;
  if (body.stop !== undefined) anthropicBody.stop_sequences = body.stop;

  return anthropicBody;
}

// ---------------------------------------------------------------------------
// Response: Anthropic JSON → OpenAI JSON
// ---------------------------------------------------------------------------

export function anthropicResponseToOpenai(
  anthropicResponse: Record<string, unknown>,
  model: string,
): Record<string, unknown> {
  const content = anthropicResponse.content as Array<{ type: string; text?: string }> | undefined;
  const textParts = content?.filter(c => c.type === 'text').map(c => c.text ?? '') ?? [];
  const text = textParts.join('');

  const usage = anthropicResponse.usage as { input_tokens?: number; output_tokens?: number } | undefined;

  return {
    id: `chatcmpl-${randomUUID().replace(/-/g, '').slice(0, 24)}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: text },
        finish_reason: mapStopReason(anthropicResponse.stop_reason as string | undefined),
      },
    ],
    usage: usage ? {
      prompt_tokens: usage.input_tokens ?? 0,
      completion_tokens: usage.output_tokens ?? 0,
      total_tokens: (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0),
    } : undefined,
  };
}

// ---------------------------------------------------------------------------
// Streaming: Anthropic SSE → OpenAI SSE
// ---------------------------------------------------------------------------

export class AnthropicToOpenAIStream extends TransformStream<Uint8Array, Uint8Array> {
  constructor(model: string) {
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const completionId = `chatcmpl-${randomUUID().replace(/-/g, '').slice(0, 24)}`;
    const created = Math.floor(Date.now() / 1000);

    let inputTokens = 0;
    let outputTokens = 0;

    super({
      transform(chunk, controller) {
        const text = decoder.decode(chunk, { stream: true });

        for (const line of text.split('\n')) {
          if (!line.trim() || !line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (!raw || raw === '[DONE]') continue;

          let event: Record<string, unknown>;
          try { event = JSON.parse(raw); } catch { continue; }

          const type = event.type as string;

          if (type === 'message_start') {
            const usage = (event.message as Record<string, unknown>)?.usage as Record<string, number> | undefined;
            if (usage?.input_tokens) inputTokens = usage.input_tokens;

            const openaiChunk = {
              id: completionId, object: 'chat.completion.chunk', created, model,
              choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }],
            };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(openaiChunk)}\n\n`));
          } else if (type === 'content_block_delta') {
            const delta = event.delta as { type: string; text?: string } | undefined;
            if (delta?.type === 'text_delta' && delta.text) {
              const openaiChunk = {
                id: completionId, object: 'chat.completion.chunk', created, model,
                choices: [{ index: 0, delta: { content: delta.text }, finish_reason: null }],
              };
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(openaiChunk)}\n\n`));
            }
          } else if (type === 'message_delta') {
            const delta = event.delta as Record<string, unknown> | undefined;
            const usage = event.usage as Record<string, number> | undefined;
            if (usage?.output_tokens) outputTokens = usage.output_tokens;

            const openaiChunk = {
              id: completionId, object: 'chat.completion.chunk', created, model,
              choices: [{ index: 0, delta: {}, finish_reason: mapStopReason(delta?.stop_reason as string | undefined) }],
              ...(usage ? {
                usage: {
                  prompt_tokens: inputTokens,
                  completion_tokens: outputTokens,
                  total_tokens: inputTokens + outputTokens,
                },
              } : {}),
            };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(openaiChunk)}\n\n`));
          } else if (type === 'message_stop') {
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          }
        }
      },
    });
  }
}

function mapStopReason(reason: string | undefined): string {
  switch (reason) {
    case 'end_turn': return 'stop';
    case 'max_tokens': return 'length';
    case 'stop_sequence': return 'stop';
    case 'tool_use': return 'tool_calls';
    default: return reason ?? 'stop';
  }
}
