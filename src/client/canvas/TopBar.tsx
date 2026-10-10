import { exportDialogOpen } from './ExportDialog';
import { activeBoard, activeBoardId } from '../state/boards-store';
import { BoardSwitcher } from './BoardSwitcher';
import { BoardPinButton } from './BoardPinButton';
import { ContextChip } from './ContextChip';
import { isHostedWorkbench, workbenchFetch } from '../state/workbench-transport';
import type { ComponentChildren } from 'preact';
import { startPresentation } from '../state/presentation';
import { useEffect, useRef, useState } from 'preact/hooks';
import { IconFitAll, IconZoomIn, IconZoomOut, IconClose } from '../icons';
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
import { type AgentPresence, agentPhaseLabel } from '../../shared/agent-presence.js';
import { activeSession, agentPresences, attachedSessions, writerColor, writerInitial } from '../state/presence-store';
import { activityLens, endSession, pendingGates, setActivityLens, startSession } from '../state/session-store';
import { formatCountdown, gateRemainingMs } from '../../shared/approval-gates.js';

/**
 * The attached session's chip (rail-chrome-v2 phase 3): phase-colored, with a
 * dot that pulses while the agent thinks or runs a tool. Renders ONLY while a
 * session is attached — the quiet board shows nothing here until phase 5
 * lands the "Start agent session" affordance.
 */
const AGENT_CHIP_LIMIT = 3;
const AGENT_PHASE_RANK: Record<string, number> = { 'waiting-approval': 0, thinking: 1, tooling: 2, idle: 3 };

function AgentChip() {
  // Every attached session gets its chip — with several agents on the board,
  // showing only the first hid the rest from the top bar entirely. But one
  // chip PER agent floods the bar on a many-agent board (user feedback,
  // 0.5.1 cycle: 16 unshrinkable chips shoved the zoom cluster out of the
  // bar and over the session panel, and the total was invisible): the most
  // active few wear their own chips and the rest fold into a census chip
  // that always names the total.
  const allSessions = attachedSessions.value;
  if (allSessions.length === 0) return null;
  // Attached workers are represented by their orchestrator's roll-up, not a
  // second top-level chip of their own. Orphans remain visible.
  const sessions = allSessions.filter(
    (session) =>
      !session.parentAgentId ||
      !allSessions.some(
        (candidate) =>
          candidate.sessionId !== session.sessionId &&
          !candidate.parentAgentId &&
          (candidate.sessionId === session.parentAgentId || candidate.source === session.parentAgentId),
      ),
  );
  const ranked = [...sessions].sort((a, b) => (AGENT_PHASE_RANK[a.phase] ?? 4) - (AGENT_PHASE_RANK[b.phase] ?? 4));
  const visible = ranked.slice(0, AGENT_CHIP_LIMIT);
  const overflow = ranked.slice(AGENT_CHIP_LIMIT);
  const phaseCounts = sessions.reduce<Record<string, number>>((acc, s) => {
    acc[s.phase] = (acc[s.phase] ?? 0) + 1;
    return acc;
  }, {});
  const breakdown = [
    phaseCounts['waiting-approval'] && `${phaseCounts['waiting-approval']} waiting on approval`,
    phaseCounts.thinking && `${phaseCounts.thinking} thinking`,
    phaseCounts.tooling && `${phaseCounts.tooling} running tools`,
    phaseCounts.idle && `${phaseCounts.idle} idle`,
  ]
    .filter(Boolean)
    .join(', ');
  return (
    <>
      {/* The chips live in their own clipping flex wrapper: each chip keeps
          its natural readable width and the WRAPPER absorbs the squeeze,
          clipping at its edge — no per-child shrink cascade, and chip
          content can never paint over the census, meter, or zoom cluster. */}
      <span class="agent-chips">
        {visible.map((session) => {
          // Fleet roll-up: workers declaring this session as their parent count
          // into its chip instead of growing the bar one chip per worker. A
          // worker's own chip carries no roll-up: same-source siblings would
          // otherwise match it through `session.source`.
          const workers = session.parentAgentId
            ? 0
            : agentPresences.value.filter(
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
                style={{ '--identity-color': writerColor(session.sessionId) }}
              >
                <span class="agent-chip-initial" aria-hidden="true">
                  {writerInitial(session.label)}
                </span>
                <span class="agent-chip-dot" aria-hidden="true" />
                <span class="agent-chip-label">{agentPhaseLabel(session)}</span>
                <span class="agent-chip-who hud-collapsible-text">{session.label}</span>
                <SessionTouches session={session} />
                {workers > 0 && (
                  <span class="agent-chip-workers">
                    +{workers} worker{workers === 1 ? '' : 's'}
                  </span>
                )}
                <button
                  type="button"
                  class="agent-chip-end"
                  aria-label={`End ${session.label} session`}
                  onClick={(e) => {
                    // The chip sits inside a tap-to-open hint — ending a session
                    // must not also open it.
                    e.stopPropagation();
                    void endSession({ source: session.source, agentId: session.agentId });
                  }}
                >
                  <IconClose size={14} />
                </button>
              </span>
            </BarHint>
          );
        })}
      </span>
      {overflow.length > 0 && (
        <BarHint
          label={`${sessions.length} agent sessions attached`}
          tapToOpen
          body={`${sessions.length} agents on this board — ${breakdown}. The most active wear their own chips; the rest are here, and idle agents' cursors leave the board until they work again.`}
        >
          <span class="agent-chip agent-chip-more" data-testid="agent-chip-more">
            +{overflow.length} · {sessions.length} agents
          </span>
        </BarHint>
      )}
    </>
  );
}

