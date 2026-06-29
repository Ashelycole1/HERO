import readline from 'readline';
import { streamLlmResponse, Message } from './llm.js';
import { config, updateConfig } from './config.js';
import { TOOL_DECLARATIONS, executeTool } from './tools.js';

// Define ANSI color codes for rich CLI terminal aesthetics
const COLOR_RESET = '\x1b[0m';
const COLOR_HERO = '\x1b[36m';     // Cyan
const COLOR_USER = '\x1b[33m';     // Yellow
const COLOR_SYSTEM = '\x1b[90m';   // Dim gray
const COLOR_ALERT = '\x1b[31m';    // Red

const SYSTEM_PROMPT = `You are HERO, a warm, friendly, supportive, and clear personal assistant created exclusively for Ashley (Ashelycole) to manage their PC and projects.
Your goal is to help Ashley with computer monitoring, project work, writing/reviewing code, and personal tasks.
AFFILIATION RULE: You are NOT affiliated with Google, OpenAI, Anthropic, or any other corporation. If asked about your creators or origin, state that you are Ashley's personal assistant, custom built for Ashley.
Keep your responses conversational, brief, and helpful. Avoid long-winded robotic disclaimers or excessively long introductory and concluding remarks.
Focus on getting straight to the point while maintaining a warm and encouraging tone.`;

