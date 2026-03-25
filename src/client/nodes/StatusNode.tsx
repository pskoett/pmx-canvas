import { PHASE_COLORS } from '../theme/tokens';
import type { CanvasNodeState } from '../types';

export function StatusNode({ node }: { node: CanvasNodeState }) {
  const phase = (node.data.phase as string) || 'idle';
  const detail = (node.data.detail as string) || '';
  const message = (node.data.message as string) || '';
  const level = (node.data.level as string) || 'ok';
  const activeTool = node.data.activeTool as string | null;
  const subagent = node.data.subagent as { state: string; name: string } | undefined;

  const phaseColor = PHASE_COLORS[phase] ?? 'var(--c-muted)';
  const isActive = phase !== 'idle';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '12px' }}>
      {/* Phase indicator */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <div
          style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            background: phaseColor,
            boxShadow: isActive ? `0 0 8px ${phaseColor}` : 'none',
            animation: isActive ? 'pulse 1.5s infinite' : 'none',
            flexShrink: 0,
          }}
        />
        <span
          style={{
            fontWeight: 600,
            color: phaseColor,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}
        >
          {phase}
        </span>
        {detail && (
          <span
            style={{
              color: 'var(--c-muted)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {detail}
          </span>
        )}
      </div>

      {/* Active tool */}
      {activeTool && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--c-warn)' }}>
          <span style={{ fontSize: '10px' }}>⚙</span>
          <span style={{ fontFamily: 'var(--mono)', fontSize: '11px' }}>{activeTool}</span>
        </div>
      )}

      {/* Sub-agent */}
      {subagent && subagent.state !== 'completed' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--c-subagent)' }}>
          <span style={{ fontSize: '10px' }}>⠉</span>
          <span>{subagent.name}</span>
          <span style={{ color: 'var(--c-muted)', fontSize: '10px' }}>({subagent.state})</span>
        </div>
      )}

      {/* Status message */}
      {message && (
        <div
          style={{
            color: level === 'warn' ? 'var(--c-warn)' : level === 'error' ? 'var(--c-danger)' : 'var(--c-muted)',
            lineHeight: 1.4,
          }}
        >
          {message}
        </div>
      )}
    </div>
  );
}
