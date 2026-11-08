import { config } from '../config/index.ts';
import { currentTraceId, TRACE_HEADER } from './trace.ts';

/** A message in the form llama.cpp's OpenAI-compatible endpoint takes. */
export interface LlmMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

/** @returns True when the language model server answers. */
export async function llmHealthy(): Promise<boolean> {
    if (!config.llm.url) return false;
    try {
        const response = await fetch(new URL('/health', config.llm.url), {
            signal: AbortSignal.timeout(2_000),
        });
        return response.ok;
    } catch {
        return false;
    }
}

/**
 * Streams the model's answer as it is generated. The answer is constrained to `schema` by the server's grammar
 * sampler, so what comes out always parses; `signal` stops the generation when the person closes the page.
 */
export async function* streamCompletion(
    messages: LlmMessage[],
    schema: Record<string, unknown>,
    signal: AbortSignal,
): AsyncGenerator<string> {
    if (!config.llm.url) throw new Error('LLM_SERVICE_URL is not set.');
    const response = await fetch(new URL('/v1/chat/completions', config.llm.url), {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            ...(currentTraceId() ? { [TRACE_HEADER]: currentTraceId() as string } : {}),
        },
        body: JSON.stringify({
            messages,
            stream: true,
            temperature: 0.2,
            max_tokens: config.llm.maxTokens,
            response_format: {
                type: 'json_schema',
                json_schema: { name: 'assistant_turn', strict: true, schema },
            },
        }),
        signal: AbortSignal.any([signal, AbortSignal.timeout(config.llm.timeoutMs)]),
    });
    if (!response.ok || !response.body) throw new Error(`llm answered ${String(response.status)}`);

    const decoder = new TextDecoder();
    let buffer = '';
    for await (const chunk of response.body) {
        buffer += decoder.decode(chunk as Uint8Array, { stream: true });
        let end = buffer.indexOf('\n');
        while (end !== -1) {
            const line = buffer.slice(0, end).trim();
            buffer = buffer.slice(end + 1);
            end = buffer.indexOf('\n');
            if (!line.startsWith('data:')) continue;
            const payload = line.slice(5).trim();
            if (payload === '[DONE]') return;
            const delta = (JSON.parse(payload) as { choices?: { delta?: { content?: string } }[] })
                .choices?.[0]?.delta?.content;
            if (delta) yield delta;
        }
    }
}
