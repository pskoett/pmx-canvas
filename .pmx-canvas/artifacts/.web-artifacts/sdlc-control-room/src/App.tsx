
import React from 'react';

const metrics = [
  { label: 'Deployments', value: '22', trend: '+3', color: '#2a9d8f' },
  { label: 'Lead Time', value: '19h', trend: '-5h', color: '#e9c46a' },
  { label: 'Gate Pass', value: '78%', trend: '+2%', color: '#e76f51' },
  { label: 'MTTR', value: '36m', trend: '-8m', color: '#a7c957' },
];

const stages = [
  { name: 'Build', status: 'pass', time: '3.2s' },
  { name: 'Lint', status: 'pass', time: '1.1s' },
  { name: 'Unit', status: 'pass', time: '12.4s' },
  { name: 'Integration', status: 'warn', time: '45.2s' },
  { name: 'Canary', status: 'pass', time: '2m 15s' },
  { name: 'Deploy', status: 'running', time: '...' },
];

const statusColors: Record<string, string> = {
  pass: '#2a9d8f',
  warn: '#e9c46a',
  fail: '#e76f51',
  running: '#4a9eff',
};

export default function App() {
  return (
    <div style={{ fontFamily: 'system-ui, -apple-system, sans-serif', background: '#0f0f1a', color: '#e0e0e0', padding: '24px', minHeight: '100vh' }}>
      <h2 style={{ margin: '0 0 20px', fontSize: '18px', color: '#fff' }}>SDLC Control Room</h2>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '24px' }}>
        {metrics.map(m => (
          <div key={m.label} style={{ background: '#1a1a2e', borderRadius: '8px', padding: '16px', borderLeft: '3px solid ' + m.color }}>
            <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>{m.label}</div>
            <div style={{ fontSize: '24px', fontWeight: 700 }}>{m.value}</div>
            <div style={{ fontSize: '11px', color: m.color }}>{m.trend}</div>
          </div>
        ))}
      </div>

      <h3 style={{ fontSize: '14px', color: '#888', marginBottom: '12px' }}>Pipeline Stages</h3>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        {stages.map((s, i) => (
          <div key={s.name} style={{ display: 'flex', alignItems: 'center', gap: '12px', background: '#1a1a2e', borderRadius: '6px', padding: '10px 16px', flex: '1 1 140px' }}>
            <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: statusColors[s.status] || '#555', boxShadow: s.status === 'running' ? '0 0 8px ' + statusColors.running : 'none' }} />
            <div>
              <div style={{ fontSize: '12px', fontWeight: 600 }}>{s.name}</div>
              <div style={{ fontSize: '10px', color: '#666' }}>{s.time}</div>
            </div>
            {i < stages.length - 1 && <span style={{ color: '#333', marginLeft: 'auto' }}>→</span>}
          </div>
        ))}
      </div>
    </div>
  );
}