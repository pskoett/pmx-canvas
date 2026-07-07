/**
 * Ext-app operations (plan-009 C1 slice 1): extapp.call-tool /
 * extapp.read-resource / extapp.list-tools / extapp.list-resources /
 * extapp.list-resource-templates / extapp.list-prompts / extapp.model-context
 * — the /api/ext-app/* wire surface the canvas iframe bridge calls. Wire
 * envelopes are byte-identical to the legacy server.ts handlers they replace
 * ({ ok: true, result } / { ok: false, error } with the same status codes).
 * HTTP-only: none of these register MCP tools (the sandboxed iframe is the
 * caller, not an agent), so the frozen 27-tool MCP surface is untouched.
 *
 * This module must never import server.ts or index.ts.
 */
import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { canvasState, type CanvasNodeState } from '../../canvas-state.js';
import {
  buildExcalidrawRestoreCheckpointToolInput,
  buildExcalidrawCheckpointId,
  ensureExcalidrawCheckpointId,
  EXCALIDRAW_READ_CHECKPOINT_TOOL,
  EXCALIDRAW_SAVE_CHECKPOINT_TOOL,
  getExcalidrawCheckpointIdFromToolResult,
  isExcalidrawCreateView,
} from '../../diagram-presets.js';
import {
  callMcpAppTool,
  listMcpAppPrompts,
  listMcpAppResources,
  listMcpAppResourceTemplates,
  listMcpAppTools,
  readMcpAppResource,
} from '../../mcp-app-runtime.js';
import { defineOperation, OperationError, type Operation, type OperationContext } from '../types.js';
import { isRecord } from './nodes.js';

// ── Excalidraw checkpoint helpers (moved from server.ts) ──────

function isCheckpointToolName(toolName: string): boolean {
  return toolName === EXCALIDRAW_SAVE_CHECKPOINT_TOOL || toolName === EXCALIDRAW_READ_CHECKPOINT_TOOL;
}

/**
 * Decide whether a fresh `callServerTool` result should *replace* the
 * canvas node's bootstrap-replay `toolResult`.
 *
 * The bootstrap-replay toolResult is what the server re-sends to the
 * widget on reload to restore visible state. We only want to overwrite
 * it when the new result genuinely carries widget state — `isError` or
 * `structuredContent`. A plain-text result (e.g. `read_checkpoint`
 * returning a string status, or any informational message) updates
 * `appModelContext` for the agent's record but should *not* clobber the
 * bootstrap entry, because doing so would replace the widget's restored
 * state with conversational noise on the next reload.
 *
 * This separation is exercised by:
 *   - tests/unit/server-api.test.ts "keeps ext-app model context
 *     separate from the replayed tool result" (text-only result preserves
 *     bootstrap replay)
 *   - tests/unit/server-api.test.ts "app-only text tool results update
 *     model context without replacing bootstrap replay"
 *   - tests/unit/server-api.test.ts "rehydrates Excalidraw checkpoint
 *     replay after server restart" (structured-content result becomes
 *     the new bootstrap replay)
 */
function shouldReplayAppToolResult(toolName: string, result: CallToolResult): boolean {
  void toolName;
  return Boolean(result.isError || result.structuredContent);
}

function getExtAppNodeCheckpointId(node: CanvasNodeState): string {
  const appCheckpoint = isRecord(node.data.appCheckpoint) ? node.data.appCheckpoint : null;
  const storedCheckpointId = appCheckpoint?.id;
  if (typeof storedCheckpointId === 'string' && storedCheckpointId.trim().length > 0) {
    return storedCheckpointId.trim();
  }
  return getExcalidrawCheckpointIdFromToolResult(node.data.toolResult) ?? buildExcalidrawCheckpointId(node.id);
}

function getLocalExcalidrawCheckpointData(
  node: CanvasNodeState,
  args: Record<string, unknown> | undefined,
): string | null {
  if (!isExcalidrawCreateView(node.data.serverName, node.data.toolName)) return null;
  if (!isRecord(args) || typeof args.id !== 'string') return null;
  if (args.id.trim() !== getExtAppNodeCheckpointId(node)) return null;
  const appCheckpoint = isRecord(node.data.appCheckpoint) ? node.data.appCheckpoint : null;
  const data = appCheckpoint?.data;
  return typeof data === 'string' ? data : '';
}

