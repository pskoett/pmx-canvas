import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gcBlobsInDB, openCanvasDb, readBlobFromDB, writeBlobToDB } from '../../src/server/canvas-db.js';

// Blobs are content-addressed and written with INSERT OR IGNORE, so editing a
// blob-backed field supersedes the old blob and orphans it. Nothing reclaimed
// them, which grows canvas.db — a git-committable file — without bound.

let dir: string;
let db: Database;

const sha = (n: string) => n.repeat(64).slice(0, 64);
const LIVE = sha('a');
const SNAP = sha('b');
const ORPHAN = sha('c');

function ref(hash: string): string {
  return JSON.stringify({
    html: { __pmxCanvasBlob: 'v1', path: `blobs/${hash}`, sha256: hash, bytes: 10, jsonBytes: 20 },
  });
}

let nodeSeq = 0;
function addNodeRow(data: string): void {
  nodeSeq += 1;
  db.run(
    `INSERT INTO nodes (id, type, pos_x, pos_y, width, height, z_index, collapsed, pinned, dock_position, data)
     VALUES (?, 'mcp-app', 0, 0, 100, 100, 0, 0, 0, NULL, ?)`,
    [`node-${nodeSeq}`, data],
  );
}

beforeEach(() => {
  nodeSeq = 0;
  dir = mkdtempSync(join(tmpdir(), 'pmx-gc-'));
  db = openCanvasDb(join(dir, 'canvas.db'));
  for (const hash of [LIVE, SNAP, ORPHAN]) writeBlobToDB(db, hash, `{"payload":"${hash}"}`);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function blobCount(): number {
  return db.query<{ c: number }, []>('SELECT COUNT(*) AS c FROM blobs').get()?.c ?? 0;
}

describe('gcBlobsInDB', () => {
  test('reclaims only blobs nothing references', () => {
    addNodeRow(ref(LIVE));
    expect(blobCount()).toBe(3);
    expect(gcBlobsInDB(db)).toBe(2);
    expect(blobCount()).toBe(1);
    expect(readBlobFromDB(db, LIVE)).toBeTruthy();
    expect(readBlobFromDB(db, ORPHAN)).toBeNull();
  });

  test('never reclaims a blob a snapshot still needs', () => {
    addNodeRow(ref(LIVE));
    db.run(
      `INSERT INTO snapshot_nodes (snapshot_id, id, type, pos_x, pos_y, width, height, z_index, collapsed, pinned, dock_position, data)
       VALUES ('snap-1', 'n-snap', 'mcp-app', 0, 0, 100, 100, 0, 0, 0, NULL, ?)`,
      [ref(SNAP)],
    );
    // The snapshot holds the ONLY reference to SNAP — restoring it must still work.
    expect(gcBlobsInDB(db)).toBe(1);
    expect(readBlobFromDB(db, SNAP)).toBeTruthy();
    expect(readBlobFromDB(db, LIVE)).toBeTruthy();
    expect(readBlobFromDB(db, ORPHAN)).toBeNull();
  });

  test('is a no-op when every blob is referenced', () => {
    addNodeRow(ref(LIVE));
    addNodeRow(ref(SNAP));
    addNodeRow(ref(ORPHAN));
    expect(gcBlobsInDB(db)).toBe(0);
    expect(blobCount()).toBe(3);
  });

  test('reclaims a body superseded by an edit', () => {
    addNodeRow(ref(LIVE));
    expect(gcBlobsInDB(db)).toBe(2);
    // The node's body is edited: its row now points at a brand-new blob.
    const edited = sha('d');
    writeBlobToDB(db, edited, '{"payload":"edited"}');
    db.run('UPDATE nodes SET data = ?', [ref(edited)]);
    expect(gcBlobsInDB(db)).toBe(1);
    expect(readBlobFromDB(db, edited)).toBeTruthy();
    expect(readBlobFromDB(db, LIVE)).toBeNull();
  });
});
