/**
 * Daemon lifecycle for `pmx-canvas serve --daemon` / `serve status` / `serve stop`.
 *
 * Invariants:
 * - The pid file doubles as the spawn lock: it is created exclusively BEFORE
 *   the child spawns and holds the child pid immediately after, so a daemon
 *   is addressable by `serve stop` from the moment it exists — even if it
 *   never becomes healthy. A failed startup kills the child and removes the
 *   file: no orphans.
 * - The daemon child binds its requested port strictly (`PmxCanvas.start`
 *   pins `allowPortFallback: false`), so the health URL and the port-keyed
 *   pid/log file names are always accurate.
 * - Pid liveness is cross-checked against the process command line, so a
 *   recycled pid (or an EPERM-protected foreign process) reads as stale
 *   instead of alive.
 * - A responsive /health that reports a different workspace (or none) is a
 *   port conflict, not an "already running" success.
 */
import { execFileSync, spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export function outputJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

export function readPidFile(path: string): number | null {
  try {
    if (!existsSync(path)) return null;
    const raw = readFileSync(path, 'utf-8').trim();
    if (!raw) return null;
    const pid = Number(raw);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

export function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error) {
      return (error as NodeJS.ErrnoException).code === 'EPERM';
    }
    return false;
  }
}

/**
 * Whether pid's command line contains `needle`. Returns null when `ps` cannot
 * answer (no such process, unsupported platform) — callers fall back to the
 * plain liveness signal.
 */
export function processCommandMatches(pid: number, needle: string): boolean | null {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  try {
    const command = execFileSync('ps', ['-o', 'command=', '-p', String(pid)], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (!command) return null;
    return command.includes(needle);
  } catch {
    return null;
  }
}

/**
 * Liveness with a PID-recycling guard: the pid must be alive AND its command
 * line must still look like our daemon (unless `ps` is unavailable, in which
 * case the plain liveness signal wins).
 */
export function isOwnDaemonProcess(pid: number, entryNeedle: string): boolean {
  if (!isProcessRunning(pid)) return false;
  return processCommandMatches(pid, entryNeedle) !== false;
}

export function removePidFile(path: string): void {
  try {
    rmSync(path, { force: true });
  } catch {
    // Ignore cleanup failures for stale pid files.
  }
}

export interface HealthStatus {
  responsive: boolean;
  workspace: string | null;
}

export async function readHealthStatus(url: string): Promise<HealthStatus> {
  try {
    const response = await fetch(url);
    if (!response.ok) return { responsive: false, workspace: null };
    const payload = (await response.json().catch(() => null)) as unknown;
    const workspace =
      payload && typeof payload === 'object' && 'workspace' in payload && typeof payload.workspace === 'string'
        ? payload.workspace
        : null;
    return { responsive: true, workspace };
  } catch {
    return { responsive: false, workspace: null };
  }
}

export async function isHealthy(url: string): Promise<boolean> {
  return (await readHealthStatus(url)).responsive;
}

export function readLogTail(path: string, maxLines = 20): string | null {
  try {
    if (!existsSync(path)) return null;
    const lines = readFileSync(path, 'utf-8').trim().split('\n');
    return lines.slice(-maxLines).join('\n') || null;
  } catch {
    return null;
  }
}

export async function waitForHealth(
  healthUrl: string,
  timeoutMs: number,
  getExitMessage: () => string | null,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isHealthy(healthUrl)) {
      return { ok: true };
    }
    const exitMessage = getExitMessage();
    if (exitMessage) {
      return { ok: false, reason: exitMessage };
    }
    await Bun.sleep(250);
  }
  return { ok: false, reason: `Timed out waiting for ${healthUrl}` };
}

export async function waitForShutdown(healthUrl: string, timeoutMs: number, isAlive: () => boolean): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const responsive = await isHealthy(healthUrl);
    if (!responsive && !isAlive()) {
      return true;
    }
    await Bun.sleep(250);
  }
  return false;
}

/** Workspace the daemon child will bind — mirrors startCanvasServer's resolution. */
export function resolveExpectedWorkspace(): string {
  const env = process.env.PMX_CANVAS_WORKSPACE_ROOT?.trim();
  return resolve(env || process.cwd());
}

export type PrecheckVerdict = 'not-running' | 'already-running' | 'foreign-port-owner';

/** Pure decision for the pre-spawn health probe. */
export function classifyPrecheck(health: HealthStatus, expectedWorkspace: string): PrecheckVerdict {
  if (!health.responsive) return 'not-running';
  if (health.workspace && resolve(health.workspace) === expectedWorkspace) return 'already-running';
  return 'foreign-port-owner';
}

export type LockResult = { ok: true } | { ok: false; holderPid: number | null; reason: 'running' | 'starting' };

