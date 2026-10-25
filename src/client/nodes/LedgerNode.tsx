import type { CanvasNodeState } from '../types';

// Layout/internal metadata that lives in node.data but is not ledger content.
const HIDDEN_LEDGER_KEYS = new Set(['title', '__type', 'content', 'strictSize', 'arrangeLocked']);

export function LedgerNode({ node }: { node: CanvasNodeState }) {
  const data = node.data as Record<string, unknown>;

  // Body text renders as a log: one line per entry. CLI flags frequently deliver
  // a literal "\n" (backslash-n, the shell does not expand it inside quotes)
  // rather than a real newline, so split on both — plus CR/CRLF — instead of
  // dropping the whole string on one wrapped line.
  const rawContent = typeof data.content === 'string' ? data.content : '';
  const lines = rawContent
    .split(/\r\n|\r|\n|\\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);

  // Any remaining non-internal keys render as structured key/value rows.
  const entries = Object.entries(data).filter(([key]) => !HIDDEN_LEDGER_KEYS.has(key));

  if (lines.length === 0 && entries.length === 0) {
    return <div style={{ color: 'var(--c-dim)', fontSize: '12px', fontStyle: 'italic' }}>No ledger data</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px' }}>
      {lines.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {lines.map((line, i) => {
            const timed = /^(\d{2}:\d{2}(?::\d{2})?)\s+(.+)$/.exec(line);
            return (
              <div
                key={i}
                style={{
                  display: 'grid',
                  gridTemplateColumns: timed ? '44px 1fr' : '1fr',
                  gap: '10px',
                  padding: '3px 0',
                  color: 'var(--c-text)',
                  fontFamily: 'var(--font-ui)',
                  fontSize: 'var(--fs-ui)',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {timed ? (
                  <>
                    <span style={{ fontFamily: 'var(--font-code)', fontSize: 'var(--fs-meta)', color: 'var(--c-dim)' }}>
                      {timed[1]}
                    </span>
                    <span>{timed[2]}</span>
                  </>
                ) : (
                  line
                )}
              </div>
            );
          })}
        </div>
      )}
      {entries.map(([key, value]) => (
        <div
          key={key}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: '8px',
            padding: '3px 0',
            borderBottom: '1px solid var(--c-line)',
          }}
        >
          <span style={{ color: 'var(--c-muted)', fontSize: '11px', flexShrink: 0 }}>
            {key.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase())}
          </span>
          <span
            style={{
              color: 'var(--c-text)',
              fontFamily: 'var(--font-code)',
              fontSize: '11px',
              textAlign: 'right',
              wordBreak: 'break-word',
            }}
          >
            {typeof value === 'object' ? JSON.stringify(value) : String(value ?? '—')}
          </span>
        </div>
      ))}
    </div>
  );
}