function persistExcalidrawCheckpointToNode(
  nodeId: string,
  node: CanvasNodeState,
  args: Record<string, unknown> | undefined,
): boolean {
  if (!isExcalidrawCreateView(node.data.serverName, node.data.toolName)) return false;
  if (!isRecord(args) || typeof args.id !== 'string') return false;
  const checkpointId = getExtAppNodeCheckpointId(node);
  if (args.id.trim() !== checkpointId) return false;

  const currentToolInput = isRecord(node.data.toolInput) ? node.data.toolInput : {};
  const nextToolInput = {
    ...currentToolInput,
    elements: buildExcalidrawRestoreCheckpointToolInput(checkpointId, args.data),
  };
  const currentToolResult = isRecord(node.data.toolResult)
    ? ensureExcalidrawCheckpointId(node.data.toolResult as CallToolResult, node.id, checkpointId)
    : undefined;

  canvasState.updateNode(nodeId, {
    data: {
      ...node.data,
      toolInput: nextToolInput,
      ...(currentToolResult ? { toolResult: currentToolResult } : {}),
      appCheckpoint: {
        toolName: EXCALIDRAW_SAVE_CHECKPOINT_TOOL,
        id: checkpointId,
        ...(typeof args.data === 'string' ? { data: args.data } : {}),
        updatedAt: new Date().toISOString(),
      },
    },
  });
  return true;
}

// ── Shared input plumbing ─────────────────────────────────────

function requireSessionId(body: Record<string, unknown>): string {
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
  if (!sessionId) throw new OperationError('Missing sessionId.');
  return sessionId;
}

/** Runtime failures keep the legacy wire shape: 400 { ok:false, error }. */
function toWireError(error: unknown): OperationError {
  return new OperationError(error instanceof Error ? error.message : String(error));
}

const sessionShape = {
  sessionId: z.unknown().optional().describe('Ext-app session id'),
};

/** The four list-* endpoints differ only in the runtime call they proxy. */
function defineExtAppListOperation(segment: string, list: (sessionId: string) => Promise<unknown>): Operation {
  const schema = z.looseObject(sessionShape);
  return defineOperation<z.infer<typeof schema>, Record<string, unknown>>({
    name: `extapp.${segment}`,
    mutates: false,
    input: schema,
    inputShape: sessionShape,
    http: {
      method: 'POST',
      path: `/api/ext-app/${segment}`,
    },
    handler: async (input) => {
      const sessionId = requireSessionId(input);
      try {
        return { ok: true, result: await list(sessionId) };
      } catch (error) {
        throw toWireError(error);
      }
    },
  });
}

// ── extapp.call-tool ──────────────────────────────────────────

const callToolShape = {
  sessionId: z.unknown().optional().describe('Ext-app session id'),
  toolName: z.unknown().optional().describe('Tool to invoke on the ext-app MCP session'),
  arguments: z.unknown().optional().describe('Tool arguments object'),
  nodeId: z.unknown().optional().describe('Canvas node id to replay/persist the tool result on'),
};

const callToolSchema = z.looseObject(callToolShape);

const callToolOperation = defineOperation<z.infer<typeof callToolSchema>, Record<string, unknown>>({
  name: 'extapp.call-tool',
  mutates: false,
  input: callToolSchema,
  inputShape: callToolShape,
  http: {
    method: 'POST',
    path: '/api/ext-app/call-tool',
  },
  handler: async (input, ctx: OperationContext) => {
    const body: Record<string, unknown> = input;
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
    const toolName = typeof body.toolName === 'string' ? body.toolName.trim() : '';
    if (!sessionId || !toolName) {
      throw new OperationError('Missing sessionId or toolName.');
    }

    const args = isRecord(body.arguments) ? body.arguments : undefined;
    const nodeId = typeof body.nodeId === 'string' ? body.nodeId.trim() : '';

    try {
      const requestedNode = nodeId ? canvasState.getNode(nodeId) : undefined;
      const canReadLocalCheckpoint =
        requestedNode?.type === 'mcp-app' &&
        requestedNode.data.mode === 'ext-app' &&
        requestedNode.data.appSessionId === sessionId;
      const localCheckpointData =
        canReadLocalCheckpoint && toolName === EXCALIDRAW_READ_CHECKPOINT_TOOL
          ? getLocalExcalidrawCheckpointData(requestedNode, args)
          : null;
      const result =
        localCheckpointData === null
          ? await callMcpAppTool(sessionId, toolName, args)
          : ({ content: [{ type: 'text', text: localCheckpointData }] } satisfies CallToolResult);
      if (nodeId) {
        const node = canvasState.getNode(nodeId);
        if (node?.type === 'mcp-app' && node.data.mode === 'ext-app' && node.data.appSessionId === sessionId) {
          let changed = false;
          if (toolName === EXCALIDRAW_SAVE_CHECKPOINT_TOOL && persistExcalidrawCheckpointToNode(nodeId, node, args)) {
            // Checkpoint saves are replayed through toolInput.elements instead of
            // replacing the original create_view result with a generic "ok".
            changed = true;
          } else if (
            !(isExcalidrawCreateView(node.data.serverName, node.data.toolName) && isCheckpointToolName(toolName))
          ) {
            const nextData: Record<string, unknown> = { ...node.data };
            if (shouldReplayAppToolResult(toolName, result)) nextData.toolResult = result;
            const nextModelContext: Record<string, unknown> = {};
            if (Array.isArray(result.content)) {
              nextModelContext.content = result.content;
            }
            if (
              result.structuredContent &&
              typeof result.structuredContent === 'object' &&
              !Array.isArray(result.structuredContent)
            ) {
              nextModelContext.structuredContent = result.structuredContent;
            }
            if (Object.keys(nextModelContext).length > 0) {
              nextData.appModelContext = {
                ...nextModelContext,
                updatedAt: new Date().toISOString(),
              };
            }
            canvasState.updateNode(nodeId, {
              data: nextData,
            });
            changed = true;
          }
          if (changed) {
            ctx.emit('canvas-layout-update', { layout: canvasState.getLayout() });
          }
        }
      }
      return { ok: true, result };
    } catch (error) {
      throw toWireError(error);
    }
  },
});

