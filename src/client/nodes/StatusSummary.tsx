import { PHASE_COLORS } from '../theme/tokens';
import type { CanvasNodeState } from '../types';
import { getStatusDisplayPhase } from './StatusNode';
import { isWorkCardState, WORK_CARD_STATES } from '../../shared/ax-kinds.js';

export function StatusSummary({ node }: { node: CanvasNodeState }) {
  if (typeof node.data.workItemId === 'string' && node.data.liveWorkAvailable === false)
    return <span class="work-card-error">⚠ Task unavailable</span>;
  if (isWorkCardState(node.data.workState)) {
    const state = WORK_CARD_STATES[node.data.workState];
    return (
      <span class={`work-card-state work-card-${node.data.workState}`}>
        <span aria-hidden="true">{state.glyph}</span> {state.label}
      </span>
    );
  }
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
