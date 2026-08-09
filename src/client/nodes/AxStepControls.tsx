import { useState } from 'preact/hooks';
import { readAxFlow, readAxStep, type AxFlowStamp } from '../../shared/ax-flow.js';
import { nodes, updateNodeData } from '../state/canvas-store';
import { updateNodeFromClient } from '../state/intent-bridge';
import type { CanvasNodeState } from '../types';
import { axNodeActionButtonStyle, runNodeAxInteraction } from './ax-node-actions';

/**
 * Native AX controls for a materialized flow step — the same capability the
 * ax-flow HTML panel has, on an ORDINARY canvas node.
 *
 * Rendered by CanvasNode for any node carrying `data.axStep`, whatever its type,
 * so the flow is driven from the board itself: Start/Done/Blocked emit
 * `ax.work.update` for the step's work item through the trusted `native-node`
 * surface, and the anchor step additionally runs/stops the durable server loop
 * (ax-flow-loop.ts) and steers the agent.
 */

/**
 * The rows sit in a dock stuck to the bottom of the scrollable node body: a step
 * node is short (360x200 as materialized), so a control row that simply followed
 * the content scrolled out of sight. Sticky keeps it reachable at any node height
 * while still being INSIDE the body, which is what auto-fit measures.
 */
/**
 * The dock reads as a real footer toolbar rather than stray text at the bottom
 * edge. It bleeds to the container's edges via negative margins (`.node-body`
 * has 12px padding; the expanded overlay's content area has 16px, and the dock
 * is a sibling of that area, so it starts flush) and then re-applies its own
 * padding — otherwise the first label sits hard against the left edge and looks
 * clipped. `--c-panel-overlay` separates it from the content above it.
 */
const dockStyle = {
  position: 'sticky',
  // Bleed OUT of the container's padding so the bar spans edge to edge, then
  // re-apply padding inside it. These are two different numbers: in a node body
  // the dock sits INSIDE 12px of padding and must pull back out of it, while in
  // the expanded overlay it is a sibling of the padded content area and is
  // already flush — bleeding there would push it off the panel.
  bottom: 'calc(-1 * var(--ax-dock-bleed, 12px))',
  marginTop: '12px',
  marginLeft: 'calc(-1 * var(--ax-dock-bleed, 12px))',
  marginRight: 'calc(-1 * var(--ax-dock-bleed, 12px))',
  marginBottom: 'calc(-1 * var(--ax-dock-bleed, 12px))',
  padding: '9px var(--ax-dock-pad, 12px) 10px',
  background: 'var(--c-panel-overlay)',
  borderTop: '1px solid var(--c-line)',
  backdropFilter: 'blur(6px)',
} as const;

const rowStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  flexWrap: 'wrap',
} as const;

const labelStyle = {
  fontSize: '10px',
  color: 'var(--c-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  marginRight: 'auto',
} as const;

const activeButtonStyle = {
  ...axNodeActionButtonStyle,
  background: 'var(--c-accent-25)',
  color: 'var(--c-text)',
} as const;

const STEP_ACTIONS = [
  { status: 'in-progress', label: 'Start', toast: 'Step started' },
  { status: 'done', label: 'Done', toast: 'Step done' },
  { status: 'blocked', label: 'Blocked', toast: 'Step blocked' },
] as const;

/** Persist a new loop state on the anchor node (optimistic locally, durable on the server). */
async function persistLoop(node: CanvasNodeState, flow: AxFlowStamp, loop: AxFlowStamp['loop']): Promise<void> {
  const axFlow: AxFlowStamp = { ...flow, loop };
  updateNodeData(node.id, { axFlow });
  await updateNodeFromClient(node.id, { data: { axFlow } });
}

/** The work-item status mirrored onto a node by the server (`data.axWorkStatus`). */
function mirroredStatus(data: Record<string, unknown> | undefined): string {
  return typeof data?.axWorkStatus === 'string' ? data.axWorkStatus : 'todo';
}