// ── extapp.read-resource ──────────────────────────────────────

const readResourceShape = {
  sessionId: z.unknown().optional().describe('Ext-app session id'),
  uri: z.unknown().optional().describe('Resource URI to read from the ext-app MCP session'),
};

const readResourceSchema = z.looseObject(readResourceShape);

const readResourceOperation = defineOperation<z.infer<typeof readResourceSchema>, Record<string, unknown>>({
  name: 'extapp.read-resource',
  mutates: false,
  input: readResourceSchema,
  inputShape: readResourceShape,
  http: {
    method: 'POST',
    path: '/api/ext-app/read-resource',
  },
  handler: async (input) => {
    const body: Record<string, unknown> = input;
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
    const uri = typeof body.uri === 'string' ? body.uri.trim() : '';
    if (!sessionId || !uri) {
      throw new OperationError('Missing sessionId or uri.');
    }
    try {
      return { ok: true, result: await readMcpAppResource(sessionId, uri) };
    } catch (error) {
      throw toWireError(error);
    }
  },
});

// ── extapp.model-context ──────────────────────────────────────

const modelContextShape = {
  nodeId: z.unknown().optional().describe('Canvas node id to attach the model context to'),
  content: z.unknown().optional().describe('MCP content array'),
  structuredContent: z.unknown().optional().describe('MCP structured content object'),
};

const modelContextSchema = z.looseObject(modelContextShape);

const modelContextOperation = defineOperation<z.infer<typeof modelContextSchema>, Record<string, unknown>>({
  name: 'extapp.model-context',
  mutates: false,
  input: modelContextSchema,
  inputShape: modelContextShape,
  http: {
    method: 'POST',
    path: '/api/ext-app/model-context',
  },
  handler: (input, ctx: OperationContext) => {
    const body: Record<string, unknown> = input;
    const nodeId = typeof body.nodeId === 'string' ? body.nodeId.trim() : '';
    if (!nodeId) throw new OperationError('Missing nodeId.');

    const node = canvasState.getNode(nodeId);
    if (!node) throw new OperationError(`Node "${nodeId}" not found.`, 404);

    canvasState.updateNode(nodeId, {
      data: {
        ...node.data,
        appModelContext: {
          ...(Array.isArray(body.content) ? { content: body.content } : {}),
          ...(body.structuredContent &&
          typeof body.structuredContent === 'object' &&
          !Array.isArray(body.structuredContent)
            ? { structuredContent: body.structuredContent }
            : {}),
          updatedAt: new Date().toISOString(),
        },
      },
    });

    ctx.emit('canvas-layout-update', { layout: canvasState.getLayout() });
    return { ok: true };
  },
});

export const extAppOperations: Operation[] = [
  callToolOperation,
  readResourceOperation,
  defineExtAppListOperation('list-tools', listMcpAppTools),
  defineExtAppListOperation('list-resources', listMcpAppResources),
  defineExtAppListOperation('list-resource-templates', listMcpAppResourceTemplates),
  defineExtAppListOperation('list-prompts', listMcpAppPrompts),
  modelContextOperation,
];
