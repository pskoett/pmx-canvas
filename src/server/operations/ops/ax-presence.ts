/**
 * Agent presence operations (rail-chrome-v2 phase 2): the connect-time read
 * and the explicit update for adapters with richer hooks than the derived
 * feed provides (`thinking`, cursor, focus, attach/detach).
 *
 * This module must never import server.ts or index.ts.
 */
import { z } from 'zod';
import { agentPresence } from '../../agent-presence.js';
import { AGENT_PHASES } from '../../../shared/agent-presence.js';
import { defineOperation, type Operation, type OperationContext } from '../types.js';
import { AX_AGENT_ID_SHAPE, normalizeAxSource } from './ax-shared.js';

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

const presenceSetShape = {
  source: z.unknown().optional().describe('Host label (copilot, codex, mcp, …); defaults to the transport'),
  agentId: AX_AGENT_ID_SHAPE,
  label: z.string().min(1).max(120).optional().describe('Display name for this writer'),
  phase: z
    .enum(AGENT_PHASES as ['idle', 'thinking', 'tooling', 'waiting-approval'])
    .optional()
    .describe('idle | thinking | tooling | waiting-approval'),
  detail: z.string().max(200).nullable().optional().describe('Tool / step name shown beside the phase'),
  focusNodeId: z.string().max(200).nullable().optional().describe('Node the agent is working on'),
  cursor: z
    .object({ x: z.number(), y: z.number() })
    .nullable()
    .optional()
    .describe('Agent cursor in world coordinates'),
  attached: z.boolean().optional().describe('true attaches a session (Focus Session chrome); false detaches it'),
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
    const presence = agentPresence.set(rest, normalizeAxSource(source, 'api'));
    return { ok: true, presence, ...agentPresence.snapshot() };
  },
});

export const axPresenceOperations: Operation[] = [presenceGetOperation, presenceSetOperation];
