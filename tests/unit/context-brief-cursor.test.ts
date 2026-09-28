import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { advanceContextBriefCursor, openCanvasDb, readContextBriefCursor } from '../../src/server/canvas-db.ts';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('context brief cursor persistence', () => {
  test('survives restart, is board/consumer scoped, and cannot regress', () => {
    const directory = mkdtempSync(join(tmpdir(), 'pmx-context-cursor-'));
    directories.push(directory);
    const path = join(directory, 'canvas.db');
    let db = openCanvasDb(path);

    expect(readContextBriefCursor(db, 'board-a', 'agent-a')).toBeNull();
    advanceContextBriefCursor(db, 'board-a', 'agent-a', 8);
    advanceContextBriefCursor(db, 'board-a', 'agent-a', 3);
    advanceContextBriefCursor(db, 'board-a', 'agent-b', 2);
    db.close();

    db = openCanvasDb(path);
    expect(readContextBriefCursor(db, 'board-a', 'agent-a')).toBe(8);
    expect(readContextBriefCursor(db, 'board-a', 'agent-b')).toBe(2);
    expect(readContextBriefCursor(db, 'board-b', 'agent-a')).toBeNull();
    db.close();
  });
});
