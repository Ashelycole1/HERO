import React, { useCallback, useState, useRef, useEffect } from 'react';
import BaymaxFace, { HeroState } from './components/BaymaxFace';
import Dashboard from './components/Dashboard';
import { useVoice } from './hooks/useVoice';

interface Msg { role: 'user' | 'hero'; content: string; ts: number; }

const STATE_COLORS: Record<HeroState, string> = {
  idle:      '#00d4ff',
  thinking:  '#a78bfa',
  speaking:  '#34d399',
  listening: '#fbbf24',
};

export default function App() {
  const [state, setState]       = useState<HeroState>('idle');
  const [activeSpeech, setActiveSpeech] = useState('Tap mic to start talking to HERO');
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [loopMode, setLoopMode] = useState(false);
  
  // Drawer states
  const [systemOpen, setSystemOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);

  const [messages, setMessages] = useState<Msg[]>([
    { role: 'hero', content: "Hello. I am HERO — your personal AI assistant. I have full PC tools access. How can I help you today?", ts: Date.now() }
  ]);
  const [chatInput, setChatInput] = useState('');
  const [busy, setBusy] = useState(false);

  const sessionId   = useRef(`s-${Date.now()}`);
  const chatBottom  = useRef<HTMLDivElement>(null);
  const heroColor   = STATE_COLORS[state];

  const handleTranscript = useCallback((text: string) => send(text), []);

  const { speak, stopAllAudio, toggleMic, setLoopPending } = useVoice({
    onStateChange: setState,
    onSubtitle:    setActiveSpeech,
    onTranscript:  handleTranscript,
    voiceEnabled,
    loop: loopMode,
  });

  // Auto-scroll chat
  useEffect(() => {
    chatBottom.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const send = async (text: string) => {
    if (!text.trim() || busy) return;
    stopAllAudio();
    setBusy(true);
    setState('thinking');
    setActiveSpeech('Thinking...');
    setMessages(prev => [...prev, { role: 'user', content: text, ts: Date.now() }]);

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
      let sentenceBuf = '';
      let gotContent  = false;

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
            if (d.content) {
              gotContent = true;
              setState('speaking');
              setMessages(prev => prev.map(m =>
                m.ts === heroTs ? { ...m, content: m.content + d.content } : m
              ));

              // Accumulate into sentences and speak as they complete
              sentenceBuf += d.content;
              const matches = sentenceBuf.match(/[^.!?\n]+[.!?\n]+/g);
              if (matches) {
                matches.forEach(s => speak(s));
                sentenceBuf = sentenceBuf.replace(/[^.!?\n]+[.!?\n]+/g, '');
              }
            }
          } catch {}
        }
      }

      // Speak any remaining fragment
      if (sentenceBuf.trim()) speak(sentenceBuf.trim());

      // Signal the voice hook that streaming is done
      setLoopPending();

      if (!gotContent) {
        setState('idle');
        setActiveSpeech('Tap mic to speak to HERO');
      }
    } catch (e: any) {
      setMessages(prev => prev.map(m =>
        m.ts === heroTs ? { ...m, content: `Connection error: ${e.message}` } : m
      ));
      setState('idle');
      setActiveSpeech('Connection issue. Is the backend running?');
    } finally {
      setBusy(false);
    }
  };

  const handleTextSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || busy) return;
    const t = chatInput; setChatInput('');
    send(t);
  };

  // Unlock browser speech engine on first user gesture, then toggle mic
  const hasUnlockedRef = useRef(false);
  const handleMicClick = () => {
    if (!hasUnlockedRef.current) {
      hasUnlockedRef.current = true;
      // Speak a silent utterance to activate the speech engine context
      if (window.speechSynthesis) {
        const unlock = new SpeechSynthesisUtterance(' ');
        unlock.volume = 0;
        unlock.rate = 10; // as fast as possible so it ends immediately
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(unlock);
      }
      // Small delay to let unlock settle before real speech starts
      setTimeout(() => toggleMic(), 120);
    } else {
      toggleMic();
    }
  };

  // Floating background particles
  const particles = Array.from({ length: 25 }, (_, i) => (
    <div key={i} className="particle" style={{
      left: `${Math.random() * 100}%`,
      width: `${Math.random() * 3 + 2}px`,
      height: `${Math.random() * 3 + 2}px`,
      animationDelay: `${Math.random() * 10}s`,
      animationDuration: `${8 + Math.random() * 8}s`,
    }} />
  ));

  return (
    <div style={{ width: '100%', height: '100dvh', position: 'relative', overflow: 'hidden' }}>
      {/* Starry background */}
      <div className="space-bg">{particles}</div>

      {/* Main UI grid layer */}
      <div style={{
        position: 'relative', zIndex: 2,
        width: '100%', height: '100%',
        display: 'grid',
        gridTemplateRows: '56px 1fr',
        overflow: 'hidden',
      }}>

        {/* ── HEADER ─────────────────────────────────── */}
        <header style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 24px',
          borderBottom: '1px solid rgba(255,255,255,0.05)',
          background: 'rgba(3, 7, 18, 0.4)',
          backdropFilter: 'blur(20px)',
          zIndex: 10,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <div style={{
              width: 7, height: 7, borderRadius: '50%',
              background: heroColor, boxShadow: `0 0 12px ${heroColor}`,
              transition: 'background .5s, box-shadow .5s',
            }} />
            <span style={{ fontFamily: 'var(--mono)', fontSize: 13, letterSpacing: '.22em', fontWeight: 700, color: heroColor, transition: 'color .5s' }}>
              HERO
            </span>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '.18em', color: 'var(--text-dim)', textTransform: 'uppercase' }}>
              Personal AI
            </span>
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <HeaderBtn
              active={voiceEnabled}
              color={heroColor}
              onClick={() => { const n = !voiceEnabled; setVoiceEnabled(n); if (!n) stopAllAudio(); }}
            >
              {voiceEnabled ? '🔊 Sound On' : '🔇 Muted'}
            </HeaderBtn>

            <HeaderBtn
              active={loopMode}
              color={heroColor}
              onClick={() => setLoopMode(p => !p)}
            >
              {loopMode ? '⬤ Conversation Mode' : '○ Manual Click'}
            </HeaderBtn>
          </div>
        </header>

        {/* ── MAIN IMMERSIVE VIEW ───────────────────── */}
        <div style={{
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          overflow: 'hidden',
        }}>

          {/* TELEMETRY RINGS */}
          {[380, 320, 260].map((size, i) => (
            <div key={size} style={{
              position: 'absolute',
              width: size, height: size, borderRadius: '50%',
              border: `1px ${i % 2 === 0 ? 'dashed' : 'dotted'} ${heroColor}${i === 0 ? '0d' : i === 1 ? '14' : '22'}`,
              animation: `spin ${26 - i * 6}s linear infinite ${i % 2 ? 'reverse' : ''}`,
              pointerEvents: 'none', transition: 'border-color .5s',
            }} />
          ))}

          {/* 3D BAYMAX BASESTAGE */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18, zIndex: 3 }}>
            <BaymaxFace state={state} size={250} />

            {/* Glowing audio visualizer bars */}
            <div style={{ display: 'flex', gap: 3.5, height: 28, alignItems: 'center', opacity: (state === 'listening' || state === 'speaking') ? 1 : 0.18, transition: 'opacity .5s' }}>
              {Array.from({ length: 16 }, (_, i) => (
                <div key={i} style={{
                  width: 3, borderRadius: 2,
                  background: heroColor,
                  height: (state === 'listening' || state === 'speaking') ? `${8 + Math.random() * 20}px` : '3px',
                  animation: (state === 'listening' || state === 'speaking') ? `breathe ${0.4 + (i % 4) * 0.1}s ease-in-out ${i * 0.04}s infinite alternate` : 'none',
                  transition: 'height .3s ease, background .5s',
                  boxShadow: `0 0 6px ${heroColor}`,
                }} />
              ))}
            </div>

            {/* Transcription Subtitle Overlay */}
            <div className="glass-panel" style={{
              padding: '14px 28px', width: '90vw', maxWidth: 500, textAlign: 'center',
              border: `1px solid ${heroColor}22`, transition: 'border-color .5s',
              background: 'rgba(10, 15, 30, 0.75)',
            }}>
              <p style={{
                fontSize: 13.5, lineHeight: 1.6,
                color: state === 'listening' ? 'var(--c-listen)' : 'var(--text)',
                fontFamily: state === 'thinking' ? 'var(--mono)' : 'var(--font)',
                transition: 'color .5s',
                letterSpacing: '0.01em',
              }}>
                {activeSpeech}
              </p>
            </div>

            {/* Central Holographic Mic button */}
            <button
              onClick={handleMicClick}
              title={state === 'listening' ? 'Stop Listening' : 'Talk to HERO'}
              style={{
                width: 66, height: 66, borderRadius: '50%',
                border: `2px solid ${state === 'listening' ? 'var(--c-listen)' : heroColor}`,
                background: state === 'listening' ? 'rgba(251,191,36,.12)' : 'rgba(3,7,18,.75)',
                boxShadow: `0 0 24px ${state === 'listening' ? 'rgba(251,191,36,.35)' : heroColor + '3d'}, inset 0 0 10px ${state === 'listening' ? 'rgba(251,191,36,.15)' : heroColor + '14'}`,
                color: state === 'listening' ? 'var(--c-listen)' : heroColor,
                cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'all .4s ease',
                outline: 'none',
              }}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8"/>
              </svg>
            </button>
          </div>

          {/* FLOATING CORNER CONTROLS */}
          {/* Bottom Left: Metrics drawer trigger */}
          <button
            onClick={() => setSystemOpen(o => !o)}
            className="glass-panel"
            style={{
              position: 'absolute', bottom: 24, left: 24, zIndex: 10,
              padding: '10px 18px', borderRadius: 20, cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 8,
              border: `1px solid ${systemOpen ? heroColor : 'rgba(255,255,255,0.08)'}`,
              color: systemOpen ? heroColor : 'var(--text-mid)',
              fontSize: 12, fontWeight: 600, fontFamily: 'var(--mono)',
              boxShadow: systemOpen ? `0 0 16px ${heroColor}28` : 'none',
              transition: 'all .3s ease',
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <rect x="3" y="3" width="7" height="9"/>
              <rect x="14" y="3" width="7" height="5"/>
              <rect x="14" y="12" width="7" height="9"/>
              <rect x="3" y="16" width="7" height="5"/>
            </svg>
            System Info
          </button>

          {/* Bottom Right: Chat history drawer trigger */}
          <button
            onClick={() => setChatOpen(o => !o)}
            className="glass-panel"
            style={{
              position: 'absolute', bottom: 24, right: 24, zIndex: 10,
              padding: '10px 18px', borderRadius: 20, cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 8,
              border: `1px solid ${chatOpen ? heroColor : 'rgba(255,255,255,0.08)'}`,
              color: chatOpen ? heroColor : 'var(--text-mid)',
              fontSize: 12, fontWeight: 600, fontFamily: 'var(--mono)',
              boxShadow: chatOpen ? `0 0 16px ${heroColor}28` : 'none',
              transition: 'all .3s ease',
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
            Console Logs
          </button>
        </div>
      </div>

      {/* ── LEFT DRAWER: SYSTEM METRICS ─────────────── */}
      <div style={{
        position: 'absolute', top: 0, left: 0, bottom: 0, zIndex: 100,
        width: 320, background: 'rgba(3, 7, 18, 0.93)',
        borderRight: '1px solid rgba(255,255,255,0.07)',
        backdropFilter: 'blur(24px)',
        transform: systemOpen ? 'translateX(0)' : 'translateX(-100%)',
        transition: 'transform 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
        padding: '24px 20px', display: 'flex', flexDirection: 'column',
        boxShadow: systemOpen ? '0 0 40px rgba(0,0,0,0.6)' : 'none',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 11, letterSpacing: '.18em', color: heroColor, fontWeight: 700, textTransform: 'uppercase' }}>
            System Diagnostics
          </span>
          <button onClick={() => setSystemOpen(false)} style={{ border: 'none', background: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: 16 }}>×</button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          <Dashboard heroColor={heroColor} />
        </div>
      </div>

      {/* ── RIGHT DRAWER: CHAT LOGS & MANUAL INPUT ───── */}
      <div style={{
        position: 'absolute', top: 0, right: 0, bottom: 0, zIndex: 100,
        width: 380, background: 'rgba(3, 7, 18, 0.93)',
        borderLeft: '1px solid rgba(255,255,255,0.07)',
        backdropFilter: 'blur(24px)',
        transform: chatOpen ? 'translateX(0)' : 'translateX(100%)',
        transition: 'transform 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
        padding: '24px 20px', display: 'flex', flexDirection: 'column',
        boxShadow: chatOpen ? '0 0 40px rgba(0,0,0,0.6)' : 'none',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 11, letterSpacing: '.18em', color: heroColor, fontWeight: 700, textTransform: 'uppercase' }}>
            Console Feed
          </span>
          <button onClick={() => setChatOpen(false)} style={{ border: 'none', background: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: 16 }}>×</button>
        </div>

        {/* Message feed */}
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12, paddingRight: 4, marginBottom: 14 }}>
          {messages.map(m => (
            <div key={m.ts} style={{ display: 'flex', flexDirection: m.role === 'user' ? 'row-reverse' : 'row', gap: 8, alignItems: 'flex-start' }}>
              <div style={{
                width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
                background: m.role === 'hero' ? `radial-gradient(circle, ${heroColor}, ${heroColor}cc)` : '#7c3aed',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 8, fontWeight: 700, color: '#fff', fontFamily: 'var(--mono)',
              }}>
                {m.role === 'hero' ? 'H' : 'U'}
              </div>
              <div style={{
                maxWidth: '82%',
                background: m.role === 'hero' ? 'rgba(255,255,255,0.03)' : 'rgba(167,139,250,0.08)',
                border: '1px solid rgba(255,255,255,0.06)',
                borderRadius: m.role === 'hero' ? '4px 12px 12px 12px' : '12px 4px 12px 12px',
                padding: '8px 12px', fontSize: 12, lineHeight: 1.55,
                color: 'var(--text)', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              }}>
                {m.content || <span style={{ color: 'var(--text-dim)', fontStyle: 'italic' }}>...</span>}
              </div>
            </div>
          ))}
          <div ref={chatBottom} />
        </div>

        {/* Manual text input */}
        <form onSubmit={handleTextSend} style={{ display: 'flex', gap: 8, borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: 12 }}>
          <input
            type="text"
            value={chatInput}
            onChange={e => setChatInput(e.target.value)}
            disabled={busy}
            placeholder="Type your message..."
            style={{
              flex: 1, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 10, padding: '10px 14px', color: 'var(--text)', fontSize: 13, outline: 'none',
            }}
          />
          <button type="submit" disabled={busy || !chatInput.trim()} style={{
            padding: '0 18px', borderRadius: 10, border: 'none',
            background: heroColor, color: '#000', fontSize: 12, fontWeight: 700, cursor: 'pointer',
            transition: 'background .5s, opacity .3s', opacity: (busy || !chatInput.trim()) ? .4 : 1,
          }}>
            Send
          </button>
        </form>
      </div>
    </div>
  );
}

function HeaderBtn({ children, active, color, onClick }: {
  children: React.ReactNode; active: boolean; color: string; onClick: () => void;
}) {
  return (
    <button onClick={onClick} className="glass-panel" style={{
      padding: '6px 14px', borderRadius: 10, cursor: 'pointer',
      border: `1px solid ${active ? color : 'rgba(255,255,255,0.06)'}`,
      color: active ? color : 'var(--text-dim)',
      fontSize: 10.5, fontWeight: 600, fontFamily: 'var(--mono)',
      letterSpacing: '.08em', textTransform: 'uppercase', background: 'rgba(0,0,0,.35)',
      transition: 'all .3s ease',
    }}>
      {children}
    </button>
  );
}
