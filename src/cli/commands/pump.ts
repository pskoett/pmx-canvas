/**
 * `pmx-canvas pump` — the generic reactive steering loop for hosts without a
 * native adapter (Amp, Codex, any CLI agent). Long-polls the per-consumer
 * delivery claim and hands each steer to a shell command; the command's exit
 * code gates the per-consumer mark. This is the same design as the Copilot
 * extension's delivery pump (send-then-mark, awaiting-mark memory, startup
 * backlog watermark, old-server backoff) with the "send into the host" step
 * generalized to "run your command".
 *
 * Safety: the steer text reaches the command as env (PMX_STEER_MESSAGE) and
 * stdin — never spliced into the shell string — so hostile steer content
 * cannot inject into the command line. `{message}` in the template expands to
 * the SHELL VARIABLE reference "$PMX_STEER_MESSAGE" (quoted), not the text.
 */
import { spawn } from 'node:child_process';
import { cmd, die, getBaseUrl, getStringFlag, invokeOperation, parseFlags, requireFlag } from '../shared.js';

interface PendingSteer {
  id: string;
  message: string;
  source?: string | null;
  target?: string | null;
}

async function claimPending(consumer: string, waitMs: number): Promise<{ pending: PendingSteer[]; tookMs: number }> {
  const started = Date.now();
  const url = `${getBaseUrl()}/api/canvas/ax/delivery/pending?consumer=${encodeURIComponent(consumer)}&limit=1&order=oldest${waitMs > 0 ? `&waitMs=${waitMs}` : ''}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(waitMs + 15_000) });
  if (!res.ok) throw new Error(`pending claim failed: HTTP ${res.status}`);
  const body = (await res.json()) as { pending?: PendingSteer[] };
  return { pending: Array.isArray(body.pending) ? body.pending : [], tookMs: Date.now() - started };
}

async function markDelivered(id: string, consumer: string): Promise<boolean> {
  const result = (await invokeOperation('ax.delivery.mark', { id, consumer })) as { delivered?: boolean };
  return result.delivered === true;
}

function runExec(template: string, steer: PendingSteer, consumer: string): Promise<number> {
  const rendered = template.replaceAll('{message}', '"$PMX_STEER_MESSAGE"').replaceAll('{id}', '"$PMX_STEER_ID"');
  return new Promise((resolve) => {
    const child = spawn('sh', ['-c', rendered], {
      stdio: ['pipe', 'inherit', 'inherit'],
      env: {
        ...process.env,
        PMX_STEER_MESSAGE: steer.message,
        PMX_STEER_ID: steer.id,
        PMX_STEER_SOURCE: steer.source ?? '',
        PMX_STEER_CONSUMER: consumer,
      },
    });
    child.stdin.write(steer.message);
    child.stdin.end();
    child.on('close', (code) => resolve(code ?? 1));
    child.on('error', () => resolve(1));
  });
}

async function setPresence(consumer: string, label: string, parent: string | null, patch: Record<string, unknown>) {
  try {
    await invokeOperation('ax.presence.set', {
      source: 'sdk',
      agentId: consumer,
      label,
      ...(parent ? { parentAgentId: parent } : {}),
      ...patch,
    });
  } catch {
    // presence is best-effort — the pump must survive a rolling daemon
  }
}

cmd(
  'pump',
  'Reactive steering loop for CLI agents (Amp, Codex): long-poll claims for a consumer and run a command per steer',
  [
    `pmx-canvas pump --consumer codex --exec 'codex exec --full-auto {message}'`,
    `pmx-canvas pump --consumer amp --exec 'amp -x {message}' --parent claude-code`,
    `pmx-canvas pump --consumer testbot --exec 'cat' --once`,
  ],
  async (args) => {
    const { flags } = parseFlags(args, { boolFlags: ['once'] });
    const consumer = requireFlag(
      flags,
      'consumer',
      `pmx-canvas pump --consumer <key> --exec '<command with {message}>'`,
    );
    const execTemplate = requireFlag(
      flags,
      'exec',
      `pmx-canvas pump --consumer <key> --exec '<command with {message}>'`,
    );
    const once = flags.once === true;
    const waitMsRaw = Number(getStringFlag(flags, 'wait-ms') ?? 120_000);
    const waitMs = Number.isFinite(waitMsRaw) && waitMsRaw >= 0 ? Math.min(waitMsRaw, 120_000) : 120_000;
    const label = getStringFlag(flags, 'label') ?? consumer;
    const parent = getStringFlag(flags, 'parent') ?? null;
    const deliverBacklog = getStringFlag(flags, 'backlog') === 'deliver';
    const retryDelayRaw = Number(getStringFlag(flags, 'retry-delay-ms') ?? 5_000);
    const retryDelayMs = Number.isFinite(retryDelayRaw) && retryDelayRaw >= 0 ? retryDelayRaw : 5_000;

    // Startup watermark: steers queued BEFORE the pump existed are history,
    // not instructions — mark them silently unless --backlog=deliver.
    if (!deliverBacklog) {
      const { pending } = await claimPending(consumer, 0);
      for (const steer of pending) await markDelivered(steer.id, consumer);
      let swept = pending.length;
      // pending is capped at limit=1 — drain the rest.
      while (swept > 0) {
        const next = await claimPending(consumer, 0);
        if (next.pending.length === 0) break;
        for (const steer of next.pending) await markDelivered(steer.id, consumer);
        swept = next.pending.length;
      }
    }

    await setPresence(consumer, label, parent, { phase: 'idle' });
    console.log(`[pump] ${consumer} parked on ${getBaseUrl()} (waitMs=${waitMs}${once ? ', once' : ''})`);

    const awaitingMark = new Set<string>();
    const failures = new Map<string, number>();
    let stopped = false;
    let fastEmpties = 0;
    process.on('SIGINT', () => {
      stopped = true;
      console.log('[pump] stopping');
      process.exit(0);
    });

    while (!stopped) {
      let pending: PendingSteer[];
      let tookMs: number;
      try {
        ({ pending, tookMs } = await claimPending(consumer, waitMs));
      } catch (error) {
        // Daemon roll or network blip: back off and re-park, never exit.
        console.error(`[pump] claim retrying: ${error instanceof Error ? error.message : String(error)}`);
        await new Promise((resolve) => setTimeout(resolve, 10_000));
        continue;
      }
      if (pending.length === 0) {
        // Old-server guard: a 0.4.8 daemon ignores waitMs, returning instantly —
        // without this the loop would spin hot.
        fastEmpties = tookMs < 1_000 ? fastEmpties + 1 : 0;
        if (fastEmpties >= 2) await new Promise((resolve) => setTimeout(resolve, 10_000));
        continue;
      }
      fastEmpties = 0;
      const steer = pending[0]!;

      // Awaiting-mark memory: the exec already ran for this id — a failed mark
      // must not re-run the command (the duplicate-send race).
      if (awaitingMark.has(steer.id)) {
        if (await markDelivered(steer.id, consumer)) awaitingMark.delete(steer.id);
        continue;
      }

      await setPresence(consumer, label, parent, { phase: 'tooling', detail: `steer: ${steer.message.slice(0, 60)}` });
      console.log(`[pump] steer ${steer.id} from ${steer.source ?? '?'}: ${steer.message.slice(0, 120)}`);
      const code = await runExec(execTemplate, steer, consumer);
      if (code === 0) {
        awaitingMark.add(steer.id);
        if (await markDelivered(steer.id, consumer)) awaitingMark.delete(steer.id);
        failures.delete(steer.id);
        await setPresence(consumer, label, parent, { phase: 'idle', detail: null });
        if (once) return;
      } else {
        const count = (failures.get(steer.id) ?? 0) + 1;
        failures.set(steer.id, count);
        console.error(`[pump] exec exited ${code} for ${steer.id} (attempt ${count}/3)`);
        if (count >= 3) {
          // Poison-pill guard: after three failures, mark it so the queue moves on.
          await markDelivered(steer.id, consumer);
          failures.delete(steer.id);
          console.error(`[pump] gave up on ${steer.id} — marked delivered to unblock the queue`);
          if (once) return;
        } else {
          await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
        }
        await setPresence(consumer, label, parent, { phase: 'idle', detail: null });
      }
    }
  },
);
