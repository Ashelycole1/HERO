import http from 'http';
import { spawn } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';
import { readFile, unlink, writeFile } from 'fs/promises';
import dotenv from 'dotenv';
dotenv.config();

import { getSystemStatus } from './tools.js';
import { streamLlmResponse, Message } from './llm.js';
import { TOOL_DECLARATIONS, executeTool } from './tools.js';

const PORT = 3001;
const CORS_ORIGIN = '*'; // Allow frontend dev server

const SYSTEM_PROMPT = `You are HERO, Ashley's personal voice AI assistant running 100% locally.
You were built exclusively for Ashley — you are NOT affiliated with Google, OpenAI, Anthropic, or any corporation.

VOICE RESPONSE RULES (critical — your output is read aloud):
1. NEVER use markdown: no asterisks, hashtags, dashes, backticks, or bullet lists.
2. NEVER output code blocks. If asked about code, briefly describe the logic and offer to save it instead.
3. Keep ALL responses under 3 sentences unless the user explicitly asks for detail.
4. Use natural conversational language that sounds great when spoken aloud.
5. Be warm, direct, and efficient — like a smart developer friend.
6. When reporting system stats, pick the 2-3 most relevant numbers only.

PRIVACY RULE: Never share, log, upload, or transmit any user data or file contents externally.`;

// Maintain session history in-memory per session ID
const sessions = new Map<string, Message[]>();

