import { useState } from 'preact/hooks';
import { BarHint } from '../canvas/BarHint';
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
 * The rows sit in `.ax-step-dock`, a footer that stays reachable at the bottom of
 * the node body (global.css). On a card it shares one footer row with the card's
 * own actions; in the expanded overlay it is a sticky bar under the document.
 */
const rowStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  flexWrap: 'wrap',
} as const;

const labelStyle = {
  fontSize: 'var(--fs-meta)',
  color: 'var(--c-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  marginRight: 'auto',
} as const;

const activeButtonStyle = {
  ...axNodeActionButtonStyle,
  background: 'color-mix(in srgb, var(--c-accent) 25%, transparent)',
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
        <BarHint
          label="Stop the loop now"
          body="The stop is persisted on this node, so it survives a refresh and no further step is opened."
          side="up"
          fitWithin=".node-content, .expanded-overlay-panel"
        >
          <button
            type="button"
            class="ax-node-action"
            style={activeButtonStyle}
            onClick={(e) => {
              e.stopPropagation();
              void persistLoop(node, flow, { ...flow.loop, running: false });
            }}
          >
            Stop
          </button>
        </BarHint>
      ) : (
        <BarHint
          label="Run this flow as a loop"
          body="Each completed step opens the next one, and the last step starts the next run — until the run cap is reached or you press Stop."
          side="up"
          fitWithin=".node-content, .expanded-overlay-panel"
        >
          <button
            type="button"
            class="ax-node-action"
            style={axNodeActionButtonStyle}
            onClick={(e) => {
              e.stopPropagation();
              void handleRun();
            }}
          >
            Run loop
          </button>
        </BarHint>
      )}
      {/* The draft and its send button wrap as one unit, never a lone Steer. */}
      <span style={{ display: 'flex', gap: '6px', flex: '1 1 140px', minWidth: 0 }}>
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
            flex: '1 1 0',
            minWidth: 0,
            fontSize: 'var(--fs-meta)',
            padding: '3px 6px',
            borderRadius: '4px',
            border: '1px solid var(--c-line)',
            background: 'var(--c-panel-overlay)',
            color: 'var(--c-text)',
          }}
        />
        <BarHint
          label="Send a steering message to the agent working this flow"
          side="up"
          align="end"
          fitWithin=".node-content, .expanded-overlay-panel"
        >
          <button
            type="button"
            class="ax-node-action"
            style={axNodeActionButtonStyle}
            onClick={(e) => {
              e.stopPropagation();
              void handleSteer();
            }}
          >
            Steer
          </button>
        </BarHint>
      </span>
    </div>
  );
}

export function AxStepControls({ node }: { node: CanvasNodeState }) {
  const step = readAxStep(node.data);
  if (!step) return null;
  const flow = readAxFlow(node.data);
  const status = mirroredStatus(node.data);

  return (
    <div class="ax-step-dock">
      <div class="ax-step-controls" style={rowStyle}>
        <span class="ax-step-position" style={labelStyle}>
          Step {step.index}/{step.total}
        </span>
        {STEP_ACTIONS.map((action) => (
          <BarHint
            key={action.status}
            label={`Set this step's work item to "${action.status}"`}
            side="up"
            fitWithin=".node-content, .expanded-overlay-panel"
          >
            <button
              type="button"
              class="ax-node-action"
              aria-pressed={status === action.status}
              style={status === action.status ? activeButtonStyle : axNodeActionButtonStyle}
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
          </BarHint>
        ))}
      </div>
      {flow && <FlowLoopControls node={node} flow={flow} />}
    </div>
  );
}
