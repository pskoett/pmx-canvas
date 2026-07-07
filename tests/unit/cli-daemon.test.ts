import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  acquireDaemonLock,
  classifyPrecheck,
  isOwnDaemonProcess,
  processCommandMatches,
  readPidFile,
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
    expect(classifyPrecheck({ responsive: false, workspace: null }, expected)).toBe('not-running');
  });

  test('matching workspace means already running', () => {
    expect(classifyPrecheck({ responsive: true, workspace: '/tmp/pmx-ws-a' }, expected)).toBe('already-running');
  });

  test('different workspace is a port conflict, not a success', () => {
    expect(classifyPrecheck({ responsive: true, workspace: '/tmp/pmx-ws-b' }, expected)).toBe('foreign-port-owner');
  });

  test('a responsive server without a workspace field is foreign', () => {
    expect(classifyPrecheck({ responsive: true, workspace: null }, expected)).toBe('foreign-port-owner');
  });
});

describe('processCommandMatches / isOwnDaemonProcess', () => {
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

describe('acquireDaemonLock', () => {
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
