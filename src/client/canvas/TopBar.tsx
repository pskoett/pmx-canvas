import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { IconFitAll, IconZoomIn, IconZoomOut } from '../icons';
import {
  animateViewport,
  connectionStatus,
  edges,
  fitAll,
  hasInitialServerLayout,
  nodes,
  sessionId,
  traceEnabled,
  viewport,
  zoomByFactor,
} from '../state/canvas-store';
import { MOD_KEY } from '../utils/platform';
import { canvasArea } from './canvas-area';
import { degradedState } from './ConnectionBanner';
import { ExternalWriterIndicator } from './ExternalWriters';
import { useNow } from './use-now';
import { agentPhaseLabel } from '../../shared/agent-presence.js';
import { activeSession, contextBudget } from '../state/presence-store';
import { pendingGates, startSession } from '../state/session-store';
import { formatCountdown, gateRemainingMs } from '../../shared/approval-gates.js';

function BarHint({
  label,
  shortcut,
  align = 'center',
  children,
}: {
  label: string;
  shortcut?: string;
  align?: 'start' | 'center' | 'end';
  children: ComponentChildren;
}) {
  return (
    <span class={`toolbar-tooltip-anchor toolbar-tooltip-anchor-${align}`}>
      {children}
      <span class="toolbar-tooltip" role="tooltip">
        <span class="toolbar-tooltip-label">{label}</span>
        {shortcut && (
          <span class="toolbar-tooltip-meta">
            <kbd class="toolbar-tooltip-shortcut">{shortcut}</kbd>
          </span>
        )}
      </span>
    </span>
  );
}

/**
 * The attached session's chip (rail-chrome-v2 phase 3): phase-colored, with a
 * dot that pulses while the agent thinks or runs a tool. Renders ONLY while a
 * session is attached — the quiet board shows nothing here until phase 5
 * lands the "Start agent session" affordance.
 */
function AgentChip() {
  const session = activeSession.value;
  if (!session) return null;
  const label = agentPhaseLabel(session);
  return (
    <span class={`agent-chip phase-${session.phase}`} title={`${label} · ${session.label}`} data-phase={session.phase}>
      <span class="agent-chip-dot" aria-hidden="true" />
      <span class="agent-chip-label">{label}</span>
      <span class="agent-chip-who hud-collapsible-text">{session.label}</span>
    </span>
  );
}

/**
 * Amber escalation badge while any approval gate is pending in an attached
 * session: "1 gate · 4:31" — the countdown is the soonest auto-hold.
 */
function GateBadge() {
  const count = pendingGates.value.length;
  const active = activeSession.value !== null && count > 0;
  const now = useNow(active ? 1000 : 0);
  if (!active) return null;
  const soonest = pendingGates.value
    .map((gate) => gateRemainingMs(gate, now))
    .filter((ms): ms is number => ms !== null)
    .sort((a, b) => a - b)[0];
  return (
    <span class="gate-badge" title="Approval gates waiting on you — resolve them in the session panel">
      {count} gate{count === 1 ? '' : 's'}
      {soonest !== undefined && ` · ${formatCountdown(soonest)}`}
    </span>
  );
}

function budgetTone(ratio: number): 'ok' | 'warn' | 'danger' {
  if (ratio > 0.9) return 'danger';
  if (ratio >= 0.7) return 'warn';
  return 'ok';
}

/**
 * Context-budget meter (rail-chrome-v2 phase 5): the share of the agent's
 * context window the pinned nodes take, from the presence snapshot — so it
 * moves within a frame of a pin toggling. Session-only, like the chip.
 */
function ContextBudget() {
  if (!activeSession.value) return null;
  const budget = contextBudget.value;
  const ratio = budget.total > 0 ? Math.min(1, budget.used / budget.total) : 0;
  const pct = Math.round(ratio * 100);
  return (
    <span
      class={`context-budget tone-${budgetTone(ratio)}`}
      title={`Share of the agent's context window used by pinned nodes — ${budget.used} of ${budget.total} tokens`}
    >
      <span class="context-budget-caption hud-collapsible-text">Context</span>
      <span class="context-budget-track" aria-hidden="true">
        <span class="context-budget-fill" style={{ width: `${pct}%` }} />
      </span>
      <span class="context-budget-label" data-testid="budget-label">
        {pct}%
      </span>
    </span>
  );
}

/**
 * Quiet-board affordance (rail-chrome-v2 phase 5): attach a human-started
 * session. The agent's subsequent MCP/HTTP writes are attributed to it, which
 * is what turns the quiet board into a Focus Session with a cursor and panel.
 */
