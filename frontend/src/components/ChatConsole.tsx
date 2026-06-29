import React, { useEffect, useRef, useState } from 'react';
import { HeroState } from './BaymaxFace';

interface Msg { role: 'user' | 'hero'; content: string; ts: number; }
interface Props { onStateChange: (s: HeroState) => void; heroColor: string; }

export default function ChatConsole({ onStateChange, heroColor }: Props) {
  const [messages, setMessages]   = useState<Msg[]>([
    { role: 'hero', content: "Hello. I am HERO — your personal AI assistant. I have full access to your PC. Ask me anything.", ts: Date.now() }
  ]);
  const [input, setInput]   = useState('');
  const [loading, setLoading] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [isListening, setIsListening] = useState(false);
  const bottomRef             = useRef<HTMLDivElement>(null);
  const sessionId             = useRef(`s-${Date.now()}`);
  
  // Audio Speech Synthesis Queue
  const speechQueue = useRef<string[]>([]);
  const isSpeaking = useRef(false);
  const recognitionRef = useRef<any>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  // Clean up speech and recognition on unmount
  useEffect(() => {
    return () => {
      window.speechSynthesis.cancel();
      if (recognitionRef.current) {
        recognitionRef.current.abort();
      }
    };
  }, []);

  // Speak queue processor (Low-pitched warm voice to sound like Baymax)
  const processSpeechQueue = () => {
    if (!voiceEnabled || isSpeaking.current || speechQueue.current.length === 0) return;
    isSpeaking.current = true;
    const text = speechQueue.current.shift()!;
    
    // Clean text of code snippets or markdown characters to make it sound cleaner
    const cleanText = text.replace(/`{3}[\s\S]*?`{3}/g, '[code block omitted]')
                          .replace(/`[^`\n]+`/g, '')
                          .replace(/[*#_\\-]/g, '');

    const utterance = new SpeechSynthesisUtterance(cleanText);
    
    // Warm custom robotic settings mimicking Baymax
    const voices = window.speechSynthesis.getVoices();
    const selectedVoice = voices.find(v => v.lang.startsWith('en') && (v.name.includes('Google') || v.name.includes('Natural'))) ||
                          voices.find(v => v.lang.startsWith('en')) || null;
    
    if (selectedVoice) utterance.voice = selectedVoice;
    utterance.rate = 0.94; // slightly slower
    utterance.pitch = 0.85; // lower pitch for friendly warm synthetic robot feel
    
    utterance.onend = () => {
      isSpeaking.current = false;
      processSpeechQueue();
    };
    utterance.onerror = () => {
      isSpeaking.current = false;
      processSpeechQueue();
    };

    window.speechSynthesis.speak(utterance);
  };

  const queueSpeech = (text: string) => {
    if (!voiceEnabled) return;
    speechQueue.current.push(text);
    processSpeechQueue();
  };

  const stopSpeech = () => {
    speechQueue.current = [];
    window.speechSynthesis.cancel();
    isSpeaking.current = false;
  };

  // Toggle voice recognition
  const toggleSpeechRecognition = () => {
    if (isListening) {
      if (recognitionRef.current) recognitionRef.current.stop();
      return;
    }

    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      alert('Speech recognition is not supported in this browser. Please use Chrome.');
      return;
    }

    const SpeechRep = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const recognition = new SpeechRep();
    recognitionRef.current = recognition;
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    setIsListening(true);
    onStateChange('listening');

    recognition.onresult = (event: any) => {
      const transcript = Array.from(event.results)
        .map((result: any) => result[0].transcript)
        .join('');
      setInput(transcript);
    };

    recognition.onend = () => {
      setIsListening(false);
      onStateChange('idle');
    };

    recognition.onerror = () => {
      setIsListening(false);
      onStateChange('idle');
    };

    recognition.start();
  };

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput('');
    stopSpeech();
    setMessages(prev => [...prev, { role: 'user', content: text, ts: Date.now() }]);
    setLoading(true);
    onStateChange('thinking');

    const heroTs = Date.now() + 1;
    setMessages(prev => [...prev, { role: 'hero', content: '', ts: heroTs }]);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, sessionId: sessionId.current }),
      });
      if (!res.body) throw new Error('No stream');
      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let sentenceBuffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() || '';
        
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const d = JSON.parse(line.slice(6));
            if (d.state === 'thinking') onStateChange('thinking');
            else if (d.state === 'speaking') onStateChange('speaking');
            else if (d.state === 'idle') onStateChange('idle');
            else if (d.content) {
              onStateChange('speaking');
              
              // Append text to chat bubble
              setMessages(prev => prev.map(m =>
                m.ts === heroTs ? { ...m, content: m.content + d.content } : m
              ));

              // Voice processing: split by sentences to speak fluidly during stream
              sentenceBuffer += d.content;
              const matches = sentenceBuffer.match(/[^.!?]+[.!?]+/g);
              if (matches) {
                matches.forEach(sentence => {
                  queueSpeech(sentence);
                });
                sentenceBuffer = sentenceBuffer.replace(/[^.!?]+[.!?]+/g, '');
              }
            }
          } catch {}
        }
      }

      // Speak remaining text in buffer
      if (sentenceBuffer.trim()) {
        queueSpeech(sentenceBuffer);
      }
    } catch (e: any) {
      setMessages(prev => prev.map(m =>
        m.ts === Date.now() + 1 ? { ...m, content: `Connection error: ${e.message}` } : m
      ));
    } finally {
      setLoading(false);
      onStateChange('idle');
    }
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Message feed */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {messages.map(m => (
          <div key={m.ts} style={{
            display: 'flex',
            flexDirection: m.role === 'user' ? 'row-reverse' : 'row',
            gap: 12, alignItems: 'flex-start',
            animation: 'fadeUp 0.25s ease both',
          }}>
            {/* Avatar dot */}
            <div style={{
              width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
              background: m.role === 'hero'
                ? `radial-gradient(circle at 35% 35%, ${heroColor}, ${heroColor}88)`
                : 'radial-gradient(circle at 35% 35%, #a78bfa, #6d28d9)',
              border: `1.5px solid ${m.role === 'hero' ? heroColor + '55' : '#a78bfa44'}`,
              boxShadow: `0 0 12px ${m.role === 'hero' ? heroColor + '44' : '#a78bfa33'}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 11, fontWeight: 700, color: '#fff', fontFamily: 'var(--mono)',
              transition: 'background 0.5s ease, border-color 0.5s ease',
            }}>
              {m.role === 'hero' ? 'H' : 'A'}
            </div>

            {/* Bubble */}
            <div style={{
              maxWidth: '74%',
              background: m.role === 'hero'
                ? `linear-gradient(135deg, rgba(0,0,0,0.4), rgba(255,255,255,0.03))`
                : 'rgba(167,139,250,0.08)',
              border: `1px solid ${m.role === 'hero' ? `${heroColor}20` : 'rgba(167,139,250,0.18)'}`,
              borderRadius: m.role === 'hero' ? '4px 18px 18px 18px' : '18px 4px 18px 18px',
              padding: '12px 16px',
              fontSize: 13.5, lineHeight: 1.65,
              color: 'var(--text)',
              whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              backdropFilter: 'blur(8px)',
              transition: 'border-color 0.5s ease',
            }}>
              {m.content ||
                <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                  {[0, 1, 2].map(i => (
                    <span key={i} style={{
                      width: 5, height: 5, borderRadius: '50%',
                      background: heroColor,
                      opacity: 0.6,
                      animation: `breathe 1.2s ease-in-out ${i * 0.2}s infinite`,
                      display: 'inline-block',
                    }} />
                  ))}
                </span>
              }
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input bar */}
      <div style={{
        padding: '16px 24px',
        borderTop: '1px solid var(--border)',
        display: 'flex', gap: 10, alignItems: 'flex-end',
        background: 'rgba(0,0,0,0.25)',
        backdropFilter: 'blur(10px)',
      }}>
        {/* Toggle Speech Output */}
        <button
          onClick={() => {
            const next = !voiceEnabled;
            setVoiceEnabled(next);
            if (!next) stopSpeech();
          }}
          title={voiceEnabled ? "Mute HERO's Voice" : "Unmute HERO's Voice"}
          style={{
            width: 46, height: 46, borderRadius: 12, cursor: 'pointer',
            background: 'var(--bg-card)', border: '1px solid var(--border)',
            color: voiceEnabled ? heroColor : 'var(--text-dim)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'all 0.2s',
          }}
        >
          {voiceEnabled ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/>
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
              <line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>
            </svg>
          )}
        </button>

        {/* Toggle Speech Input (Microphone) */}
        <button
          onClick={toggleSpeechRecognition}
          title={isListening ? "Stop Listening" : "Talk to HERO"}
          style={{
            width: 46, height: 46, borderRadius: 12, cursor: 'pointer',
            background: isListening ? 'rgba(251,191,36,0.15)' : 'var(--bg-card)',
            border: `1px solid ${isListening ? 'var(--c-listen)' : 'var(--border)'}`,
            color: isListening ? 'var(--c-listen)' : 'var(--text-dim)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'all 0.2s',
            animation: isListening ? 'breathe 1.5s infinite' : 'none',
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
            <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8"/>
          </svg>
        </button>

        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={onKey}
          disabled={loading}
          placeholder={isListening ? "Listening..." : "Ask HERO anything…  (Enter to send)"}
          rows={2}
          style={{
            flex: 1,
            background: 'var(--bg-card)',
            border: `1px solid var(--border)`,
            borderRadius: 12,
            padding: '11px 16px',
            color: 'var(--text)',
            fontFamily: 'var(--font)',
            fontSize: 13.5, resize: 'none', outline: 'none', lineHeight: 1.55,
            transition: 'border-color 0.25s',
          }}
          onFocus={e => { e.currentTarget.style.borderColor = heroColor; }}
          onBlur={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.07)'; }}
        />

        <button
          onClick={send}
          disabled={loading || !input.trim()}
          style={{
            width: 46, height: 46,
            borderRadius: 12, border: 'none', cursor: loading ? 'not-allowed' : 'pointer',
            background: loading ? 'rgba(255,255,255,0.04)' : heroColor,
            color: '#000', fontSize: 17, fontWeight: 700,
            boxShadow: loading ? 'none' : `0 0 18px ${heroColor}66`,
            transition: 'all 0.3s ease',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          {loading ? (
            <span style={{ width: 16, height: 16, border: `2px solid ${heroColor}55`, borderTopColor: heroColor, borderRadius: '50%', animation: 'spin 0.8s linear infinite', display: 'block' }} />
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}
