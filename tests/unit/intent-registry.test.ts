// Unit tests for the Ghost Cursor of Intent registry — the single trust
// boundary for ephemeral pre-commit intents. Covers zod + per-kind validation,
// the emitted ax-intent / ax-intent-clear frames, settle vs veto vs eviction,
// and the live-intent cap. The registry is a pure in-memory module (no server
// needed); we inject a capturing emitter.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { IntentRegistry } from '../../src/server/intent-registry.ts';
import { MAX_LIVE_INTENTS } from '../../src/shared/ax-intent.ts';

interface Frame { event: string; payload: Record<string, unknown> }

let registry: IntentRegistry;
let frames: Frame[];

beforeEach(() => {
  registry = new IntentRegistry();
  frames = [];
  registry.setEmitter((event, payload) => frames.push({ event, payload }));
});

afterEach(() => {
  registry.reset();
});

function intentOf(frame: Frame): Record<string, unknown> {
  return frame.payload.intent as Record<string, unknown>;
}

describe('IntentRegistry', () => {
  test('signal(create) stores, returns, and emits ax-intent', () => {
    const intent = registry.signal({ kind: 'create', position: { x: 10, y: 20 }, nodeType: 'markdown', label: 'Add note' });
    expect(intent.id).toMatch(/^intent-/);
    expect(intent.kind).toBe('create');
    expect(intent.position).toEqual({ x: 10, y: 20 });
    expect(intent.expiresAt).toBeGreaterThan(intent.createdAt);
    expect(registry.list()).toHaveLength(1);
    expect(frames).toHaveLength(1);
    expect(frames[0]!.event).toBe('ax-intent');
    expect(intentOf(frames[0]!).id).toBe(intent.id);
  });

  test('per-kind validation rejects missing anchors', () => {
    expect(() => registry.signal({ kind: 'create' })).toThrow(/requires a position/);
    expect(() => registry.signal({ kind: 'move', nodeId: 'n1' })).toThrow(/destination position/);
    expect(() => registry.signal({ kind: 'connect' })).toThrow(/requires an edge/);
    expect(() => registry.signal({ kind: 'remove' })).toThrow(/requires a nodeId/);
    expect(() => registry.signal({ kind: 'edit' })).toThrow(/requires a nodeId/);
    expect(registry.list()).toHaveLength(0);
  });

  test('zod rejects an unknown kind and out-of-range confidence', () => {
    expect(() => registry.signal({ kind: 'teleport', position: { x: 0, y: 0 } })).toThrow(/Invalid intent/);
    expect(() => registry.signal({ kind: 'create', position: { x: 0, y: 0 }, confidence: 5 })).toThrow(/Invalid intent/);
  });

  test('signal with an existing id replaces in place and preserves createdAt', () => {
    const first = registry.signal({ id: 'fixed', kind: 'create', position: { x: 0, y: 0 } });
    const second = registry.signal({ id: 'fixed', kind: 'create', position: { x: 5, y: 5 } });
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.position).toEqual({ x: 5, y: 5 });
    expect(registry.list()).toHaveLength(1);
  });

  test('update patches a live intent and re-emits', () => {
    const intent = registry.signal({ kind: 'create', position: { x: 0, y: 0 } });
    frames.length = 0;
    const updated = registry.update(intent.id, { label: 'Renamed', confidence: 0.9 });
    expect(updated.label).toBe('Renamed');
    expect(updated.confidence).toBe(0.9);
    expect(frames[0]!.event).toBe('ax-intent');
  });

  test('update on a missing intent throws 404', () => {
    expect(() => registry.update('nope', { label: 'x' })).toThrow(/No live intent/);
  });

  test('clear with settledNodeId emits a settle frame', () => {
    const intent = registry.signal({ kind: 'create', position: { x: 0, y: 0 } });
    frames.length = 0;
    const cleared = registry.clear(intent.id, { settledNodeId: 'node-7' });
    expect(cleared).toBe(true);
    expect(frames[0]!.event).toBe('ax-intent-clear');
    expect(frames[0]!.payload).toMatchObject({ id: intent.id, nodeId: 'node-7', settled: true });
    expect(registry.list()).toHaveLength(0);
  });

  test('clear with vetoed marks the frame and returns false for unknown ids', () => {
    const intent = registry.signal({ kind: 'remove', nodeId: 'n1' });
    frames.length = 0;
    expect(registry.clear(intent.id, { vetoed: true })).toBe(true);
    expect(frames[0]!.payload).toMatchObject({ id: intent.id, vetoed: true });
    expect(registry.clear('ghost-that-never-was')).toBe(false);
  });

  test('a vetoed intent cannot commit a linked mutation', async () => {
    registry.signal({ id: 'veto-me', kind: 'create', position: { x: 0, y: 0 } });
    expect(registry.clear('veto-me', { vetoed: true })).toBe(true);

    expect(() => registry.signal({
      id: 'veto-me',
      kind: 'create',
      position: { x: 10, y: 10 },
    })).toThrow(/Use a new id for a revised intent/);
    await expect(
      registry.runCommit(
        'veto-me',
        ['create'],
        () => ({ nodeId: 'should-not-exist' }),
        (result) => result.nodeId,
      ),
    ).rejects.toThrow(/was vetoed/);
  });

  test('a committing intent rejects a late veto and settles after mutation', async () => {
    registry.signal({ id: 'commit-me', kind: 'create', position: { x: 0, y: 0 } });
    let releaseMutation: (() => void) | null = null;
    const mutationGate = new Promise<void>((resolve) => {
      releaseMutation = resolve;
    });

    frames.length = 0;
    const commit = registry.runCommit(
      'commit-me',
      ['create'],
      async () => {
        await mutationGate;
        return { nodeId: 'node-committed' };
      },
      (result) => result.nodeId,
    );

    await Bun.sleep(0);
    expect(registry.clear('commit-me', { vetoed: true })).toBe(false);
    releaseMutation?.();
    await expect(commit).resolves.toEqual({ nodeId: 'node-committed' });
    expect(frames.at(-1)).toMatchObject({
      event: 'ax-intent-clear',
      payload: { id: 'commit-me', nodeId: 'node-committed', settled: true },
    });
  });

  test('an intent can back only one in-flight mutation', async () => {
    registry.signal({ id: 'single-commit', kind: 'create', position: { x: 0, y: 0 } });
    let releaseMutation: (() => void) | null = null;
    const mutationGate = new Promise<void>((resolve) => {
      releaseMutation = resolve;
    });
    const firstCommit = registry.runCommit(
      'single-commit',
      ['create'],
      async () => {
        await mutationGate;
        return { nodeId: 'node-first' };
      },
      (result) => result.nodeId,
    );

    await expect(
      registry.runCommit(
        'single-commit',
        ['create'],
        () => ({ nodeId: 'node-second' }),
        (result) => result.nodeId,
      ),
    ).rejects.toThrow(/already committing/);

    releaseMutation?.();
    await expect(firstCommit).resolves.toEqual({ nodeId: 'node-first' });
  });

  test('a linked mutation must match the signalled intent kind', async () => {
    registry.signal({ id: 'wrong-kind', kind: 'remove', nodeId: 'node-1' });
    await expect(
      registry.runCommit(
        'wrong-kind',
        ['create'],
        () => ({ nodeId: 'node-2' }),
        (result) => result.nodeId,
      ),
    ).rejects.toThrow(/cannot commit this mutation/);
    expect(registry.list().some((intent) => intent.id === 'wrong-kind')).toBe(true);
  });

  test('the live-intent cap evicts the oldest and emits an evicted frame', () => {
    for (let i = 0; i < MAX_LIVE_INTENTS; i++) {
      registry.signal({ id: `i${i}`, kind: 'create', position: { x: i, y: i } });
    }
    frames.length = 0;
    registry.signal({ id: 'overflow', kind: 'create', position: { x: 99, y: 99 } });
    expect(registry.list()).toHaveLength(MAX_LIVE_INTENTS);
    const evicted = frames.find((f) => f.event === 'ax-intent-clear' && f.payload.evicted === true);
    expect(evicted?.payload.id).toBe('i0');
    expect(registry.list().some((intent) => intent.id === 'i0')).toBe(false);
  });
});
