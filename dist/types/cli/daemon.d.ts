export declare function outputJson(data: unknown): void;
export declare function readPidFile(path: string): number | null;
export declare function isProcessRunning(pid: number): boolean;
/**
 * Whether pid's command line contains `needle`. Returns null when `ps` cannot
 * answer (no such process, unsupported platform) — callers fall back to the
 * plain liveness signal.
 */
export declare function processCommandMatches(pid: number, needle: string): boolean | null;
/**
 * Liveness with a PID-recycling guard: the pid must be alive AND its command
 * line must still look like our daemon (unless `ps` is unavailable, in which
 * case the plain liveness signal wins).
 */
export declare function isOwnDaemonProcess(pid: number, entryNeedle: string): boolean;
export declare function removePidFile(path: string): void;
export interface HealthStatus {
    responsive: boolean;
    workspace: string | null;
}
export declare function readHealthStatus(url: string): Promise<HealthStatus>;
export declare function isHealthy(url: string): Promise<boolean>;
export declare function readLogTail(path: string, maxLines?: number): string | null;
export declare function waitForHealth(healthUrl: string, timeoutMs: number, getExitMessage: () => string | null): Promise<{
    ok: true;
} | {
    ok: false;
    reason: string;
}>;
export declare function waitForShutdown(healthUrl: string, timeoutMs: number, isAlive: () => boolean): Promise<boolean>;
/** Workspace the daemon child will bind — mirrors startCanvasServer's resolution. */
export declare function resolveExpectedWorkspace(): string;
export type PrecheckVerdict = 'not-running' | 'already-running' | 'foreign-port-owner';
/** Pure decision for the pre-spawn health probe. */
export declare function classifyPrecheck(health: HealthStatus, expectedWorkspace: string): PrecheckVerdict;
export type LockResult = {
    ok: true;
} | {
    ok: false;
    holderPid: number | null;
    reason: 'running' | 'starting';
};
/**
 * Exclusive pid-file creation IS the spawn lock. A held file with a live
 * daemon pid means 'running'; a fresh empty file means another starter is
 * mid-spawn ('starting'); anything stale is reclaimed once.
 */
export declare function acquireDaemonLock(pidFile: string, entryNeedle: string): LockResult;
export interface DaemonPaths {
    port: number;
    logFile: string;
    pidFile: string;
}
export declare function startDaemonMode(options: DaemonPaths & {
    baseArgs: string[];
    waitMs: number;
    entry: string;
}): Promise<void>;
export declare function showServeStatus(options: DaemonPaths & {
    entry: string;
}): Promise<void>;
export declare function stopServeDaemon(options: DaemonPaths & {
    waitMs: number;
    entry: string;
}): Promise<void>;
