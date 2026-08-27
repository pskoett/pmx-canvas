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
import { modChord } from '../utils/platform';
import { canvasArea } from './canvas-area';
import { BarHint } from './BarHint';
import { degradedState } from './ConnectionBanner';
import { ExternalWriterIndicator } from './ExternalWriters';
import { useNow } from './use-now';
import { agentPhaseLabel } from '../../shared/agent-presence.js';
import { agentIdentityHue } from '../../shared/agent-presence.js';
import { activeSession, agentPresences, attachedSessions, contextBudget } from '../state/presence-store';
import { pendingGates, startSession } from '../state/session-store';
import { formatCountdown, gateRemainingMs } from '../../shared/approval-gates.js';

/**
 * The attached session's chip (rail-chrome-v2 phase 3): phase-colored, with a
 * dot that pulses while the agent thinks or runs a tool. Renders ONLY while a
 * session is attached — the quiet board shows nothing here until phase 5
 * lands the "Start agent session" affordance.
 */
function AgentChip() {
  // Every attached session gets its chip — with several agents on the board,
  // showing only the first hid the rest from the top bar entirely.
  const sessions = attachedSessions.value;
  if (sessions.length === 0) return null;
  return (
    <>
      {sessions.map((session) => {
        // Fleet roll-up: workers declaring this session as their parent count
        // into its chip instead of growing the bar one chip per worker.
        const workers = agentPresences.value.filter(
          (presence) =>
            presence.parentAgentId != null &&
            (presence.parentAgentId === session.sessionId || presence.parentAgentId === session.source),
        ).length;
        return (
          <BarHint
            key={session.sessionId}
            label={`Agent session — ${session.label}`}
            tapToOpen
            body="What this attached agent is doing right now: idle, thinking, running a tool, or waiting on your approval. Steer it from the composer below."
          >
            <span
              class={`agent-chip phase-${session.phase}`}
              data-phase={session.phase}
              style={{ '--identity-color': `hsl(${agentIdentityHue(session.sessionId)} 65% 62%)` }}
            >
              <span class="agent-chip-dot" aria-hidden="true" />
              <span class="agent-chip-label">{agentPhaseLabel(session)}</span>
              <span class="agent-chip-who hud-collapsible-text">{session.label}</span>
              {workers > 0 && (
                <span class="agent-chip-workers">
                  +{workers} worker{workers === 1 ? '' : 's'}
                </span>
              )}
            </span>
          </BarHint>
        );
      })}
    </>
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
    <BarHint
      label="Approval gates waiting on you"
      tapToOpen
      body="The agent is blocked until you approve or reject in the session panel; unanswered gates auto-hold when the countdown runs out."
    >
      <span class="gate-badge">
        {count} gate{count === 1 ? '' : 's'}
        {soonest !== undefined && ` · ${formatCountdown(soonest)}`}
      </span>
    </BarHint>
  );
}

function budgetTone(ratio: number): 'ok' | 'warn' | 'danger' {
  if (ratio > 0.9) return 'danger';
  if (ratio >= 0.7) return 'warn';
  return 'ok';
}

function formatTokens(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}k` : String(value);
}

/**
 * Context meter (rail-chrome-v2 phase 5). Two honest modes:
 * - the host reported the agent's REAL window (`contextUsage` on its presence)
 *   → "Context": used / window, with the pinned payload as a note;
 * - nothing reported (no adapter does yet) → "Pins": the pinned-context
 *   payload estimate against the configured budget
 *   (PMX_CANVAS_CONTEXT_BUDGET_TOKENS). Never presented as the agent's window.
 * Session-only, like the chip; the estimate moves within a frame of a pin toggle.
 */
function ContextBudget() {
  const session = activeSession.value;
  if (!session) return null;
  const budget = contextBudget.value;
  const real = session.contextUsage;
  const used = real ? real.used : budget.used;
  const total = real ? real.total : budget.total;
  const ratio = total > 0 ? Math.min(1, used / total) : 0;
  const pct = Math.round(ratio * 100);
  const hint = real
    ? {
        label: `Context window — reported by ${session.label}`,
        body: `${formatTokens(real.used)} of ${formatTokens(real.total)} tokens of the agent's actual context window are used. Your ✦-pinned nodes account for ≈ ${formatTokens(budget.used)} tokens of it.`,
      }
    : {
        label: 'Pins — pinned-context size (estimate)',
        body: `The nodes you pinned (✦) are what the agent is asked to carry as context: ≈ ${formatTokens(budget.used)} of a ${formatTokens(budget.total)}-token budget. When the agent's host reports its real context window, this meter switches to showing that instead.`,
      };
  return (
    <BarHint label={hint.label} body={hint.body} tapToOpen>
      <span class={`context-budget tone-${budgetTone(ratio)}`} data-mode={real ? 'window' : 'pins'}>
        <span class="context-budget-caption hud-collapsible-text">{real ? 'Context' : 'Pins'}</span>
        <span class="context-budget-track" aria-hidden="true">
          <span class="context-budget-fill" style={{ width: `${pct}%` }} />
        </span>
        <span class="context-budget-label" data-testid="budget-label">
          {used > 0 && pct === 0 ? '<1' : pct}%
        </span>
      </span>
    </BarHint>
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
    <BarHint
      label="Start an agent session"
      body="Attaches a session to this board: the next agent that writes here is adopted into it, and you get the panel, composer, and receipt."
    >
      <button
        type="button"
        class="start-session-btn"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void startSession().finally(() => setBusy(false));
        }}
      >
        <span class="start-session-dot" aria-hidden="true" />
        Start agent session
        <span class="beta-tag">beta</span>
      </button>
    </BarHint>
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
      <BarHint
        label={`Canvas status: ${statusTitle}`}
        tapToOpen
        body="Live updates stream in over SSE; amber means reconnecting."
        align="start"
      >
        <span class={`connection-dot ${degraded ?? status}`} aria-label={`Canvas status: ${statusTitle}`} />
      </BarHint>
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

      <BarHint label="Zoom out" shortcut={modChord('\u2212')}>
        <button type="button" class="top-bar-btn" onClick={() => zoomByFactor(1 / 1.25)} aria-label="Zoom out">
          <IconZoomOut />
        </button>
      </BarHint>
      <BarHint label="Reset zoom" shortcut={modChord('0')}>
        <button
          type="button"
          class="top-bar-zoom-label"
          onClick={() => animateViewport({ x: 0, y: 0, scale: 1 }, 250)}
          aria-label="Reset view"
        >
          {Math.round(v.scale * 100)}%
        </button>
      </BarHint>
      <BarHint label="Zoom in" shortcut={modChord('+')}>
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
