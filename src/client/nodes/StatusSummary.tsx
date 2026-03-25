import { PHASE_COLORS } from '../theme/tokens';
import type { CanvasNodeState } from '../types';

export function StatusSummary({ node }: { node: CanvasNodeState }) {
  const phase = (node.data.phase as string) || 'idle';
  const activeTool = node.data.activeTool as string | null;
  const subagent = node.data.subagent as { state: string; name: string } | undefined;
  const phaseColor = PHASE_COLORS[phase] ?? 'var(--c-muted)';
  const isActive = phase !== 'idle';

  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: '6px', flex: 1, minWidth: 0 }}>
      <span
        style={{
          width: '6px',
          height: '6px',
          borderRadius: '50%',
          background: phaseColor,
          animation: isActive ? 'pulse 1.5s infinite' : 'none',
          flexShrink: 0,
        }}
      />
      <span
        style={{ color: phaseColor, fontSize: '10px', textTransform: 'uppercase', fontWeight: 600 }}
      >
        {phase}
      </span>
      {activeTool && (
        <span style={{ color: 'var(--c-warn)', fontSize: '10px', fontFamily: 'var(--mono)' }}>
          ⚙ {activeTool}
        </span>
      )}
      {subagent && subagent.state !== 'completed' && (
        <span style={{ color: 'var(--c-subagent)', fontSize: '10px' }}>⠉ {subagent.name}</span>
      )}
    </span>
  );
}