function FlowLoopControls({ node, flow }: { node: CanvasNodeState; flow: AxFlowStamp }) {
  const [message, setMessage] = useState('');
  const { running, run, maxRuns } = flow.loop;

  const handleRun = async () => {
    // A finished loop restarts from zero rather than stopping on its first check.
    await persistLoop(node, flow, { running: true, run: run >= maxRuns ? 0 : run, maxRuns });
    // The server loop only advances on a WORK-ITEM change, so starting it has to
    // produce one: open the first unfinished step, or re-assert the last step's
    // `done` when the flow is already complete (which closes the run and opens
    // the next one server-side).
    const next = flow.steps.find((step) => mirroredStatus(nodes.value.get(step.nodeId)?.data) !== 'done');
    const target = next ?? flow.steps[flow.steps.length - 1];
    await runNodeAxInteraction(
      node,
      'ax.work.update',
      { id: target.workItemId, status: next ? 'in-progress' : 'done' },
      'Loop running',
    );
  };

  const handleSteer = async () => {
    const text = message.trim();
    if (!text) return;
    await runNodeAxInteraction(node, 'ax.steer', { message: text }, 'Steering sent');
    setMessage('');
  };

  return (
    <div class="ax-flow-controls" style={{ ...rowStyle, marginTop: '6px', rowGap: '4px' }}>
      <span class="ax-flow-runs" style={labelStyle}>
        {running ? `Loop running · run ${run + 1}/${maxRuns}` : `Loop idle · ${run}/${maxRuns} runs`}
      </span>
      {running ? (
        <button
          type="button"
          class="ax-node-action"
          style={activeButtonStyle}
          title="Stop the loop now. The stop is persisted on this node, so it survives a refresh and no further step is opened."
          onClick={(e) => {
            e.stopPropagation();
            void persistLoop(node, flow, { ...flow.loop, running: false });
          }}
        >
          Stop
        </button>
      ) : (
        <button
          type="button"
          class="ax-node-action"
          style={axNodeActionButtonStyle}
          title="Run this flow as a loop: each completed step opens the next one, and the last step starts the next run — until the run cap is reached or you press Stop."
          onClick={(e) => {
            e.stopPropagation();
            void handleRun();
          }}
        >
          Run loop
        </button>
      )}
      <input
        class="ax-flow-steer-input"
        value={message}
        placeholder="Steer the agent…"
        aria-label="Steer the agent"
        onInput={(e) => setMessage((e.target as HTMLInputElement).value)}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          e.stopPropagation();
          void handleSteer();
        }}
        style={{
          flex: '1 1 120px',
          minWidth: '90px',
          fontSize: '10px',
          padding: '3px 6px',
          borderRadius: '4px',
          border: '1px solid var(--c-line)',
          background: 'var(--c-panel-overlay)',
          color: 'var(--c-text)',
        }}
      />
      <button
        type="button"
        class="ax-node-action"
        style={axNodeActionButtonStyle}
        title="Send a steering message to the agent working this flow."
        onClick={(e) => {
          e.stopPropagation();
          void handleSteer();
        }}
      >
        Steer
      </button>
    </div>
  );
}

export function AxStepControls({ node }: { node: CanvasNodeState }) {
  const step = readAxStep(node.data);
  if (!step) return null;
  const flow = readAxFlow(node.data);
  const status = mirroredStatus(node.data);

  return (
    <div class="ax-step-dock" style={dockStyle}>
      <div class="ax-step-controls" style={rowStyle}>
        <span class="ax-step-position" style={labelStyle}>
          Step {step.index}/{step.total}
        </span>
        {STEP_ACTIONS.map((action) => (
          <button
            key={action.status}
            type="button"
            class="ax-node-action"
            aria-pressed={status === action.status}
            style={status === action.status ? activeButtonStyle : axNodeActionButtonStyle}
            title={`Set this step's work item to "${action.status}".`}
            onClick={(e) => {
              e.stopPropagation();
              void runNodeAxInteraction(
                node,
                'ax.work.update',
                { id: step.workItemId, status: action.status },
                action.toast,
              );
            }}
          >
            {action.label}
          </button>
        ))}
      </div>
      {flow && <FlowLoopControls node={node} flow={flow} />}
    </div>
  );
}