/** How long an empty lock file is presumed to belong to a concurrent starter. */
const LOCK_FRESH_MS = 30_000;

/**
 * Exclusive pid-file creation IS the spawn lock. A held file with a live
 * daemon pid means 'running'; a fresh empty file means another starter is
 * mid-spawn ('starting'); anything stale is reclaimed once.
 */
export function acquireDaemonLock(pidFile: string, entryNeedle: string): LockResult {
  mkdirSync(dirname(pidFile), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      closeSync(openSync(pidFile, 'wx'));
      return { ok: true };
    } catch {
      const holderPid = readPidFile(pidFile);
      if (holderPid && isOwnDaemonProcess(holderPid, entryNeedle)) {
        return { ok: false, holderPid, reason: 'running' };
      }
      if (!holderPid && existsSync(pidFile)) {
        try {
          if (Date.now() - statSync(pidFile).mtimeMs < LOCK_FRESH_MS) {
            return { ok: false, holderPid: null, reason: 'starting' };
          }
        } catch {
          return { ok: false, holderPid: null, reason: 'starting' };
        }
      }
      removePidFile(pidFile);
    }
  }
  return { ok: false, holderPid: readPidFile(pidFile), reason: 'starting' };
}

/**
 * True when the pid file is a concurrent starter's spawn lock: an EMPTY file
 * (acquireDaemonLock creates it before writing the child pid) younger than
 * LOCK_FRESH_MS. `serve status` must NOT delete such a file — clearing it
 * mid-spawn would defeat the spawn lock and let a racing starter double-spawn.
 * Mirrors the fresh-lock protection acquireDaemonLock applies. A stat failure
 * biases toward preserving the lock.
 */
export function isFreshEmptyLock(pidFile: string): boolean {
  if (!existsSync(pidFile) || readPidFile(pidFile) !== null) return false;
  try {
    return Date.now() - statSync(pidFile).mtimeMs < LOCK_FRESH_MS;
  } catch {
    return true;
  }
}

export interface DaemonPaths {
  port: number;
  logFile: string;
  pidFile: string;
}

export async function startDaemonMode(
  options: DaemonPaths & {
    baseArgs: string[];
    waitMs: number;
    entry: string;
  },
): Promise<void> {
  const healthUrl = `http://localhost:${options.port}/health`;
  const workbenchUrl = `http://localhost:${options.port}/workbench`;
  const expectedWorkspace = resolveExpectedWorkspace();
  const health = await readHealthStatus(healthUrl);
  const verdict = classifyPrecheck(health, expectedWorkspace);

  if (verdict === 'already-running') {
    outputJson({
      ok: true,
      daemon: true,
      alreadyRunning: true,
      pid: readPidFile(options.pidFile),
      workspace: health.workspace,
      url: workbenchUrl,
      healthUrl,
      logFile: options.logFile,
      pidFile: options.pidFile,
    });
    process.exit(0);
  }

  if (verdict === 'foreign-port-owner') {
    outputJson({
      ok: false,
      daemon: true,
      error: health.workspace
        ? `Port ${options.port} is already serving workspace ${health.workspace}; not attaching.`
        : `Port ${options.port} is already in use by another application; not attaching.`,
      hint: 'Pass --port=<other> for a separate daemon, or stop the process holding this port.',
      url: workbenchUrl,
      healthUrl,
      logFile: options.logFile,
      pidFile: options.pidFile,
    });
    process.exit(1);
  }

  const lock = acquireDaemonLock(options.pidFile, options.entry);
  if (!lock.ok) {
    outputJson({
      ok: false,
      daemon: true,
      error:
        lock.reason === 'running'
          ? `A daemon (pid ${lock.holderPid}) already owns ${options.pidFile}.`
          : `Another \`serve --daemon\` start appears to be in progress (${options.pidFile} is locked).`,
      hint: 'Use `pmx-canvas serve status` / `pmx-canvas serve stop`, or remove the pid file if it is stale.',
      url: workbenchUrl,
      healthUrl,
      logFile: options.logFile,
      pidFile: options.pidFile,
    });
    process.exit(1);
  }

  mkdirSync(dirname(options.logFile), { recursive: true });
  const logFd = openSync(options.logFile, 'a');
  const childArgs = options.baseArgs.includes('--no-open') ? options.baseArgs : [...options.baseArgs, '--no-open'];
  const child = spawn(process.execPath, ['run', options.entry, ...childArgs], {
    cwd: process.cwd(),
    detached: true,
    env: process.env,
    stdio: ['ignore', logFd, logFd],
  });

  // The pid lands in the lock file immediately: the daemon must be stoppable
  // via `serve stop` even if it never becomes healthy.
  writeFileSync(options.pidFile, `${child.pid}\n`, 'utf-8');

  let exitMessage: string | null = null;
  child.once('exit', (code, signal) => {
    exitMessage = signal ? `Daemon exited via signal ${signal}` : `Daemon exited with code ${code ?? 'unknown'}`;
  });
  child.unref();

  const healthResult = await waitForHealth(healthUrl, options.waitMs, () => exitMessage);
  if (!healthResult.ok) {
    if (child.pid && !exitMessage) {
      try {
        process.kill(child.pid, 'SIGTERM');
      } catch {
        // The child exited between the health timeout and the kill.
      }
    }
    removePidFile(options.pidFile);
    const logTail = readLogTail(options.logFile);
    const details = logTail ? `${healthResult.reason}\n\nRecent log output:\n${logTail}` : healthResult.reason;
    console.error(details);
    process.exit(1);
  }

  outputJson({
    ok: true,
    daemon: true,
    pid: child.pid,
    workspace: expectedWorkspace,
    url: workbenchUrl,
    healthUrl,
    logFile: options.logFile,
    pidFile: options.pidFile,
  });
  process.exit(0);
}

