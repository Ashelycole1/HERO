import React, { useEffect, useState } from 'react';

export type HeroState = 'idle' | 'thinking' | 'speaking' | 'listening';

interface Props { state: HeroState; size?: number }

const STATE_COLORS: Record<HeroState, { primary: string; glow: string; label: string }> = {
  idle:      { primary: '#00d4ff', glow: 'rgba(0, 212, 255, 0.45)',  label: 'HERO  •  ONLINE'   },
  thinking:  { primary: '#a78bfa', glow: 'rgba(167, 139, 250, 0.45)',  label: 'PROCESSING'       },
  speaking:  { primary: '#34d399', glow: 'rgba(52, 211, 153, 0.45)',   label: 'SPEAKING'          },
  listening: { primary: '#fbbf24', glow: 'rgba(251, 191, 36, 0.45)',   label: 'LISTENING'         },
};

export default function BaymaxFace({ state, size = 260 }: Props) {
  const { primary, glow, label } = STATE_COLORS[state];

  // Eye wander when thinking
  const [eyeX, setEyeX] = useState(0);
  useEffect(() => {
    if (state !== 'thinking') { setEyeX(0); return; }
    let t = 0;
    const iv = setInterval(() => { t += 0.08; setEyeX(Math.sin(t) * 5); }, 50);
    return () => clearInterval(iv);
  }, [state]);

  // Speaking mouth bounce
  const [bounceScale, setBounceScale] = useState(1);
  useEffect(() => {
    if (state !== 'speaking') { setBounceScale(1); return; }
    const iv = setInterval(() => setBounceScale(0.92 + Math.random() * 0.16), 100);
    return () => clearInterval(iv);
  }, [state]);

  const floatAnim = state === 'idle' ? 'hover 4.5s ease-in-out infinite' : 'none';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20, position: 'relative' }}>
      {/* Projection Platform Ring under his feet */}
      <div style={{
        position: 'absolute',
        bottom: 25,
        width: size * 0.8,
        height: 25,
        borderRadius: '50%',
        background: `radial-gradient(ellipse at 50% 50%, ${primary}1a, transparent 70%)`,
        border: `1px solid ${primary}44`,
        boxShadow: `0 0 25px ${primary}33`,
        transform: 'rotateX(75deg)',
        zIndex: 0,
        transition: 'border-color 0.5s ease, box-shadow 0.5s ease',
      }}>
        {/* Hologram grid line spinner */}
        <div style={{
          position: 'absolute', inset: -4,
          borderRadius: '50%',
          border: `1px dashed ${primary}22`,
          animation: 'spin 12s linear infinite',
        }} />
      </div>

      {/* Main Holographic Baymax body */}
      <div
        style={{
          position: 'relative',
          width: size,
          height: size * 1.25,
          animation: floatAnim,
          filter: `drop-shadow(0 0 22px ${glow})`,
          transition: 'filter 0.5s ease',
          zIndex: 1,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        <svg width="100%" height="100%" viewBox="0 0 220 280">
          <defs>
            {/* 3D gradients for rounded volume look */}
            <radialGradient id="body3D" cx="35%" cy="30%" r="70%">
              <stop offset="0%" stopColor="#ffffff" />
              <stop offset="70%" stopColor="#e2e8f0" />
              <stop offset="100%" stopColor="#cbd5e1" />
            </radialGradient>
            
            <radialGradient id="head3D" cx="40%" cy="30%" r="70%">
              <stop offset="0%" stopColor="#ffffff" />
              <stop offset="75%" stopColor="#e2e8f0" />
              <stop offset="100%" stopColor="#cbd5e1" />
            </radialGradient>

            <linearGradient id="limb3D" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#ffffff" />
              <stop offset="60%" stopColor="#e2e8f0" />
              <stop offset="100%" stopColor="#94a3b8" />
            </linearGradient>

            <linearGradient id="leg3D" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#ffffff" />
              <stop offset="60%" stopColor="#e2e8f0" />
              <stop offset="100%" stopColor="#475569" />
            </linearGradient>
          </defs>

          <g>
            {/* Left Arm */}
            <ellipse cx="45" cy="140" rx="18" ry="46" fill="url(#limb3D)" stroke="#cbd5e1" strokeWidth="1.5" transform="rotate(-12 45 140)" />
            
            {/* Right Arm */}
            <ellipse cx="175" cy="140" rx="18" ry="46" fill="url(#limb3D)" stroke="#cbd5e1" strokeWidth="1.5" transform="rotate(12 175 140)" />
            
            {/* Left Leg */}
            <ellipse cx="86" cy="230" rx="20" ry="38" fill="url(#leg3D)" stroke="#cbd5e1" strokeWidth="1.5" />
            
            {/* Right Leg */}
            <ellipse cx="134" cy="230" rx="20" ry="38" fill="url(#leg3D)" stroke="#cbd5e1" strokeWidth="1.5" />

            {/* Big Puffy 3D Body */}
            <ellipse cx="110" cy="150" rx="58" ry="72" fill="url(#body3D)" stroke="#cbd5e1" strokeWidth="1.5" />
            
            {/* Access Port Badge on Chest */}
            <circle cx="132" cy="106" r="6" fill="none" stroke={primary} strokeWidth="1.5" style={{ transition: 'stroke 0.5s ease' }} />
            <line x1="132" y1="102" x2="132" y2="110" stroke={primary} strokeWidth="1.5" style={{ transition: 'stroke 0.5s ease' }} />
            
            {/* Neck link */}
            <ellipse cx="110" cy="80" rx="20" ry="8" fill="#94a3b8" />

            {/* 3D Squished Oval Head */}
            <ellipse cx="110" cy="72" rx="34" ry="20" fill="url(#head3D)" stroke="#cbd5e1" strokeWidth="1.5" />
            
            {/* Eyes & Connective Line */}
            <circle cx="96" cy="72" r="4.2" fill="#0f172a" style={{ transform: `translateX(${eyeX}px)`, transition: 'transform 0.05s ease' }} />
            <circle cx="124" cy="72" r="4.2" fill="#0f172a" style={{ transform: `translateX(${eyeX}px)`, transition: 'transform 0.05s ease' }} />
            <line
              x1="96" y1="72"
              x2="124" y2="72"
              stroke="#0f172a"
              strokeWidth="1.8"
              style={{
                transform: `translateX(${eyeX}px) scaleY(${state === 'speaking' ? bounceScale : 1})`,
                transformOrigin: '110px 72px',
                transition: 'transform 0.05s ease',
              }}
            />
          </g>
        </svg>
      </div>

      {/* Hologram Projector Light Beams */}
      <div style={{
        position: 'absolute',
        bottom: 24,
        width: size * 0.7,
        height: size * 1.1,
        background: `linear-gradient(to top, ${primary}1e 0%, transparent 80%)`,
        clipPath: 'polygon(15% 100%, 85% 100%, 50% 0%)',
        pointerEvents: 'none',
        zIndex: 0,
        transition: 'background 0.5s ease',
      }} />

      {/* State label */}
      <span style={{
        fontFamily: 'var(--mono)',
        fontSize: 10,
        letterSpacing: '0.24em',
        color: primary,
        textShadow: `0 0 10px ${glow}`,
        transition: 'color 0.5s ease, text-shadow 0.5s ease',
        zIndex: 2,
      }}>
        {label}
      </span>
    </div>
  );
}