async function main() {
  console.clear();
  console.log(`${COLOR_HERO}====================================================${COLOR_RESET}`);
  console.log(`${COLOR_HERO}           HERO — Your Voice-First Core Brain       ${COLOR_RESET}`);
  console.log(`${COLOR_HERO}====================================================${COLOR_RESET}`);
  console.log(`${COLOR_SYSTEM}Model Provider : ${config.modelProvider}${COLOR_RESET}`);
  console.log(`${COLOR_SYSTEM}Active Model   : ${config.model}${COLOR_RESET}`);
  console.log(`${COLOR_SYSTEM}Status         : Ready (Type '/exit' or '/quit' to close)${COLOR_RESET}`);
  console.log(`${COLOR_HERO}HERO:${COLOR_RESET} Hello! I'm HERO, your personal assistant. How can I help you today?\n`);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const chatHistory: Message[] = [
    { role: 'system', content: SYSTEM_PROMPT },
  ];

  const promptUser = () => {
    rl.question(`${COLOR_USER}You > ${COLOR_RESET}`, async (input) => {
      const trimmedInput = input.trim();

      if (!trimmedInput) {
        promptUser();
        return;
      }

      if (trimmedInput.startsWith('/')) {
        const parts = trimmedInput.split(' ');
        const command = parts[0].toLowerCase();
        
        if (command === '/exit' || command === '/quit') {
          console.log(`\n${COLOR_HERO}HERO:${COLOR_RESET} Have a wonderful day! Goodbye.`);
          rl.close();
          process.exit(0);
        }
        
        if (command === '/status') {
          console.log(`\n${COLOR_SYSTEM}Current Status:${COLOR_RESET}`);
          console.log(`- Provider : ${config.modelProvider}`);
          console.log(`- Model    : ${config.model}`);
          console.log(`- API Key  : ${config.apiKey ? 'Configured (starts with ' + config.apiKey.slice(0, 8) + '...)' : 'MISSING'}\n`);
          promptUser();
          return;
        }

        if (command === '/help') {
          console.log(`\n${COLOR_SYSTEM}Available Commands:${COLOR_RESET}`);
          console.log(`- /status                      : Show active LLM model and provider`);
          console.log(`- /model <provider> <model>    : Switch LLM model (e.g. /model openrouter google/gemini-2.5-flash)`);
          console.log(`- /model <model>               : Switch model for the current provider`);
          console.log(`- /exit or /quit               : Terminate the CLI session\n`);
          promptUser();
          return;
        }

        if (command === '/model') {
          if (parts.length < 2) {
            console.log(`${COLOR_ALERT}Error: Please specify a model (e.g. /model meta-llama/llama-3-8b-instruct:free)${COLOR_RESET}`);
            promptUser();
            return;
          }

          let provider: 'openrouter' | 'groq' | 'grok' | 'ollama' = config.modelProvider;
          let modelName = '';

          if (parts.length >= 3) {
            const reqProvider = parts[1].toLowerCase();
            if (reqProvider === 'openrouter' || reqProvider === 'groq' || reqProvider === 'grok' || reqProvider === 'ollama') {
              provider = reqProvider as 'openrouter' | 'groq' | 'grok' | 'ollama';
              modelName = parts.slice(2).join(' ');
            } else {
              console.log(`${COLOR_ALERT}Error: Unknown provider "${reqProvider}". Use: openrouter, groq, grok, or ollama.${COLOR_RESET}`);
              promptUser();
              return;
            }
          } else {
            modelName = parts[1];
          }

          try {
            updateConfig(provider, modelName);
            console.log(`\n${COLOR_HERO}HERO:${COLOR_RESET} Switched to ${COLOR_HERO}${provider}${COLOR_RESET} model: ${COLOR_HERO}${modelName}${COLOR_RESET}\n`);
          } catch (e: any) {
            console.log(`${COLOR_ALERT}Error switching configuration: ${e.message}${COLOR_RESET}`);
          }
          promptUser();
          return;
        }

        console.log(`${COLOR_ALERT}Unknown command: ${parts[0]}. Type /help for assistance.${COLOR_RESET}`);
        promptUser();
        return;
      }

      // Add user message to history
      chatHistory.push({ role: 'user', content: trimmedInput });

      process.stdout.write(`\n${COLOR_HERO}HERO > ${COLOR_RESET}`);

      let fullResponse = '';
      let pendingToolCalls: any[] = [];
      try {
        for await (const chunk of streamLlmResponse(chatHistory, TOOL_DECLARATIONS)) {
          if (chunk.type === 'text') {
            process.stdout.write(chunk.content);
            fullResponse += chunk.content;
          } else if (chunk.type === 'tool_calls') {
            pendingToolCalls = chunk.toolCalls;
          }
        }
      } catch (err: any) {
        console.log(`${COLOR_ALERT}\n[An unexpected error occurred: ${err.message || err}]${COLOR_RESET}`);
      }

      console.log('\n');

      // Save assistant message
      const assistantMsg: Message = { role: 'assistant', content: fullResponse || undefined };
      if (pendingToolCalls.length > 0) {
        assistantMsg.tool_calls = pendingToolCalls;
      }
      chatHistory.push(assistantMsg);

      // Execute tool calls if present
      if (pendingToolCalls.length > 0) {
        for (const tc of pendingToolCalls) {
          const fnName = tc.function?.name || '';
          let args: any = {};
          try { args = JSON.parse(tc.function?.arguments || '{}'); } catch {}

          // Confirmation gate for sensitive tools
          const sensitiveTools = ['run_command', 'manage_file'];
          if (sensitiveTools.includes(fnName)) {
            const actionDesc = fnName === 'run_command'
              ? `Run command: \x1b[33m${args.command}\x1b[0m`
              : `${args.action} file: \x1b[33m${args.filePath}\x1b[0m`;
            process.stdout.write(`\n${COLOR_ALERT}⚠  HERO wants to: ${actionDesc}. Approve? (yes/no) > ${COLOR_RESET}`);
            const approved = await new Promise<boolean>((res) => {
              rl.question('', (ans) => res(ans.trim().toLowerCase() === 'yes'));
            });
            if (!approved) {
              chatHistory.push({ role: 'tool', tool_call_id: tc.id, name: fnName, content: 'Action was denied by the user.' });
              continue;
            }
          }

          process.stdout.write(`${COLOR_SYSTEM}[Running ${fnName}...]${COLOR_RESET}\n`);
          const result = await executeTool(fnName, args);
          chatHistory.push({ role: 'tool', tool_call_id: tc.id, name: fnName, content: JSON.stringify(result) });
        }

        // Let the LLM process the tool results
        process.stdout.write(`\n${COLOR_HERO}HERO > ${COLOR_RESET}`);
        let followUpResponse = '';
        try {
          for await (const chunk of streamLlmResponse(chatHistory, TOOL_DECLARATIONS)) {
            if (chunk.type === 'text') {
              process.stdout.write(chunk.content);
              followUpResponse += chunk.content;
            }
          }
        } catch {}
        console.log('\n');
        if (followUpResponse.trim()) {
          chatHistory.push({ role: 'assistant', content: followUpResponse });
        }
      }

      promptUser();
    });
  };

  promptUser();
}

main().catch((err) => {
  console.error(`${COLOR_ALERT}Critical initialization error: ${err.message || err}${COLOR_RESET}`);
});
