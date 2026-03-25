import type { CanvasNodeState } from '../types';

const CATEGORY_COLORS: Record<string, string> = {
  mcp: 'var(--c-accent)',
  file: 'var(--c-warn)',
  subagent: 'var(--c-purple)',
  other: 'var(--c-muted)',
};

const STATUS_ICONS: Record<string, string> = {
  running: '⠋',
  success: '✓',
  failed: '✕',
};

const STATUS_COLORS: Record<string, string> = {
  running: 'var(--c-accent)',
  success: 'var(--c-ok)',
  failed: 'var(--c-danger)',
};

export function TraceNode({ node }: { node: CanvasNodeState }) {
  const toolName = (node.data.toolName as string) || 'unknown';
  const category = (node.data.category as string) || 'other';
  const status = (node.data.status as string) || 'running';
  const duration = (node.data.duration as string) || '';
  const resultSummary = (node.data.resultSummary as string) || '';
  const error = (node.data.error as string) || '';

  const catColor = CATEGORY_COLORS[category] ?? CATEGORY_COLORS.other;
  const statusIcon = STATUS_ICONS[status] ?? '◌';
  const statusColor = STATUS_COLORS[status] ?? 'var(--c-muted)';
  const isRunning = status === 'running';

  // Truncate summary to ~30 chars
  const summary = error
    ? error.slice(0, 30)
    : resultSummary.length > 30
      ? `${resultSummary.slice(0, 28)}…`
      : resultSummary;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '0 12px',
        height: '100%',
        overflow: 'hidden',
      }}
    >
      {/* Status icon */}
      <span
        style={{
          fontSize: '14px',
          color: statusColor,
          flexShrink: 0,
          animation: isRunning ? 'pulse 1.5s infinite' : 'none',
        }}
      >
        {statusIcon}
      </span>

      {/* Tool name + summary */}
      <div
        style={{
          flex: 1,
          minWidth: 0,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            fontFamily: 'var(--mono)',
            fontSize: '11px',
            fontWeight: 600,
            color: catColor,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {toolName}
        </div>
        {summary && (
          <div
            style={{
              fontSize: '10px',
              color: error ? 'var(--c-danger)' : 'var(--c-muted)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              lineHeight: 1.3,
            }}
          >
            {summary}
          </div>
        )}
      </div>

      {/* Duration badge */}
      {duration && (
        <span
          style={{
            fontSize: '9px',
            padding: '1px 5px',
            borderRadius: '3px',
            background: 'rgba(255,255,255,0.06)',
            color: 'var(--c-muted)',
            flexShrink: 0,
            whiteSpace: 'nowrap',
          }}
        >
          {duration}
        </span>
      )}
    </div>
  );
}