export async function showServeStatus(options: DaemonPaths & { entry: string }): Promise<void> {
  const healthUrl = `http://localhost:${options.port}/health`;
  const url = `http://localhost:${options.port}/workbench`;
  const pid = readPidFile(options.pidFile);
  const pidRunning = pid ? isOwnDaemonProcess(pid, options.entry) : false;
  const health = await readHealthStatus(healthUrl);
  const responsive = health.responsive;
  const running = responsive || pidRunning;
  // Clean up a stale pid file, but never a concurrent starter's fresh empty
  // spawn lock (that would let a racing `serve --daemon` double-spawn).
  if (!running && existsSync(options.pidFile) && !pidRunning && !isFreshEmptyLock(options.pidFile)) {
    removePidFile(options.pidFile);
  }

  outputJson({
    ok: true,
    daemon: true,
    running,
    responsive,
    workspace: health.workspace,
    pid,
    pidRunning,
    url,
    healthUrl,
    logFile: options.logFile,
    pidFile: options.pidFile,
    pidFileExists: existsSync(options.pidFile),
  });
  process.exit(0);
}

export async function stopServeDaemon(
  options: DaemonPaths & {
    waitMs: number;
    entry: string;
  },
): Promise<void> {
  const healthUrl = `http://localhost:${options.port}/health`;
  const url = `http://localhost:${options.port}/workbench`;
  const pid = readPidFile(options.pidFile);
  const responsive = await isHealthy(healthUrl);

  if (!pid) {
    if (!responsive) {
      removePidFile(options.pidFile);
      outputJson({
        ok: true,
        daemon: true,
        stopped: false,
        running: false,
        reason: 'No running daemon found.',
        url,
        healthUrl,
        logFile: options.logFile,
        pidFile: options.pidFile,
      });
      process.exit(0);
    }

    outputJson({
      ok: false,
      daemon: true,
      error: `Server on port ${options.port} is responsive, but no pid file was found at ${options.pidFile}.`,
      hint: 'Restart with `pmx-canvas serve --daemon` or provide the correct --pid-file.',
      url,
      healthUrl,
      logFile: options.logFile,
      pidFile: options.pidFile,
    });
    process.exit(1);
  }

  if (!isOwnDaemonProcess(pid, options.entry)) {
    removePidFile(options.pidFile);
    outputJson({
      ok: true,
      daemon: true,
      stopped: false,
      running: responsive,
      reason: `Removed stale pid file for ${pid}.`,
      pid,
      url,
      healthUrl,
      logFile: options.logFile,
      pidFile: options.pidFile,
    });
    process.exit(0);
  }

  process.kill(pid, 'SIGTERM');
  const stopped = await waitForShutdown(healthUrl, options.waitMs, () => isOwnDaemonProcess(pid, options.entry));
  const stillResponsive = await isHealthy(healthUrl);
  const pidRunning = isOwnDaemonProcess(pid, options.entry);
  if (stopped || (!stillResponsive && !pidRunning)) {
    removePidFile(options.pidFile);
    outputJson({
      ok: true,
      daemon: true,
      stopped: true,
      pid,
      url,
      healthUrl,
      logFile: options.logFile,
      pidFile: options.pidFile,
    });
    process.exit(0);
  }

  outputJson({
    ok: false,
    daemon: true,
    stopped: false,
    error: `Timed out waiting for daemon ${pid} to stop.`,
    pid,
    responsive: stillResponsive,
    pidRunning,
    url,
    healthUrl,
    logFile: options.logFile,
    pidFile: options.pidFile,
  });
  process.exit(1);
}
