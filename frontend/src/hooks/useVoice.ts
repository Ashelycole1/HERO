/**
 * useVoice — Deepgram Real-Time STT + Browser SpeechSynthesis TTS
 *
 * STT: Deepgram Nova-2 via WebSocket (wss://api.deepgram.com/v1/listen)
 *   - Real-time word-by-word transcription, smart formatting, endpointing
 *   - VAD (Voice Activity Detection) built-in
 *
 * TTS: window.speechSynthesis (browser-native, low-pitch Baymax voice)
 *
 * ECHO GUARD: MediaStream tracks are physically STOPPED (not muted) while
 * HERO speaks. Deepgram WebSocket is closed. Mic restarts after TTS ends
 * with a 600ms silence buffer to prevent any room echo being captured.
 */
import { useRef, useEffect, useCallback } from 'react';

export type HeroState = 'idle' | 'thinking' | 'speaking' | 'listening';

interface VoiceHookOptions {
  onStateChange: (s: HeroState) => void;
  onSubtitle:    (text: string) => void;
  onTranscript:  (text: string) => void;
  voiceEnabled:  boolean;
  loop:          boolean;
}

// ─── Wait for Chrome to load TTS voices ─────────────────────────────────────
function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  return new Promise(resolve => {
    const v = window.speechSynthesis.getVoices();
    if (v.length > 0) return resolve(v);
    const handler = () => {
      resolve(window.speechSynthesis.getVoices());
      window.speechSynthesis.removeEventListener('voiceschanged', handler);
    };
    window.speechSynthesis.addEventListener('voiceschanged', handler);
    setTimeout(() => resolve(window.speechSynthesis.getVoices()), 2000);
  });
}

