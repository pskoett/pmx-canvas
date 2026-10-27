import { PHASE_COLORS } from '../theme/tokens';
import type { CanvasNodeState } from '../types';
import { isWorkCardState } from '../../shared/ax-kinds.js';
import { WorkCard } from './WorkCard';

export function getStatusDisplayPhase(node: CanvasNodeState): string {
  const phase = typeof node.data.phase === 'string' && node.data.phase.trim().length > 0 ? node.data.phase.trim() : '';
  if (phase) return phase;
  const content =
    typeof node.data.content === 'string' && node.data.content.trim().length > 0 ? node.data.content.trim() : '';
  if (content) return content;
  const status =
    typeof node.data.status === 'string' && node.data.status.trim().length > 0 ? node.data.status.trim() : '';
  return status || 'idle';
}

export function StatusNode({ node }: { node: CanvasNodeState }) {
  if (typeof node.data.workItemId === 'string' && node.data.liveWorkAvailable === false) {
    return (
      <div class="work-card">
        <div class="work-card-error">⚠ Task unavailable</div>
        <div>The linked task is no longer on this board.</div>
        <div class="work-card-live">Read-only · removing this card does not cancel work.</div>
      </div>
    );
  }
  if (isWorkCardState(node.data.workState)) return <WorkCard node={node} state={node.data.workState} />;
  const phase = getStatusDisplayPhase(node);
  const detail = (node.data.detail as string) || '';
  const message = (node.data.message as string) || '';
  const level = (node.data.level as string) || 'ok';
  const activeTool = node.data.activeTool as string | null;
  const subagent = node.data.subagent as { state: string; name: string } | undefined;
  const progress = typeof node.data.progress === 'number' ? Math.max(0, Math.min(100, node.data.progress)) : null;

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
            animation: isActive ? 'pulse 1.5s infinite' : 'none',
            flexShrink: 0,
          }}
        />
        <span
          style={{
            fontWeight: 600,
            color: phaseColor,
            fontSize: 'var(--fs-meta)',
            padding: '2px 8px',
            borderRadius: 'var(--r-pill)',
            background: `color-mix(in srgb, ${phaseColor} 12%, transparent)`,
          }}
        >
          {phase.charAt(0).toUpperCase() + phase.slice(1)}
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

      {progress !== null && (
        <div
          class="status-progress"
          role="progressbar"
          aria-label="Progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
        >
          <div style={{ width: `${progress}%`, background: phaseColor }} />
        </div>
      )}

      {/* Active tool */}
      {activeTool && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--c-agent)' }}>
          <span style={{ fontSize: 'var(--fs-meta)' }}>⚙</span>
          <span style={{ fontFamily: 'var(--font-code)', fontSize: '11px' }}>{activeTool}</span>
        </div>
      )}

      {/* Sub-agent */}
      {subagent && subagent.state !== 'completed' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--c-subagent)' }}>
          <span style={{ fontSize: 'var(--fs-meta)' }}>⠉</span>
          <span>{subagent.name}</span>
          <span style={{ color: 'var(--c-muted)', fontSize: 'var(--fs-meta)' }}>({subagent.state})</span>
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
