import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { Database } from 'bun:sqlite';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  appendAxSteeringToDB,
  BROADCAST_PENDING_TTL_MS,
  loadPendingAxSteeringFromDB,
  markAxSteeringDeliveredInDB,
  openCanvasDb,
} from '../../src/server/canvas-db.js';
import { removeTempDirWithRetry } from './helpers.js';

describe('broadcast pending TTL', () => {
  let dir = '';
  let db: Database;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pmx-steer-ttl-'));
    db = openCanvasDb(join(dir, 'canvas.db'));
  });

  afterEach(() => {
    db.close();
    removeTempDirWithRetry(dir);
  });

  function add(id: string, message: string, target: string | null, ageMs: number): void {
    appendAxSteeringToDB(db, {
      id,
      message,
      delivered: false,
      createdAt: new Date(Date.now() - ageMs).toISOString(),
      source: 'browser',
      agentId: null,
      target,
    });
  }

  test('an addressed steer is markable only by its target, not by another consumer', () => {
    add('s1', 'bob: refactor', 'bob', 0);
    // eve tries to swallow bob's instruction — refused, steer stays pending for bob.
    expect(markAxSteeringDeliveredInDB(db, 's1', 'eve')).toBe(false);
    expect(loadPendingAxSteeringFromDB(db, { consumer: 'bob' }).some((m) => m.id === 's1')).toBe(true);
    // bob (the target) marks it — delivered, and gone from bob's queue.
    expect(markAxSteeringDeliveredInDB(db, 's1', 'bob')).toBe(true);
    expect(loadPendingAxSteeringFromDB(db, { consumer: 'bob' }).some((m) => m.id === 's1')).toBe(false);
  });

  test('stale broadcasts stop greeting new consumers; addressed steers wait forever', () => {
    add('steer-old-bcast', 'ancient all-hands', null, BROADCAST_PENDING_TTL_MS + 60_000);
    add('steer-new-bcast', 'fresh all-hands', null, 1_000);
    add('steer-old-addressed', 'old but addressed', 'worker-9', BROADCAST_PENDING_TTL_MS + 60_000);

    const pending = loadPendingAxSteeringFromDB(db, { consumer: 'worker-9', limit: 10 });
    const ids = pending.map((entry) => entry.id);
    // The ancient broadcast has aged out of PENDING (it stays on the timeline)…
    expect(ids).not.toContain('steer-old-bcast');
    // …the fresh broadcast and the addressed steer are live.
    expect(ids).toContain('steer-new-bcast');
    expect(ids).toContain('steer-old-addressed');

    // Consumer-less claims (anonymous viewers) also skip stale broadcasts.
    const anonymous = loadPendingAxSteeringFromDB(db, { limit: 10 });
    expect(anonymous.map((entry) => entry.id)).toEqual(['steer-new-bcast']);
  });
});
