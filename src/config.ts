import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

export type ModelProvider = 'openrouter' | 'groq' | 'grok' | 'ollama';

export interface Config {
  modelProvider: ModelProvider;
  apiKey: string;
  model: string;
}

function validateAndGetConfig(): Config {
  const raw = (process.env.MODEL_PROVIDER || 'openrouter').toLowerCase();
  const validProviders: ModelProvider[] = ['openrouter', 'groq', 'grok', 'ollama'];
  const modelProvider: ModelProvider = validProviders.includes(raw as ModelProvider)
    ? (raw as ModelProvider)
    : 'openrouter';

  let apiKey = '';
  let model  = '';

  if (modelProvider === 'openrouter') {
    apiKey = process.env.OPENROUTER_API_KEY || '';
    model  = process.env.OPENROUTER_MODEL  || 'google/gemini-2.5-flash';
  } else if (modelProvider === 'groq') {
    apiKey = process.env.GROQ_API_KEY || '';
    model  = process.env.GROQ_MODEL   || 'llama3-8b-8192';
  } else if (modelProvider === 'grok') {
    apiKey = process.env.GROK_API_KEY || '';
    model  = process.env.GROK_MODEL   || 'grok-2-1212';
  } else if (modelProvider === 'ollama') {
    apiKey = 'ollama'; // No key required
    model  = process.env.OLLAMA_MODEL || 'llama3.2';
  }

  if (!apiKey || apiKey === 'your_openrouter_api_key_here') {
    if (modelProvider !== 'ollama') {
      console.warn(`WARNING: API key for ${modelProvider} is not set.`);
    }
  }

  return { modelProvider, apiKey, model };
}

export const config = validateAndGetConfig();

export function updateConfig(provider: ModelProvider, modelName: string) {
  config.modelProvider = provider;
  config.model         = modelName;
  if (provider === 'openrouter') config.apiKey = process.env.OPENROUTER_API_KEY || '';
  else if (provider === 'groq')  config.apiKey = process.env.GROQ_API_KEY || '';
  else if (provider === 'grok')  config.apiKey = process.env.GROK_API_KEY || '';
  else if (provider === 'ollama') config.apiKey = 'ollama';
}
