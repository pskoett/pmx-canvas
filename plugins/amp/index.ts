import type { PluginAPI, PluginCommandContext } from '@ampcode/plugin';
import { bind, boards, readBinding, unbind } from './binding.js';
import { canonicalWorkspace, inspectServer, portal } from './runtime.js';

export const description =
  'Open or resume PMX Canvas and explicitly bind each Amp thread to a board. Bundles PMX skills and MCP. Context injection and steering are not enabled.';

export default async function (amp: PluginAPI) {
  if (!amp.system.workspaceRoot) return;
  if (typeof amp.registerSkill !== 'function')
    throw new Error('PMX Canvas requires Amp with directory-plugin skills support. Update Amp.');
  const root = canonicalWorkspace(amp.helpers.filePathFromURI(amp.system.workspaceRoot));
  for (const name of ['pmx-canvas', 'pmx-canvas-testing', 'pmx-canvas-orchestration']) {
    await amp.registerSkill({ path: `skills/${name}` });
  }

  amp.on('tool.call', async (event) => {
    if (!event.tool.startsWith('mcp__pmx_canvas__canvas_')) return { action: 'allow' };
    if (['mcp__pmx_canvas__canvas_help', 'mcp__pmx_canvas__canvas_connect_workspace'].includes(event.tool))
      return { action: 'allow' };
    const binding = readBinding(root, event.thread.id);
    if (!binding) return { action: 'allow' };
    for (const key of ['targetBoardId', 'destinationBoardId', 'expectedBoardId', 'board']) {
      if (event.input[key] !== undefined && event.input[key] !== binding.boardId)
        return {
          action: 'reject-and-continue',
          message: `${key} conflicts with this thread's bound board. Rebind explicitly.`,
        };
    }
    if (event.tool === 'mcp__pmx_canvas__canvas_screenshot')
      return {
        action: 'reject-and-continue',
        message:
          'Screenshots inspect the shared view, not the bound board. Use the Canvas Portal for visual inspection.',
      };
    return {
      action: 'modify',
      input: { ...event.input, targetBoardId: binding.boardId, agentId: binding.consumerId },
    };
  });

  async function execute(action: string, threadId: string, boardId?: string, signal?: AbortSignal) {
    signal?.throwIfAborted();
    if (action === 'unbind') {
      unbind(root, threadId);
      return { binding: null };
    }
    const target = await inspectServer(root, action !== 'status');
    const catalog = await boards(target.serverUrl);
    signal?.throwIfAborted();
    if (action === 'bind') {
      if (!boardId || !catalog.boards.some((board) => board.id === boardId))
        throw new Error('Choose an existing board ID. No board was activated or created.');
      return { ...target, binding: bind(root, threadId, boardId), activeBoardId: catalog.activeBoardId };
    }
    const binding = readBinding(root, threadId);
    const result = {
      ...target,
      binding,
      activeBoardId: catalog.activeBoardId,
      boards: catalog.boards,
      boundBoardExists: binding ? catalog.boards.some((board) => board.id === binding.boardId) : null,
      routing:
        'PMX MCP tool calls target this thread’s bound board without navigating the shared canvas. CLI calls and MCP resources are not intercepted. No automatic context or steering.',
    };
    if (action === 'open') return { ...result, workbenchUrl: await portal(root, threadId, target.serverUrl) };
    return result;
  }

  amp.registerTool({
    name: 'pmx_canvas_session',
    title: 'PMX Canvas session',
    description:
      'Open/resume the workspace Canvas, inspect status, or explicitly bind/unbind THIS Amp thread to an existing board. Bound PMX MCP tool calls edit that board even when another board is visible. Binding never navigates the shared canvas. Open returns an Amp Portal in orbs. Status is read-only.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['open', 'status', 'bind', 'unbind'] },
        boardId: { type: 'string', description: 'Existing board ID, required for bind.' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    async execute(input, ctx) {
      if (typeof input.action !== 'string' || !['open', 'status', 'bind', 'unbind'].includes(input.action))
        throw new Error('Unknown session action.');
      ctx.signal.throwIfAborted();
      return JSON.stringify(
        await execute(
          input.action,
          ctx.thread.id,
          typeof input.boardId === 'string' ? input.boardId : undefined,
          ctx.signal,
        ),
      );
    },
  });

  for (const action of ['open', 'bind', 'status', 'unbind']) {
    amp.registerCommand(
      action,
      { title: action[0].toUpperCase() + action.slice(1), category: 'PMX Canvas' },
      async (ctx: PluginCommandContext) => {
        if (!ctx.thread) return ctx.ui.notify('Start an Amp thread before using PMX Canvas.');
        let boardId: string | undefined;
        if (action === 'bind') {
          const target = await inspectServer(root, true);
          const catalog = await boards(target.serverUrl);
          if (!catalog.boards.length) return ctx.ui.notify('Create a board in Canvas first.');
          const options = catalog.boards.map((board) => `${board.name} (${board.id})`);
          const selected = await ctx.ui.select({
            title: 'Bind this thread to a board',
            options,
          });
          boardId = selected ? catalog.boards[options.indexOf(selected)]?.id : undefined;
          if (!boardId) return;
        }
        const result = await execute(action, ctx.thread.id, boardId);
        if ('workbenchUrl' in result) {
          // perform was added after the published API types; older clients still receive the URL.
          if (process.env.AMP_ORB && 'perform' in ctx.ui && typeof ctx.ui.perform === 'function') {
            await ctx.ui.perform({ action: 'open-portal', args: { url: result.workbenchUrl } });
          } else if (!process.env.AMP_ORB) await ctx.system.open(result.workbenchUrl);
        }
        await ctx.ui.notify(JSON.stringify(result, null, 2));
      },
    );
  }
}