function StartSessionButton() {
  const [busy, setBusy] = useState(false);
  if (activeSession.value) return null;
  return (
    <button
      type="button"
      class="start-session-btn"
      disabled={busy}
      title="Attach an agent session to this board"
      onClick={() => {
        setBusy(true);
        void startSession().finally(() => setBusy(false));
      }}
    >
      <span class="start-session-dot" aria-hidden="true" />
      Start agent session
    </button>
  );
}

/**
 * The slim 44px top bar (rail-chrome-v2 phase 1): connection state, board
 * identity on the left, view controls on the right. `overflow:hidden` +
 * `min-width:0` discipline throughout — the title ellipsizes, meta collapses
 * below 1180px, and nothing ever wraps to a second row.
 */
export function TopBar() {
  const status = connectionStatus.value;
  const hasSynced = hasInitialServerLayout.value;
  const v = viewport.value;
  const nodeCount = nodes.value.size;
  const edgeCount = edges.value.size;
  const isTraceOn = traceEnabled.value;
  const traceNodeCount = Array.from(nodes.value.values()).filter((n) => n.type === 'trace').length;

  // Board identity = workspace basename, fetched once from /health. The
  // canvas has no board-name concept — the workspace IS the board.
  const [workspaceName, setWorkspaceName] = useState<string>('');
  useEffect(() => {
    let cancelled = false;
    fetch('/health')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { workspace?: string } | null) => {
        if (cancelled || typeof data?.workspace !== 'string' || !data.workspace) return;
        const base = data.workspace
          .replace(/[\\/]+$/, '')
          .split(/[\\/]/)
          .pop();
        if (base) setWorkspaceName(base);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const degraded = degradedState.value;
  const statusTitle = degraded ?? (status === 'connected' && !hasSynced ? 'syncing' : status);
  const countsLabel = hasSynced
    ? [
        `${nodeCount} node${nodeCount !== 1 ? 's' : ''}`,
        ...(edgeCount > 0 ? [`${edgeCount} edge${edgeCount !== 1 ? 's' : ''}`] : []),
        ...(traceNodeCount > 0
          ? [`${traceNodeCount} trace${traceNodeCount !== 1 ? 's' : ''}`]
          : isTraceOn
            ? ['trace armed']
            : []),
      ].join(' · ')
    : 'Syncing canvas…';

  const handleFit = () => {
    const area = canvasArea();
    fitAll(area.width, area.height);
  };

  return (
    <div class="top-bar">
      <span
        class={`connection-dot ${degraded ?? status}`}
        title={`Canvas status: ${statusTitle}`}
        aria-label={`Canvas status: ${statusTitle}`}
      />
      <span class="top-bar-title" title={workspaceName || 'PMX Canvas'}>
        {workspaceName || 'PMX Canvas'}
      </span>
      <span class="top-bar-meta hud-collapsible-text">{sessionId.value ? sessionId.value.slice(0, 12) : '…'}</span>
      <span class="top-bar-meta hud-collapsible-text">{countsLabel}</span>

      <span class="top-bar-spacer" />

      <AgentChip />
      <GateBadge />
      <ContextBudget />
      <ExternalWriterIndicator />
      <StartSessionButton />

      <div class="top-bar-sep" />

      <BarHint label="Zoom out" shortcut={`${MOD_KEY}+-`}>
        <button type="button" class="top-bar-btn" onClick={() => zoomByFactor(1 / 1.25)} aria-label="Zoom out">
          <IconZoomOut />
        </button>
      </BarHint>
      <BarHint label="Reset zoom" shortcut={`${MOD_KEY}+0`}>
        <button
          type="button"
          class="top-bar-zoom-label"
          onClick={() => animateViewport({ x: 0, y: 0, scale: 1 }, 250)}
          aria-label="Reset view"
        >
          {Math.round(v.scale * 100)}%
        </button>
      </BarHint>
      <BarHint label="Zoom in" shortcut={`${MOD_KEY}++`}>
        <button type="button" class="top-bar-btn" onClick={() => zoomByFactor(1.25)} aria-label="Zoom in">
          <IconZoomIn />
        </button>
      </BarHint>
      <BarHint label="Fit all" shortcut="F" align="end">
        <button type="button" class="top-bar-btn" onClick={handleFit} aria-label="Fit canvas">
          <IconFitAll />
        </button>
      </BarHint>
    </div>
  );
}