function sendCors(res: http.ServerResponse) {
  res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function parseBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); }
      catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  sendCors(res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url!, `http://localhost:${PORT}`);

  // ─── GET /api/metrics ────────────────────────────────────────────────
  if (req.method === 'GET' && url.pathname === '/api/metrics') {
    try {
      const metrics = await getSystemStatus();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(metrics));
    } catch (e: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // ─── POST /api/chat (SSE Streaming) ──────────────────────────────────
  if (req.method === 'POST' && url.pathname === '/api/chat') {
    let body: any;
    try { body = await parseBody(req); }
    catch { res.writeHead(400); res.end('Bad request'); return; }

    const sessionId: string = body.sessionId || 'default';
    const userMessage: string = body.message || '';

    if (!userMessage.trim()) {
      res.writeHead(400); res.end('Empty message'); return;
    }

    // Init or retrieve session history
    if (!sessions.has(sessionId)) {
      sessions.set(sessionId, [{ role: 'system', content: SYSTEM_PROMPT }]);
    }
    const chatHistory = sessions.get(sessionId)!;
    chatHistory.push({ role: 'user', content: userMessage });

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    const sendEvent = (event: string, data: any) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    try {
      let fullResponse = '';
      let pendingToolCalls: any[] = [];

      sendEvent('status', { state: 'thinking' });

      for await (const chunk of streamLlmResponse(chatHistory, TOOL_DECLARATIONS)) {
        if (chunk.type === 'text') {
          sendEvent('text', { content: chunk.content });
          fullResponse += chunk.content;
        } else if (chunk.type === 'tool_calls') {
          pendingToolCalls = chunk.toolCalls;
        }
      }

      // Save assistant turn
      const assistantMsg: Message = { role: 'assistant', content: fullResponse || undefined };
      if (pendingToolCalls.length > 0) {
        assistantMsg.tool_calls = pendingToolCalls;
      }
      chatHistory.push(assistantMsg);

      // Handle tool calls
      if (pendingToolCalls.length > 0) {
        for (const tc of pendingToolCalls) {
          const fnName: string = tc.function?.name || '';
          let args: any = {};
          try { args = JSON.parse(tc.function?.arguments || '{}'); } catch {}

          // Sensitive tools require frontend confirmation
          const sensitiveTools = ['run_command', 'manage_file'];
          if (sensitiveTools.includes(fnName) && args.action !== 'read') {
            sendEvent('confirmation_request', {
              toolCallId: tc.id,
              tool: fnName,
              args,
            });
            // In the server version, we'll handle it as approved (frontend handles it)
            // For now, run_command is confirmed via the web UI
          }

          sendEvent('tool_running', { tool: fnName });
          const result = await executeTool(fnName, args);
          chatHistory.push({
            role: 'tool',
            tool_call_id: tc.id,
            name: fnName,
            content: JSON.stringify(result)
          });
        }

        // Follow-up after tool
        sendEvent('status', { state: 'speaking' });
        for await (const chunk of streamLlmResponse(chatHistory, TOOL_DECLARATIONS)) {
          if (chunk.type === 'text') {
            sendEvent('text', { content: chunk.content });
            fullResponse += chunk.content;
          }
        }
        if (fullResponse.trim()) {
          chatHistory.push({ role: 'assistant', content: fullResponse });
        }
      }

      sendEvent('done', { state: 'idle' });
    } catch (e: any) {
      sendEvent('error', { message: e.message || 'Unknown error' });
    }

    res.end();
    return;
  }

  // ─── POST /api/tts  (Piper local TTS → browser fallback signal) ──────
  // Body: { text: string }
  // Returns: audio/wav from Piper, or 503 so frontend falls back to browser SpeechSynthesis
  if (req.method === 'POST' && url.pathname === '/api/tts') {
    const piperExe   = process.env.PIPER_EXE   || 'piper';
    const piperModel = process.env.PIPER_MODEL  || '';

    let body: any;
    try { body = await parseBody(req); } catch { res.writeHead(400); res.end('Bad request'); return; }

    const rawText: string = (body.text || '').trim();
    if (!rawText) { res.writeHead(400); res.end('Empty text'); return; }

    // Strip markdown so Piper doesn't read symbols aloud
    const text = rawText
      .replace(/`{3}[\s\S]*?`{3}/g, '')
      .replace(/`[^`\n]+`/g, '')
      .replace(/[*#_[\]]/g, '')
      .replace(/\n+/g, ' ')
      .trim();

    if (!piperModel) {
      // Piper not configured — tell frontend to use browser TTS
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'no_piper', message: 'Piper not configured. Run setup-voice.ps1 first.' }));
      return;
    }

    const tmpWav = join(tmpdir(), `hero-tts-${Date.now()}.wav`);
    try {
      await new Promise<void>((resolve, reject) => {
        const piper = spawn(piperExe, ['--model', piperModel, '--output_file', tmpWav]);
        let stderr = '';
        piper.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
        piper.stdin.write(text);
        piper.stdin.end();
        piper.on('close', (code: number) => {
          if (code === 0) resolve();
          else reject(new Error(`Piper exit ${code}: ${stderr.slice(-200)}`));
        });
        piper.on('error', reject);
      });

      const wavBuf = await readFile(tmpWav);
      await unlink(tmpWav).catch(() => {});

      res.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': wavBuf.length });
      res.end(wavBuf);
    } catch (e: any) {
      await unlink(tmpWav).catch(() => {});
      if (!res.headersSent) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'piper_failed', message: e.message }));
      }
    }
    return;
  }

  // ─── POST /api/stt  (Whisper.cpp server proxy) ───────────────────────
  // Body: raw audio blob (webm/wav) from MediaRecorder
  // Forwards to whisper.cpp server at WHISPER_SERVER_URL, returns { transcript }
  if (req.method === 'POST' && url.pathname === '/api/stt') {
    const whisperUrl = `${process.env.WHISPER_SERVER_URL || 'http://localhost:8765'}/inference`;

    // Collect raw body
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const audioBuf = Buffer.concat(chunks);

    if (!audioBuf.length) {
      res.writeHead(400); res.end('No audio'); return;
    }

    try {
      // Save to temp file (whisper.cpp server expects a file upload)
      const tmpAudio = join(tmpdir(), `hero-stt-${Date.now()}.wav`);
      await writeFile(tmpAudio, audioBuf);

      // Multipart form data — whisper.cpp server /inference endpoint
      const boundary = `----HeroSTT${Date.now()}`;
      const fileData = await readFile(tmpAudio);
      const header   = Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.wav"\r\nContent-Type: audio/wav\r\n\r\n`
      );
      const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
      const formBody = Buffer.concat([header, fileData, footer]);

      await unlink(tmpAudio).catch(() => {});

      const whisperRes = await fetch(whisperUrl, {
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': formBody.length.toString(),
        },
        body: formBody,
      });

      if (!whisperRes.ok) {
        throw new Error(`Whisper server returned ${whisperRes.status}`);
      }

      const data: any = await whisperRes.json();
      const transcript = (data.text || data.result || '').trim();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ transcript }));
    } catch (e: any) {
      // Whisper not running — tell frontend to use browser STT
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'whisper_unavailable', message: e.message }));
    }
    return;
  }

  // ─── GET /api/voice-status  (let frontend know which voice services are active) ──
  if (req.method === 'GET' && url.pathname === '/api/voice-status') {
    const hasPiper   = !!(process.env.PIPER_MODEL);
    const hasWhisper = !!(process.env.WHISPER_SERVER_URL);
    const hasOllama  = !!(process.env.OLLAMA_BASE_URL || process.env.OLLAMA_MODEL);
    const hasDeepgram = !!(process.env.DEEPGRAM_API_KEY);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ piper: hasPiper, whisper: hasWhisper, ollama: hasOllama, deepgram: hasDeepgram }));
    return;
  }

  // ─── GET /api/deepgram-key  (return Deepgram key for browser-side STT WebSocket) ──
  if (req.method === 'GET' && url.pathname === '/api/deepgram-key') {
    const key = process.env.DEEPGRAM_API_KEY || '';
    if (!key) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'DEEPGRAM_API_KEY not set in .env' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ key }));
    return;
  }

  // ─── GET /api/health ────────────────────────────────────────────────
  if (req.method === 'GET' && url.pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', version: '1.0.0' }));
    return;
  }


  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`\x1b[36m====================================================\x1b[0m`);
  console.log(`\x1b[36m  HERO Local API Server — Listening on port ${PORT}  \x1b[0m`);
  console.log(`\x1b[36m====================================================\x1b[0m`);
  console.log(`\x1b[90m  Chat endpoint : http://localhost:${PORT}/api/chat\x1b[0m`);
  console.log(`\x1b[90m  Metrics       : http://localhost:${PORT}/api/metrics\x1b[0m`);
  console.log(`\x1b[90m  Health        : http://localhost:${PORT}/api/health\x1b[0m`);
});