// ─── Strip markdown so it isn't spoken aloud ────────────────────────────────
function cleanForSpeech(raw: string): string {
  return raw
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`\n]+`/g, '')
    .replace(/[*#_\[\]()\-\\]/g, '')
    .replace(/\n+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// ─── Deepgram Nova-2 real-time endpoint ─────────────────────────────────────
const DEEPGRAM_WS = (key: string) =>
  `wss://api.deepgram.com/v1/listen` +
  `?model=nova-2-conversationalai` +       // Best conversational model
  `&smart_format=true` +                   // Punctuation + number formatting
  `&interim_results=true` +               // Real-time word display
  `&endpointing=400` +                    // Detect speech end after 400ms silence
  `&utterance_end_ms=1000` +              // Fire UtteranceEnd after 1s quiet
  `&vad_events=true` +                    // Speech/NoSpeech events
  `&language=en-US`;

export function useVoice({ onStateChange, onSubtitle, onTranscript, voiceEnabled, loop }: VoiceHookOptions) {
  // ── All mutable state in refs to avoid stale closures ───────────────────
  const loopRef         = useRef(loop);
  const voiceRef        = useRef(voiceEnabled);
  const isSpeakingRef   = useRef(false);    // true while TTS active (echo guard)
  const isListeningRef  = useRef(false);    // true while mic+deepgram open
  const ttsQueueRef     = useRef<string[]>([]);
  const ttsActiveRef    = useRef(false);
  const shouldLoopNext  = useRef(false);
  const deepgramKeyRef  = useRef<string>('');

  // Active resources
  const wsRef           = useRef<WebSocket | null>(null);
  const mediaStreamRef  = useRef<MediaStream | null>(null);
  const recorderRef     = useRef<MediaRecorder | null>(null);
  const pingRef         = useRef<any>(null);
  const failsafeRef     = useRef<any>(null);

  useEffect(() => { loopRef.current = loop; }, [loop]);
  useEffect(() => { voiceRef.current = voiceEnabled; }, [voiceEnabled]);

  // Pre-fetch the Deepgram key once on mount
  useEffect(() => {
    fetch('/api/deepgram-key')
      .then(r => r.json())
      .then(d => { if (d.key) deepgramKeyRef.current = d.key; })
      .catch(() => {});
  }, []);

  // ─── HARD MIC KILL: close stream tracks + WebSocket ─────────────────────
  const killMic = useCallback(() => {
    try { recorderRef.current?.stop(); } catch (_) {}
    try { wsRef.current?.close(); } catch (_) {}
    mediaStreamRef.current?.getTracks().forEach(t => t.stop());
    recorderRef.current  = null;
    wsRef.current        = null;
    mediaStreamRef.current = null;
    isListeningRef.current = false;
  }, []);

  // ─── PUBLIC: Stop all audio ──────────────────────────────────────────────
  const stopAllAudio = useCallback(() => {
    if (pingRef.current)     { clearInterval(pingRef.current);  pingRef.current = null; }
    if (failsafeRef.current) { clearTimeout(failsafeRef.current); failsafeRef.current = null; }
    ttsQueueRef.current  = [];
    ttsActiveRef.current = false;
    isSpeakingRef.current = false;
    window.speechSynthesis?.cancel();
    onStateChange('idle');
  }, [onStateChange]);

  // Cleanup on unmount
  useEffect(() => () => { stopAllAudio(); killMic(); }, []);

  // ─── START LISTENING via Deepgram real-time WebSocket ───────────────────
  const startListening = useCallback(() => {
    if (isSpeakingRef.current || ttsActiveRef.current) return; // echo guard
    if (isListeningRef.current) return;

    const key = deepgramKeyRef.current;
    if (!key) {
      // Deepgram key missing — fall back to browser SpeechRecognition
      startBrowserSTT();
      return;
    }

    navigator.mediaDevices.getUserMedia({ audio: {
      echoCancellation: true,
      noiseSuppression: true,
      sampleRate: 16000,
    }, video: false })
      .then(stream => {
        if (isSpeakingRef.current) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }

        mediaStreamRef.current = stream;
        isListeningRef.current = true;
        onStateChange('listening');
        onSubtitle('Listening...');

        // Open Deepgram WebSocket
        const ws = new WebSocket(DEEPGRAM_WS(key), ['token', key]);
        wsRef.current = ws;

        let interimTranscript = '';
        let utteranceBuffer   = '';

        ws.onopen = () => {
          // Stream audio chunks to Deepgram every 250ms
          const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
            ? 'audio/webm;codecs=opus'
            : 'audio/webm';

          const recorder = new MediaRecorder(stream, { mimeType });
          recorderRef.current = recorder;

          recorder.ondataavailable = (e) => {
            if (ws.readyState === WebSocket.OPEN && e.data.size > 0) {
              ws.send(e.data);
            }
          };

          recorder.start(250); // 250ms chunks for low latency
        };

        ws.onmessage = (event) => {
          if (isSpeakingRef.current) return; // Echo guard — discard if HERO is speaking

          try {
            const msg = JSON.parse(event.data);
            const msgType = msg.type;

            if (msgType === 'Results') {
              const alt = msg.channel?.alternatives?.[0];
              const transcript = alt?.transcript || '';
              const isFinal = msg.speech_final === true;

              if (transcript) {
                interimTranscript = transcript;
                onSubtitle(transcript);
              }

              if (isFinal && transcript.trim()) {
                utteranceBuffer += ' ' + transcript;
              }

            } else if (msgType === 'UtteranceEnd') {
              // Deepgram detected end of speech utterance
              const final = utteranceBuffer.trim() || interimTranscript.trim();
              utteranceBuffer = '';
              interimTranscript = '';
              if (final && !isSpeakingRef.current) {
                killMic();
                onTranscript(final);
              }

            } else if (msgType === 'SpeechStarted') {
              onSubtitle('Listening...');
            }
          } catch (_) {}
        };

        ws.onclose = () => {
          if (isListeningRef.current) {
            isListeningRef.current = false;
            onStateChange('idle');
          }
        };

        ws.onerror = () => {
          killMic();
          onStateChange('idle');
          onSubtitle('Tap mic to speak to HERO');
        };
      })
      .catch(() => {
        isListeningRef.current = false;
        onStateChange('idle');
        onSubtitle('Microphone permission denied.');
      });
  }, [killMic, onStateChange, onSubtitle, onTranscript]);

  // ─── FALLBACK: Browser SpeechRecognition if no Deepgram key ─────────────
  const startBrowserSTT = useCallback(() => {
    const SpeechRec = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRec) {
      onSubtitle('Chrome or Edge required for voice.');
      return;
    }
    if (isSpeakingRef.current || isListeningRef.current) return;

    const rec = new SpeechRec();
    rec.continuous     = false;
    rec.interimResults = true;
    rec.lang           = 'en-US';

    let latest = '';

    rec.onstart = () => {
      isListeningRef.current = true;
      onStateChange('listening');
      onSubtitle('Listening...');
    };
    rec.onresult = (e: any) => {
      if (isSpeakingRef.current) return;
      latest = Array.from(e.results).map((r: any) => r[0].transcript).join('');
      onSubtitle(latest);
    };
    rec.onerror = () => { isListeningRef.current = false; onStateChange('idle'); onSubtitle('Tap mic to speak to HERO'); };
    rec.onend = () => {
      isListeningRef.current = false;
      onStateChange('idle');
      if (latest.trim() && !isSpeakingRef.current) {
        onTranscript(latest.trim());
      } else {
        onSubtitle('Tap mic to speak to HERO');
        if (loopRef.current && !isSpeakingRef.current) setTimeout(() => startListening(), 700);
      }
    };
    try { rec.start(); } catch (_) {}
  }, [onStateChange, onSubtitle, onTranscript, startListening]);

  // ─── TTS: SpeechSynthesis queue processor ───────────────────────────────
  const processTTSQueue = useCallback(async () => {
    if (!window.speechSynthesis) return;
    if (!voiceRef.current || ttsActiveRef.current || ttsQueueRef.current.length === 0) {
      // Queue drained — if conversation loop was pending, reopen mic
      if (!ttsActiveRef.current && ttsQueueRef.current.length === 0 && shouldLoopNext.current) {
        shouldLoopNext.current = false;
        setTimeout(() => {
          isSpeakingRef.current = false;
          if (loopRef.current) startListening();
        }, 600); // 600ms echo buffer
      }
      return;
    }

    ttsActiveRef.current  = true;
    isSpeakingRef.current = true;

    // ECHO GUARD: physically stop the microphone before speaking
    killMic();

    const rawText   = ttsQueueRef.current.shift()!;
    const cleanText = cleanForSpeech(rawText);

    if (!cleanText) {
      ttsActiveRef.current = false;
      processTTSQueue();
      return;
    }

    onSubtitle(cleanText);
    onStateChange('speaking');

    if (window.speechSynthesis.paused) window.speechSynthesis.resume();

    const utterance = new SpeechSynthesisUtterance(cleanText);
    const voices = await loadVoices();
    const voice = voices.find(v => v.lang.startsWith('en') && (v.name.includes('Google') || v.name.includes('Natural')))
               || voices.find(v => v.lang.startsWith('en'))
               || null;
    if (voice) utterance.voice = voice;
    utterance.rate   = 0.90;
    utterance.pitch  = 0.78;
    utterance.volume = 1.0;

    const done = () => {
      if (pingRef.current)     { clearInterval(pingRef.current);  pingRef.current = null; }
      if (failsafeRef.current) { clearTimeout(failsafeRef.current); failsafeRef.current = null; }
      ttsActiveRef.current = false;
      if (ttsQueueRef.current.length === 0) onStateChange('idle');
      processTTSQueue();
    };

    utterance.onend   = done;
    utterance.onerror = done;

    // Chrome TTS resume ping (prevents silent freezing after ~14s)
    pingRef.current = setInterval(() => {
      if (window.speechSynthesis.speaking) window.speechSynthesis.resume();
    }, 2500);

    // Failsafe: unstick if onend never fires
    const estimatedMs = Math.max(cleanText.length * 80 + 1500, 2500);
    failsafeRef.current = setTimeout(() => {
      window.speechSynthesis.cancel();
      done();
    }, estimatedMs);

    window.speechSynthesis.speak(utterance);
  }, [killMic, onStateChange, onSubtitle, startListening]);

  // ─── PUBLIC: Queue text for speech ──────────────────────────────────────
  const speak = useCallback((text: string) => {
    ttsQueueRef.current.push(text);
    processTTSQueue();
  }, [processTTSQueue]);

  // ─── PUBLIC: Toggle mic on/off ───────────────────────────────────────────
  const toggleMic = useCallback(() => {
    if (isListeningRef.current) {
      killMic();
      onStateChange('idle');
      onSubtitle('Tap mic to speak to HERO');
    } else {
      stopAllAudio();
      shouldLoopNext.current = loopRef.current;
      startListening();
    }
  }, [killMic, startListening, stopAllAudio, onStateChange, onSubtitle]);

  // ─── PUBLIC: Signal LLM stream finished (triggers mic re-open in loop) ──
  const setLoopPending = useCallback(() => {
    if (loopRef.current) shouldLoopNext.current = true;
  }, []);

  return { speak, stopAllAudio, toggleMic, setLoopPending };
}
