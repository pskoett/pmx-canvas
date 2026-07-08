import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  acquireDaemonLock,
  classifyPrecheck,
  isFreshEmptyLock,
  isOwnDaemonProcess,
  processCommandMatches,
  readPidFile,
  resolveDaemonPidView,
} from '../../src/cli/daemon.ts';

function tempPidFile(): string {
  return join(mkdtempSync(join(tmpdir(), 'pmx-daemon-test-')), 'daemon.pid');
}

/** Pid of a process that has already exited. */
function exitedPid(): number {
  const child = spawnSync(process.execPath, ['--version'], { stdio: 'ignore' });
  if (!child.pid) throw new Error('spawnSync returned no pid');
  return child.pid;
}

describe('readPidFile', () => {
  test('returns null for a missing file', () => {
    expect(readPidFile(join(tmpdir(), 'pmx-daemon-test-does-not-exist.pid'))).toBeNull();
  });

  test('returns null for garbage and non-positive values', () => {
    const path = tempPidFile();
    writeFileSync(path, 'not-a-pid\n');
    expect(readPidFile(path)).toBeNull();
    writeFileSync(path, '-4\n');
    expect(readPidFile(path)).toBeNull();
    writeFileSync(path, '0\n');
    expect(readPidFile(path)).toBeNull();
  });

  test('parses a valid pid', () => {
    const path = tempPidFile();
    writeFileSync(path, '12345\n');
    expect(readPidFile(path)).toBe(12345);
  });
});

describe('classifyPrecheck', () => {
  const expected = resolve('/tmp/pmx-ws-a');

  test('unresponsive health means not running', () => {
    expect(classifyPrecheck({ responsive: false, workspace: null, pid: null }, expected)).toBe('not-running');
  });

  test('matching workspace means already running', () => {
    expect(classifyPrecheck({ responsive: true, workspace: '/tmp/pmx-ws-a', pid: null }, expected)).toBe(
      'already-running',
    );
  });

  test('different workspace is a port conflict, not a success', () => {
    expect(classifyPrecheck({ responsive: true, workspace: '/tmp/pmx-ws-b', pid: null }, expected)).toBe(
      'foreign-port-owner',
    );
  });

  test('a responsive server without a workspace field is foreign', () => {
    expect(classifyPrecheck({ responsive: true, workspace: null, pid: null }, expected)).toBe('foreign-port-owner');
  });
});

describe('resolveDaemonPidView (0.3.2 report Finding P)', () => {
  test('adapter respawn: responsive server + dead pid-file pid reports the real listener and marks the file stale', () => {
    // The report's exact scenario: pid file says 57638 (dead), port 4313 is
    // actually served by 4947. `running: true, pidRunning: false` read as a
    // contradiction — the view must name the real pid and flag the stale file.
    const view = resolveDaemonPidView(57638, false, { responsive: true, workspace: '/ws', pid: 4947 });
    expect(view).toEqual({ pid: 4947, pidRunning: true, pidFileStale: true });
  });

  test('healthy serve --daemon: file pid matches the serving pid, nothing stale', () => {
    const view = resolveDaemonPidView(4947, true, { responsive: true, workspace: '/ws', pid: 4947 });
    expect(view).toEqual({ pid: 4947, pidRunning: true, pidFileStale: false });
  });

  test('not responsive + dead file pid: stale file, no invented pid', () => {
    const view = resolveDaemonPidView(57638, false, { responsive: false, workspace: null, pid: null });
    expect(view).toEqual({ pid: 57638, pidRunning: false, pidFileStale: true });
  });

  test('pre-0.3.3 server without a health pid falls back to the pid-file view', () => {
    const view = resolveDaemonPidView(57638, false, { responsive: true, workspace: '/ws', pid: null });
    expect(view).toEqual({ pid: 57638, pidRunning: false, pidFileStale: true });
  });

  test('no pid file at all: health pid is authoritative and nothing is stale', () => {
    const view = resolveDaemonPidView(null, false, { responsive: true, workspace: '/ws', pid: 4947 });
    expect(view).toEqual({ pid: 4947, pidRunning: true, pidFileStale: false });
  });
});

