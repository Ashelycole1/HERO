import { config } from './config.js';

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string;
  name?: string;
  tool_call_id?: string;
  tool_calls?: any[];
}

interface FallbackModel {
  provider: 'openrouter' | 'groq' | 'grok' | 'ollama';
  model: string;
}

const FALLBACK_MODELS: FallbackModel[] = [
  // OpenRouter Free Models (Fastest & Free)
  { provider: 'openrouter', model: 'google/gemini-2.5-flash' },
  { provider: 'openrouter', model: 'meta-llama/llama-3-8b-instruct:free' },
  { provider: 'openrouter', model: 'mistralai/mistral-7b-instruct:free' },
  { provider: 'openrouter', model: 'qwen/qwen-2-7b-instruct:free' },
  { provider: 'openrouter', model: 'microsoft/phi-3-medium-128k-instruct:free' },
  // Groq Models
  { provider: 'groq', model: 'llama-3.1-8b-instant' },
  { provider: 'groq', model: 'llama3-8b-8192' },
  { provider: 'groq', model: 'llama3-70b-8192' },
  { provider: 'groq', model: 'mixtral-8x7b-32768' },
  { provider: 'groq', model: 'gemma2-9b-it' },
  // Local Ollama (Fallback when offline)
  { provider: 'ollama', model: process.env.OLLAMA_MODEL || 'llama3.2' }
];

function getApiKey(provider: 'openrouter' | 'groq' | 'grok' | 'ollama'): string {
  if (provider === 'openrouter') return process.env.OPENROUTER_API_KEY || '';
  if (provider === 'groq') return process.env.GROQ_API_KEY || '';
  if (provider === 'grok') return process.env.GROK_API_KEY || '';
  if (provider === 'ollama') return 'ollama'; // No key needed
  return '';
}

function getApiUrl(provider: 'openrouter' | 'groq' | 'grok' | 'ollama'): string {
  if (provider === 'openrouter') return 'https://openrouter.ai/api/v1/chat/completions';
  if (provider === 'groq') return 'https://api.groq.com/openai/v1/chat/completions';
  if (provider === 'grok') return 'https://api.x.ai/v1/chat/completions';
  if (provider === 'ollama') return `${process.env.OLLAMA_BASE_URL || 'http://localhost:11434'}/v1/chat/completions`;
  return '';
}

export type LLMOutputChunk = 
  | { type: 'text'; content: string }
  | { type: 'tool_calls'; toolCalls: any[] };

/**
 * Streams the response from the LLM. Automatically supports tool calling
 * and rotates candidates upon failure.
 */
export async function* streamLlmResponse(
  messages: Message[],
  tools?: any[]
): AsyncGenerator<LLMOutputChunk, void, unknown> {
  const candidates: FallbackModel[] = [
    { provider: config.modelProvider, model: config.model },
    ...FALLBACK_MODELS.filter(m => !(m.provider === config.modelProvider && m.model === config.model))
  ];

  let success = false;

  for (const candidate of candidates) {
    const key = getApiKey(candidate.provider);
    // Ollama needs no key; cloud providers require a real key
    if (candidate.provider !== 'ollama' && (!key || key === 'your_openrouter_api_key_here')) {
      continue;
    }

    const apiUrl = getApiUrl(candidate.provider);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`,
    };

    if (candidate.provider === 'openrouter') {
      headers['HTTP-Referer'] = 'http://localhost:3000';
      headers['X-Title'] = 'HERO Assistant';
    }

    try {
      const bodyPayload: any = {
        model: candidate.model,
        messages,
        stream: true,
        max_tokens: 2048,
      };

      if (tools && tools.length > 0) {
        bodyPayload.tools = tools;
      }

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(bodyPayload),
      });

      if (!response.ok) {
        continue;
      }

      if (!response.body) {
        continue;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      
      success = true;

      // Update active configuration
      config.modelProvider = candidate.provider;
      config.model = candidate.model;
      config.apiKey = key;

      const toolCallsAccumulator: any[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          if (trimmed.startsWith('data: ')) {
            const dataStr = trimmed.slice(6).trim();
            if (dataStr === '[DONE]') continue;
            try {
              const parsed = JSON.parse(dataStr);
              const delta = parsed.choices?.[0]?.delta;
              
              // Handle streaming tool calls
              if (delta?.tool_calls) {
                for (const tc of delta.tool_calls) {
                  const idx = tc.index;
                  if (toolCallsAccumulator[idx] === undefined) {
                    toolCallsAccumulator[idx] = {
                      id: tc.id || '',
                      type: 'function',
                      function: {
                        name: tc.function?.name || '',
                        arguments: tc.function?.arguments || ''
                      }
                    };
                  } else {
                    if (tc.id) toolCallsAccumulator[idx].id = tc.id;
                    if (tc.function?.name) toolCallsAccumulator[idx].function.name = tc.function.name;
                    if (tc.function?.arguments) {
                      toolCallsAccumulator[idx].function.arguments += tc.function.arguments;
                    }
                  }
                }
              }

              // Handle streaming text
              const content = delta?.content;
              if (content) {
                yield { type: 'text', content };
              }
            } catch (e) {
              // Ignore partial chunk parse issues
            }
          }
        }
      }

      // Check remainder
      if (buffer.trim().startsWith('data: ')) {
        const dataStr = buffer.trim().slice(6).trim();
        if (dataStr !== '[DONE]') {
          try {
            const parsed = JSON.parse(dataStr);
            const delta = parsed.choices?.[0]?.delta;
            if (delta?.content) {
              yield { type: 'text', content: delta.content };
            }
          } catch (e) {}
        }
      }

      // If tool calls were accumulated, yield them
      const cleanToolCalls = toolCallsAccumulator.filter(Boolean);
      if (cleanToolCalls.length > 0) {
        yield { type: 'tool_calls', toolCalls: cleanToolCalls };
      }

      break;

    } catch (error) {
      // Try next candidate
    }
  }

  if (!success) {
    yield { type: 'text', content: `\n[System Error: All configured free models failed to respond. Please check your internet connection and API keys.]` };
  }
}
export async function getLlmResponse(messages: Message[], tools?: any[]): Promise<string> {
  let fullText = '';
  for await (const chunk of streamLlmResponse(messages, tools)) {
    if (chunk.type === 'text') {
      fullText += chunk.content;
    }
  }
  return fullText;
}
