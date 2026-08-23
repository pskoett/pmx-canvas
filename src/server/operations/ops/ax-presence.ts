/**
 * Agent presence operations (rail-chrome-v2 phase 2): the connect-time read
 * and the explicit update for adapters with richer hooks than the derived
 * feed provides (`thinking`, cursor, focus, attach/detach).
 *
 * This module must never import server.ts or index.ts.
 */
import { z } from 'zod';
import { agentPresence, SOURCE_LABEL_RE, PRESENCE_SET_SHAPE } from '../../agent-presence.js';
import { defineOperation, type Operation, type OperationContext } from '../types.js';

const emptyShape = {};
const emptySchema = z.looseObject(emptyShape);

const presenceGetOperation = defineOperation<z.infer<typeof emptySchema>, Record<string, unknown>>({
  name: 'ax.presence.get',
  mutates: false,
  input: emptySchema,
  inputShape: emptyShape,
  http: {
    method: 'GET',
    path: '/api/canvas/ax/presence',
  },
  handler: () => ({ ok: true, ...agentPresence.snapshot() }),
});

// One schema (agent-presence.ts) — only the descriptions are added here.
const presenceSetShape = {
  source: PRESENCE_SET_SHAPE.source.describe('Host label (copilot, codex, mcp, …); defaults to the transport'),
  agentId: PRESENCE_SET_SHAPE.agentId.describe('Per-agent identity within the host (sub-agents keep their own cursor)'),
  label: PRESENCE_SET_SHAPE.label.describe('Display name for this writer'),
  phase: PRESENCE_SET_SHAPE.phase.describe('idle | thinking | tooling | waiting-approval'),
  detail: PRESENCE_SET_SHAPE.detail.describe('Tool / step name shown beside the phase'),
  focusNodeId: PRESENCE_SET_SHAPE.focusNodeId.describe('Node the agent is working on'),
  cursor: PRESENCE_SET_SHAPE.cursor.describe('Agent cursor in world coordinates'),
  attached: PRESENCE_SET_SHAPE.attached.describe('true attaches a session (Focus Session chrome); false detaches it'),
};
const presenceSetSchema = z.looseObject(presenceSetShape);

const presenceSetOperation = defineOperation<z.infer<typeof presenceSetSchema>, Record<string, unknown>>({
  name: 'ax.presence.set',
  // Presence is not canvas state: no layout event, no history entry, no auto-ghost.
  mutates: false,
  input: presenceSetSchema,
  inputShape: presenceSetShape,
  http: {
    method: 'POST',
    path: '/api/canvas/ax/presence',
  },
  handler: (input, _ctx: OperationContext) => {
    const { source, ...rest } = input;
    // The presence label is a WRITER label, not an AX source enum value: an
    // adapter or an MCP server running with PMX_CANVAS_AGENT_SOURCE=claude-code
    // must attach under the same label its writes carry (SOURCE_LABEL_RE), or
    // the session and the writer split into two cursors.
    const label = typeof source === 'string' && SOURCE_LABEL_RE.test(source) ? source : 'api';
    const presence = agentPresence.set(rest, label);
    return { ok: true, presence, ...agentPresence.snapshot() };
  },
});

export const axPresenceOperations: Operation[] = [presenceGetOperation, presenceSetOperation];
