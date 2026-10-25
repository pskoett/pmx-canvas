import { PHASE_COLORS } from '../theme/tokens';
import type { CanvasNodeState } from '../types';
import { getStatusDisplayPhase } from './StatusNode';

export function StatusSummary({ node }: { node: CanvasNodeState }) {
  const phase = getStatusDisplayPhase(node);
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
      <span style={{ color: phaseColor, fontSize: 'var(--fs-meta)', fontWeight: 600 }}>
        {phase.charAt(0).toUpperCase() + phase.slice(1)}
      </span>
      {activeTool && (
        <span style={{ color: 'var(--c-agent)', fontSize: 'var(--fs-meta)', fontFamily: 'var(--font-code)' }}>
          ⚙ {activeTool}
        </span>
      )}
      {subagent && subagent.state !== 'completed' && (
        <span style={{ color: 'var(--c-subagent)', fontSize: 'var(--fs-meta)' }}>⠉ {subagent.name}</span>
      )}
    </span>
  );
}