// Daemon liveness is checked via `ps` command-line matching — POSIX-only, like
// the daemon flow itself. No `ps` on Windows runners.
describe.skipIf(process.platform === 'win32')('processCommandMatches / isOwnDaemonProcess', () => {
  test('matches the current process command line', () => {
    expect(processCommandMatches(process.pid, 'bun')).toBe(true);
  });

  test('rejects a needle absent from the command line', () => {
    expect(processCommandMatches(process.pid, 'pmx-improbable-needle-xyz')).toBe(false);
  });

  test('returns null for an exited pid', () => {
    expect(processCommandMatches(exitedPid(), 'bun')).toBeNull();
  });

  test('a live pid with a mismatched command is NOT our daemon (pid-recycling guard)', () => {
    expect(isOwnDaemonProcess(process.pid, 'pmx-improbable-needle-xyz')).toBe(false);
  });

  test('a live pid with a matching command is our daemon', () => {
    expect(isOwnDaemonProcess(process.pid, 'bun')).toBe(true);
  });

  test('an exited pid is not our daemon', () => {
    expect(isOwnDaemonProcess(exitedPid(), 'bun')).toBe(false);
  });
});

describe.skipIf(process.platform === 'win32')('acquireDaemonLock', () => {
  test('acquires a fresh lock and leaves the (empty) lock file in place', () => {
    const path = tempPidFile();
    const result = acquireDaemonLock(path, 'bun');
    expect(result.ok).toBe(true);
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path, 'utf-8')).toBe('');
  });

  test('refuses when a live daemon holds the lock', () => {
    const path = tempPidFile();
    writeFileSync(path, `${process.pid}\n`);
    const result = acquireDaemonLock(path, 'bun');
    expect(result).toEqual({ ok: false, holderPid: process.pid, reason: 'running' });
  });

  test('reclaims a lock held by a dead pid', () => {
    const path = tempPidFile();
    writeFileSync(path, `${exitedPid()}\n`);
    expect(acquireDaemonLock(path, 'bun').ok).toBe(true);
  });

  test('reclaims a lock whose pid was recycled by a different command', () => {
    const path = tempPidFile();
    writeFileSync(path, `${process.pid}\n`);
    expect(acquireDaemonLock(path, 'pmx-improbable-needle-xyz').ok).toBe(true);
  });

  test('treats a fresh empty lock file as a concurrent start in progress', () => {
    const path = tempPidFile();
    writeFileSync(path, '');
    const result = acquireDaemonLock(path, 'bun');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('starting');
  });

  test('reclaims a stale empty lock file', () => {
    const path = tempPidFile();
    writeFileSync(path, '');
    const staleTime = new Date(Date.now() - 60_000);
    utimesSync(path, staleTime, staleTime);
    expect(acquireDaemonLock(path, 'bun').ok).toBe(true);
  });
});

describe('isFreshEmptyLock', () => {
  test('a missing file is not a fresh lock', () => {
    expect(isFreshEmptyLock(join(tmpdir(), 'pmx-daemon-test-absent.pid'))).toBe(false);
  });

  test('a fresh empty file is a concurrent starter lock — must be preserved', () => {
    const path = tempPidFile();
    writeFileSync(path, '');
    expect(isFreshEmptyLock(path)).toBe(true);
  });

  test('a stale empty file is not a fresh lock — safe to reclaim', () => {
    const path = tempPidFile();
    writeFileSync(path, '');
    const staleTime = new Date(Date.now() - 60_000);
    utimesSync(path, staleTime, staleTime);
    expect(isFreshEmptyLock(path)).toBe(false);
  });

  test('a file holding a pid is not an empty lock — status may clean it up', () => {
    const path = tempPidFile();
    writeFileSync(path, `${exitedPid()}\n`);
    expect(isFreshEmptyLock(path)).toBe(false);
  });
});
