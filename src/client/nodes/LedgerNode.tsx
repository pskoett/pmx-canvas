import type { CanvasNodeState } from '../types';

export function LedgerNode({ node }: { node: CanvasNodeState }) {
  const data = node.data as Record<string, unknown>;

  // Render key-value pairs from ledger summary
  const entries = Object.entries(data).filter(([key]) => key !== 'title' && key !== '__type');

  if (entries.length === 0) {
    return (
      <div style={{ color: 'var(--c-dim)', fontSize: '12px', fontStyle: 'italic' }}>No ledger data</div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px' }}>
      {entries.map(([key, value]) => (
        <div
          key={key}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            padding: '3px 0',
            borderBottom: '1px solid rgba(45,55,90,0.3)',
          }}
        >
          <span style={{ color: 'var(--c-muted)', fontSize: '11px' }}>
            {key.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase())}
          </span>
          <span style={{ color: 'var(--c-text)', fontFamily: 'var(--mono)', fontSize: '11px' }}>
            {typeof value === 'object' ? JSON.stringify(value) : String(value ?? '—')}
          </span>
        </div>
      ))}
    </div>
  );
}
