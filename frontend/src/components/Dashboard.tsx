import React, { useEffect, useState } from 'react';

interface Metrics {
  cpuLoad: number;
  ram: { totalGB: number; freeGB: number; usedPercent: number };
  disk: { totalGB: number; freeGB: number; usedPercent: number };
  topProcesses: { name: string; cpu: number }[];
}

function RadialBar({ pct, color, label, sub }: { pct: number; color: string; label: string; sub: string }) {
  const r = 36; const circ = 2 * Math.PI * r;
  const offset = circ * (1 - Math.min(pct, 100) / 100);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, flex: 1 }}>
      <div style={{ position: 'relative', width: 90, height: 90 }}>
        <svg width={90} height={90} viewBox="0 0 90 90" style={{ transform: 'rotate(-90deg)' }}>
          <circle cx={45} cy={45} r={r} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth={6} />
          <circle cx={45} cy={45} r={r} fill="none" stroke={color} strokeWidth={6}
            strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={offset}
            style={{ transition: 'stroke-dashoffset 1s ease, stroke 0.5s ease',
              filter: `drop-shadow(0 0 6px ${color})` }} />
        </svg>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ fontSize: 17, fontWeight: 700, color, transition: 'color 0.5s',
            fontFamily: 'var(--mono)', lineHeight: 1 }}>{pct}%</span>
        </div>
      </div>
      <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', color: 'var(--text)' }}>{label}</span>
      <span style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--mono)' }}>{sub}</span>
    </div>
  );
}

export default function Dashboard({ heroColor }: { heroColor: string }) {
  const [metrics, setMetrics] = useState<Metrics | null>(null);

  useEffect(() => {
    const load = () => fetch('/api/metrics').then(r => r.json()).then(setMetrics).catch(() => {});
    load();
    const iv = setInterval(load, 4000);
    return () => clearInterval(iv);
  }, []);

  if (!metrics) return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: 'var(--text-dim)', fontSize: 13 }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: heroColor,
        display: 'inline-block', animation: 'breathe 1.2s infinite' }} />
      Connecting to local server…
    </div>
  );

  const cpuColor  = metrics.cpuLoad > 80 ? '#f87171' : metrics.cpuLoad > 50 ? '#fbbf24' : heroColor;
  const ramColor  = metrics.ram.usedPercent > 85 ? '#f87171' : '#a78bfa';
  const diskColor = metrics.disk.usedPercent > 90 ? '#f87171' : '#34d399';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Gauges */}
      <div style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 18, padding: '20px 24px',
        backdropFilter: 'blur(16px)',
      }}>
        <p style={{ fontSize: 10, letterSpacing: '0.18em', color: 'var(--text-dim)', marginBottom: 20,
          textTransform: 'uppercase', fontFamily: 'var(--mono)' }}>System Status</p>
        <div style={{ display: 'flex', justifyContent: 'space-around', gap: 16, flexWrap: 'wrap' }}>
          <RadialBar label="CPU" pct={Math.round(metrics.cpuLoad)} color={cpuColor} sub="Load" />
          <RadialBar label="RAM" pct={metrics.ram.usedPercent} color={ramColor}
            sub={`${(metrics.ram.totalGB - metrics.ram.freeGB).toFixed(1)} / ${metrics.ram.totalGB}GB`} />
          <RadialBar label="DISK" pct={metrics.disk.usedPercent} color={diskColor}
            sub={`${(metrics.disk.totalGB - metrics.disk.freeGB).toFixed(0)} / ${metrics.disk.totalGB}GB`} />
        </div>
      </div>

      {/* Processes */}
      {metrics.topProcesses.length > 0 && (
        <div style={{
          background: 'var(--bg-card)', border: '1px solid var(--border)',
          borderRadius: 18, padding: '16px 24px', backdropFilter: 'blur(16px)',
        }}>
          <p style={{ fontSize: 10, letterSpacing: '0.18em', color: 'var(--text-dim)', marginBottom: 14,
            textTransform: 'uppercase', fontFamily: 'var(--mono)' }}>Active Processes</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {metrics.topProcesses.slice(0, 5).map((p, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 12.5, fontFamily: 'var(--mono)', color: 'var(--text-mid)' }}>{p.name}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{
                    width: 60, height: 3, borderRadius: 2,
                    background: 'rgba(255,255,255,0.06)',
                    position: 'relative', overflow: 'hidden',
                  }}>
                    <div style={{
                      position: 'absolute', left: 0, top: 0, bottom: 0,
                      width: `${Math.min(p.cpu / 50 * 100, 100)}%`,
                      background: p.cpu > 20 ? '#fbbf24' : heroColor,
                      borderRadius: 2, transition: 'width 0.8s ease',
                    }} />
                  </div>
                  <span style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--text-dim)', width: 40 }}>
                    {p.cpu.toFixed(1)}s
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
