import type { PluginAPI, PluginCommandContext, ThreadID } from '@ampcode/plugin';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { bind, boards, boundThreadIds, readBinding, unbind } from './binding.js';
import { CanvasDelivery } from './delivery.js';
import { adviceToolSchema } from './jev-advice.js';
import { canonicalWorkspace, inspectServer, portal } from './runtime.js';

export const description =
  'Bind Amp threads to Canvas boards, deliver pinned context, and wake idle threads for addressed steering. Bundles PMX skills and MCP. Interrupted sends remain visible until reconciled.';

export default async function (amp: PluginAPI) {
  if (!amp.system.workspaceRoot) return;
  if (typeof amp.registerSkill !== 'function')
    throw new Error('PMX Canvas requires Amp with directory-plugin skills support. Update Amp.');
  const root = canonicalWorkspace(amp.helpers.filePathFromURI(amp.system.workspaceRoot));
  for (const name of ['pmx-canvas', 'pmx-canvas-testing', 'pmx-canvas-orchestration']) {
    await amp.registerSkill({ path: `skills/${name}` });
  }

  const deliveries = new Map<string, CanvasDelivery>();
  const deliveryErrors = new Map<string, string>();
  const delivery = (threadId: string) => {
    let value = deliveries.get(threadId);
    if (!value) {
      value = new CanvasDelivery(root, threadId);
      deliveries.set(threadId, value);
    }
    return value;
  };
  const existingDelivery = (threadId: string) =>
    deliveries.get(threadId) ??
    (existsSync(join(root, '.pmx-canvas/amp-bindings', `${threadId}.delivery.db`)) ? delivery(threadId) : undefined);
  let disposed = false;
  const timer = setInterval(() => {
    for (const threadId of boundThreadIds(root)) {
      void Promise.resolve()
        .then(() => delivery(threadId).poll(amp.threads.get(threadId as ThreadID)))
        .then(() => {
          deliveryErrors.delete(threadId);
        })
        .catch((error: unknown) => {
          if (disposed) return;
          const message = error instanceof Error ? error.message : 'Canvas delivery failed.';
          if (deliveryErrors.get(threadId) !== message) amp.logger.log(message);
          deliveryErrors.set(threadId, message);
        });
    }
  }, 5000);
  timer.unref();
  amp.onDispose(() => {
    disposed = true;
    clearInterval(timer);
    for (const item of deliveries.values()) item.close();
  });

  amp.on('agent.start', async (event, ctx) => {
    if (existingDelivery(event.thread.id)?.refuseStaleSteering(event.message)) {
      await ctx.thread.cancel();
      return {
        message: {
          content: 'Canvas steering was already completed or its binding changed. This turn was cancelled.',
          display: true,
        },
      };
    }
    const binding = readBinding(root, event.thread.id);
    delivery(event.thread.id).startTurn(event.id);
    if (!binding) {
      return {};
    }
    try {
      return {
        message: {
          content: await delivery(event.thread.id).context(
            event.id,
            event.message,
            typeof amp.ai?.decide === 'function' ? (request) => amp.ai.decide(request) : undefined,
          ),
        },
      };
    } catch (error) {
      return {
        message: {
          content: `Canvas context was not delivered: ${error instanceof Error ? error.message : 'unavailable'}. No read was recorded.`,
          display: true,
        },
      };
    }
  });
  amp.on('agent.end', async (event) => {
    existingDelivery(event.thread.id)?.endTurn(event.id);
  });

  amp.registerCommand('context-ranking', { title: 'Context ranking', category: 'PMX Canvas' }, async (ctx) => {
    if (!ctx.thread) return;
    const binding = readBinding(root, ctx.thread.id);
    if (!binding) return ctx.ui.notify('Bind this thread to a Canvas board first.');
    const store = delivery(ctx.thread.id);
    const enable = !store.rankingEnabled();
    if (
      enable &&
      !(await ctx.ui.confirm({
        title: 'Enable Jev context ranking for this binding?',
        message:
          'At turn start, send up to 2,000 characters of your prompt and up to 20 optional titles/summaries to TypeSafe Jev through Amp. Requests use this thread’s inference billing. Only their order changes; pins, instructions and receipts stay unchanged. Rebinding disables ranking. Run this command again to turn it off.',
        requireHuman: true,
      }))
    )
      return;
    store.setRanking(binding.id, enable);
    await ctx.ui.notify(`Jev context ranking ${enable ? 'enabled' : 'disabled'} for this binding, from the next turn.`);
  });

  amp.registerCommand('jev-advice', { title: 'Jev advice', category: 'PMX Canvas' }, async (ctx) => {
    if (!ctx.thread) return;
    const binding = readBinding(root, ctx.thread.id);
    if (!binding) return ctx.ui.notify('Bind this thread to a Canvas board first.');
    const store = delivery(ctx.thread.id);
    const enable = !store.adviceEnabled();
    if (
      enable &&
      !(await ctx.ui.confirm({
        title: 'Enable on-demand Jev advice for this binding?',
        message:
          'When the agent calls Canvas advice, send its supplied task (up to 2,000 characters) and output summary (up to 12,000) or up to 20 change summaries to TypeSafe Jev through Amp, billed to this thread. Jev suggests an existing output format or review order; it never creates output or verifies changes. This is separate from automatic context ranking. Rebinding disables advice. Run this command again to turn it off.',
        requireHuman: true,
      }))
    )
      return;
    store.setAdvice(binding.id, enable);
    await ctx.ui.notify(`On-demand Jev advice ${enable ? 'enabled' : 'disabled'} for this binding.`);
  });

  amp.registerTool({
    name: 'pmx_canvas_advice',
    title: 'PMX Canvas advice',
    description:
      'Suggest an existing Canvas output format or order supplied source changes for review. On demand only, never creates output, retrieves sources, records reads or verifies work. Supply only facts you already have access to. Always pass explicitFormat when the user specified one; it bypasses inference even with advice off. Jev requires separate human opt-in via PMX Canvas: Jev advice. Reuse requestId and identical input for retries, including after reload; a new logical request needs a new ID. Disabled/unavailable Jev returns Markdown or unchanged review order. Review accepts 1–20 unique change IDs; all are retained. The main agent must create and verify the actual result.',
    inputSchema: {
      ...z.toJSONSchema(adviceToolSchema),
      type: 'object',
      properties: Object.fromEntries(
        Object.entries(adviceToolSchema.shape).map(([key, schema]) => [key, z.toJSONSchema(schema)]),
      ),
    },
    async execute(input, ctx) {
      ctx.signal.throwIfAborted();
      return JSON.stringify(
        await delivery(ctx.thread.id).advise(
          input,
          typeof amp.ai?.decide === 'function' ? (request) => amp.ai.decide(request) : undefined,
          ctx.signal,
        ),
      );
    },
  });

  amp.registerTool({
    name: 'pmx_canvas_delivery',
    title: 'PMX Canvas delivery receipt',
    description:
      'Receive a Canvas delivery using its exact token. A receive records context delivery, not full-content reads or successful actions. Acknowledge steering only after acting and verifying the result. Identity comes from the invoking thread.',
    inputSchema: {
      type: 'object',
      properties: { action: { type: 'string', enum: ['receive', 'acknowledge'] }, token: { type: 'string' } },
      required: ['action', 'token'],
      additionalProperties: false,
    },
    async execute(input, ctx) {
      ctx.signal.throwIfAborted();
      if (typeof input.token !== 'string') throw new Error('A delivery token is required.');
      if (input.action === 'receive') await delivery(ctx.thread.id).receive(input.token, ctx.signal);
      else if (input.action === 'acknowledge') await delivery(ctx.thread.id).acknowledge(input.token, ctx.signal);
      else throw new Error('Unknown receipt action.');
      return JSON.stringify({ ok: true, action: input.action });
    },
  });

  amp.registerCommand(
    'resolve-steering',
    { title: 'Resolve pending steering', category: 'PMX Canvas' },
    async (ctx) => {
      if (!ctx.thread) return;
      const store = delivery(ctx.thread.id);
      await store.reconcile(ctx.thread);
      const options = store.status().map((row) => `${row.state}: ${row.token}`);
      const selected = await ctx.ui.select({ title: 'Pending Canvas steering', options, requireHuman: true });
      if (!selected) return;
      const token = selected.split(': ')[1];
      const action = await ctx.ui.select({
        title: 'Resolve steering',
        options: ['Dismiss without acting', 'Retry uncertain send'],
        requireHuman: true,
      });
      if (!action) return;
      const confirmed = await ctx.ui.confirm({
        title: 'Resolve Canvas steering',
        message:
          action === 'Retry uncertain send'
            ? 'Amp may already have received this instruction. Retrying may duplicate it. Send it again?'
            : 'Dismiss this steering without claiming the action succeeded?',
        requireHuman: true,
      });
      if (!confirmed) return;
      await store.reconcile(ctx.thread);
      if (action === 'Retry uncertain send') store.retry(token);
      else await store.dismiss(token);
    },
  );

  amp.on('tool.call', async (event) => {
    if (!event.tool.startsWith('mcp__pmx_canvas__canvas_')) return { action: 'allow' };
    if (['mcp__pmx_canvas__canvas_help', 'mcp__pmx_canvas__canvas_connect_workspace'].includes(event.tool))
      return { action: 'allow' };
    const binding = readBinding(root, event.thread.id);
    try {
      existingDelivery(event.thread.id)?.assertTurnBinding(binding);
    } catch (error) {
      return { action: 'reject-and-continue', message: String(error) };
    }
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
      deliveries.get(threadId)?.close();
      deliveries.delete(threadId);
      return { binding: null };
    }
    const target = await inspectServer(root, action !== 'status');
    const catalog = await boards(target.serverUrl);
    signal?.throwIfAborted();
    if (action === 'bind') {
      if (!boardId || !catalog.boards.some((board) => board.id === boardId))
        throw new Error('Choose an existing board ID. No board was activated or created.');
      if (
        existingDelivery(threadId)
          ?.status()
          .some((row) => row.board !== boardId)
      )
        throw new Error('Finish or dismiss pending steering on its original board before rebinding.');
      return { ...target, binding: bind(root, threadId, boardId), activeBoardId: catalog.activeBoardId };
    }
    const binding = readBinding(root, threadId);
    const result = {
      ...target,
      binding,
      activeBoardId: catalog.activeBoardId,
      boards: catalog.boards,
      boundBoardExists: binding ? catalog.boards.some((board) => board.id === binding.boardId) : null,
      delivery: { pending: existingDelivery(threadId)?.status() ?? [], error: deliveryErrors.get(threadId) ?? null },
      contextRanking: existingDelivery(threadId)?.rankingEnabled() ? 'jev' : 'off',
      jevAdvice: existingDelivery(threadId)?.adviceEnabled() ? 'jev' : 'off',
      routing:
        'Bound MCP calls retain their board. Context arrives at turn start; addressed steering wakes idle threads while the plugin executor is awake. CLI and MCP resources are not intercepted.',
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
