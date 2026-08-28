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
 * On Windows that guarantee does not hold — cmd.exe expands `%VAR%` and then
 * re-parses the result — so the placeholders are refused there and the command
 * takes the message from stdin instead. See `renderExecTemplate`.
 */
import { spawn } from 'node:child_process';
import { cmd, getBaseUrl, getStringFlag, invokeOperation, parseFlags, requireFlag } from '../shared.js';

interface PendingSteer {
  id: string;
  message: string;
  source?: string | null;
  target?: string | null;
  createdAt?: string | null;
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

/**
 * Windows has no `sh`, so the exec ran nowhere there. cmd.exe can host the
 * stdin pattern, but NOT the `{message}` / `{id}` placeholders: those expand to
 * an env-var reference so hostile steer content is never spliced into the
 * command string, and cmd.exe expands `%VAR%` before re-parsing — a message
 * containing `& del …` would run. Refuse the placeholders there instead of
 * silently reintroducing the injection the substitution exists to prevent.
 */
export function renderExecTemplate(template: string, windows = process.platform === 'win32'): string {
  if (windows) {
    if (template.includes('{message}') || template.includes('{id}')) {
      throw new Error(
        'pmx-canvas pump: {message} and {id} are not supported on Windows — cmd.exe re-parses expanded variables, so a steer could inject commands. Read the message from stdin instead (the exec receives it), or use the PMX_STEER_MESSAGE / PMX_STEER_ID environment variables inside your own script.',
      );
    }
    return template;
  }
  return template.replaceAll('{message}', '"$PMX_STEER_MESSAGE"').replaceAll('{id}', '"$PMX_STEER_ID"');
}

function runExec(template: string, steer: PendingSteer, consumer: string): Promise<number> {
  const rendered = renderExecTemplate(template);
  return new Promise((resolve) => {
    // `shell: true` picks sh on POSIX and ComSpec/cmd.exe on Windows, and sets
    // windowsVerbatimArguments itself — hand-rolling the cmd.exe form escaped
    // the quotes inside the command, so `bun "C:\path\x.mjs"` arrived as
    // `""C:\path\x.mjs""`. Let Node own the platform quoting.
    const child = spawn(rendered, {
      shell: true,
      stdio: ['pipe', 'inherit', 'inherit'],
      env: {
        ...process.env,
        PMX_STEER_MESSAGE: steer.message,
        PMX_STEER_ID: steer.id,
        PMX_STEER_SOURCE: steer.source ?? '',
        // Delivery envelope (round-2 review): the command can tell the host
        // WHO steered, whether it was addressed or a broadcast, and how old
        // the steer is — without re-querying the board.
        PMX_STEER_TARGET: steer.target ?? 'ALL',
        PMX_STEER_CREATED_AT: steer.createdAt ?? '',
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

/**
 * Settle back to idle ONLY when the visible phase is still the pump's own
 * `tooling` marker. The host the pump feeds may have set a richer explicit
 * phase (thinking, waiting-approval) while handling the steer — an
 * unconditional idle stomped it and active work read as Idle (0.5.0
 * readiness, Copilot finding).
 */
async function settlePresence(consumer: string, label: string, parent: string | null): Promise<void> {
  try {
    const res = await fetch(`${getBaseUrl()}/api/canvas/ax/presence`, { signal: AbortSignal.timeout(5_000) });
    if (res.ok) {
      const body = (await res.json()) as {
        presences?: Array<{ sessionId?: string; phase?: string; detail?: string | null }>;
      };
      const own = body.presences?.find((p) => p.sessionId === consumer);
      const ownToolingMarker = own?.phase === 'tooling' && (own.detail ?? '').startsWith('steer: ');
      if (own && !ownToolingMarker && own.phase !== 'idle') return; // richer phase belongs to the host
    }
  } catch {
    // presence read failed — fall through and settle; better idle than stuck tooling
  }
  await setPresence(consumer, label, parent, { phase: 'idle', detail: null });
}

cmd(
  'pump',
  'Reactive steering loop for CLI agents (Amp, Codex CLI): long-poll claims for a consumer and run a command per steer',
  [
    `pmx-canvas pump --consumer codex-cli --exec 'codex exec --full-auto {message}'`,
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

    // Park via the guard: a pump RESTART while its host is mid-work must not
    // knock an explicit phase back to idle either.
    await settlePresence(consumer, label, parent);
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
      const age = steer.createdAt
        ? `, age ${Math.max(0, Math.round((Date.now() - Date.parse(steer.createdAt)) / 1000))}s`
        : '';
      console.log(
        `[pump] steer ${steer.id} from ${steer.source ?? '?'} → ${steer.target ?? 'ALL'}${age}: ${steer.message.slice(0, 120)}`,
      );
      const code = await runExec(execTemplate, steer, consumer);
      if (code === 0) {
        awaitingMark.add(steer.id);
        if (await markDelivered(steer.id, consumer)) awaitingMark.delete(steer.id);
        failures.delete(steer.id);
        await settlePresence(consumer, label, parent);
        if (once) return;
      } else {
        const count = (failures.get(steer.id) ?? 0) + 1;
        failures.set(steer.id, count);
        console.error(`[pump] exec exited ${code} for ${steer.id} (attempt ${count}/3)`);
        if (count >= 3) {
          // A failed host injection is still pending work; only successful execs may mark delivery.
          failures.delete(steer.id);
          console.error(`[pump] stopped after three failures for ${steer.id} — steer remains pending`);
          await setPresence(consumer, label, parent, {
            phase: 'idle',
            detail: `delivery failed: ${steer.id} remains pending`,
          });
          throw new Error(`Pump delivery failed three times for ${steer.id}; steer remains pending.`);
        } else {
          await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
        }
        await settlePresence(consumer, label, parent);
      }
    }
  },
);