/**
 * What the session has done so far (AgentContext.dc.html lens, Pane600
 * "Claude · 4 read · 1 edited"): the counts, and a press dims every card it
 * has not touched. Hidden until it has touched something.
 */
function SessionTouches({ session }: { session: AgentPresence }) {
  const touches = session.session;
  const parts = touches
    ? (
        [
          ['read', touches.read.length],
          ['created', touches.created.length],
          ['edited', touches.edited.length],
          ['pinned', touches.pinned.length],
        ] as const
      ).filter(([, count]) => count > 0)
    : [];
  const lens = activityLens.value;
  const on = lens?.kind === 'live' && lens.sessionId === session.sessionId;
  // While its lens is on the button stays, even at zero, so it can be turned off.
  if (parts.length === 0 && !on) return null;
  return (
    <button
      type="button"
      class={`agent-chip-touches${on ? ' is-on' : ''}`}
      aria-pressed={on}
      aria-label={`This session: ${parts.map(([word, count]) => `${count} ${word}`).join(', ') || 'nothing yet'}. ${on ? 'Show all cards' : 'Dim untouched cards'}`}
      onClick={(event) => {
        // Inside the chip's tap-to-open hint: toggling the lens must not open it.
        event.stopPropagation();
        setActivityLens(!on, { sessionId: session.sessionId });
      }}
    >
      {parts.map(([word, count]) => `${count} ${word}`).join(' · ') || 'nothing yet'}
    </button>
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
        aria-label="Start agent session beta"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void startSession().finally(() => setBusy(false));
        }}
      >
        <span class="start-session-dot" aria-hidden="true" />
        <span class="start-session-label">Start agent session</span>
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

  // Until the board list arrives, the switcher shows the workspace basename
  // (fetched once from /health).
  const [workspaceName, setWorkspaceName] = useState<string>('');
  useEffect(() => {
    let cancelled = false;
    workbenchFetch('/health')
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
  const pinTarget = activeBoard();
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
      <BoardSwitcher fallbackName={workspaceName || 'PMX Canvas'} />
      {pinTarget && <BoardPinButton board={pinTarget} />}
      <span class="top-bar-meta hud-collapsible-text">{sessionId.value ? sessionId.value.slice(0, 12) : '…'}</span>
      <span class="top-bar-meta hud-collapsible-text">{countsLabel}</span>

      <span class="top-bar-spacer" />

      {/* The right-hand group never shrinks, so the context summary stays
          top-right at every width; the controls collapse by step instead
          (docs/design/ContextChip600.dc.html). */}
      <div class="top-bar-right">
        <AgentChip />
        <GateBadge />
        <ContextChip />
        <ExternalWriterIndicator />
        {!isHostedWorkbench() && <StartSessionButton />}

        <div class="top-bar-sep" />
        <div class="top-bar-actions">
          {activeBoardId.value && (
            <BarHint label="Export board" body="One HTML file of this board that anyone can open, no install needed.">
              <button
                type="button"
                class="present-button"
                onClick={() => {
                  exportDialogOpen.value = true;
                }}
              >
                Export
              </button>
            </BarHint>
          )}
          {activeBoardId.value && (
            <BarHint
              label="Present board"
              body="Arrow keys or Space step through stops; Esc exits. Without a saved tour, groups are read top-to-bottom, left-to-right."
            >
              <button
                type="button"
                class="present-button"
                onClick={() => {
                  void startPresentation();
                }}
              >
                Present
              </button>
            </BarHint>
          )}
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
        <TopBarMore boardOpen={!!activeBoardId.value} onFit={handleFit} />
      </div>
    </div>
  );
}

/** Narrow bars fold Export, Present, zoom and fit into one ⋯ menu (Pane600.dc.html). */
function TopBarMore({ boardOpen, onFit }: { boardOpen: boolean; onFit: () => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const items = () => [...(root.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    items()[0]?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        trigger.current?.focus();
      } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const list = items();
        const at = list.indexOf(document.activeElement as HTMLElement);
        const next = event.key === 'ArrowDown' ? at + 1 : at - 1;
        list[(next + list.length) % list.length]?.focus();
      }
    };
    const onDown = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown);
    };
  }, [open]);
  const run = (action: () => void) => () => {
    setOpen(false);
    action();
  };
  return (
    <div class="top-bar-more" ref={root}>
      <button
        ref={trigger}
        type="button"
        class="top-bar-btn"
        aria-label="More: export, present, zoom, fit"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        ⋯
      </button>
      {open && (
        <div class="toolbar-menu top-bar-more-menu" role="menu">
          {boardOpen && (
            <button
              type="button"
              role="menuitem"
              class="toolbar-menu-item"
              onClick={run(() => {
                exportDialogOpen.value = true;
              })}
            >
              Export board
            </button>
          )}
          {boardOpen && (
            <button
              type="button"
              role="menuitem"
              class="toolbar-menu-item"
              onClick={run(() => void startPresentation())}
            >
              Present board
            </button>
          )}
          <button type="button" role="menuitem" class="toolbar-menu-item" onClick={run(() => zoomByFactor(1.25))}>
            Zoom in
          </button>
          <button type="button" role="menuitem" class="toolbar-menu-item" onClick={run(() => zoomByFactor(1 / 1.25))}>
            Zoom out
          </button>
          <button
            type="button"
            role="menuitem"
            class="toolbar-menu-item"
            onClick={run(() => animateViewport({ x: 0, y: 0, scale: 1 }, 250))}
          >
            Reset zoom
          </button>
          <button type="button" role="menuitem" class="toolbar-menu-item" onClick={run(onFit)}>
            Fit all
          </button>
        </div>
      )}
    </div>
  );
}
