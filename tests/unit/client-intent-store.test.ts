import { afterEach, describe, expect, test } from 'bun:test';
import { EVENT_HANDLERS } from '../../src/client/state/sse-bridge.ts';
import { intents, resetIntents, settleIntent, upsertIntent } from '../../src/client/state/intent-store.ts';

describe('ghost intent client store', () => {
  afterEach(() => {
    resetIntents();
  });

  test('settle frames retain the real node id for the render-layer morph', () => {
    upsertIntent({
      id: 'settle-client',
      kind: 'create',
      position: { x: 10, y: 20 },
      createdAt: Date.now(),
      expiresAt: Date.now() + 10_000,
    });

    settleIntent('settle-client', 'node-real');

    expect(intents.value.get('settle-client')).toMatchObject({
      phase: 'settling',
      settledNodeId: 'node-real',
    });
  });

  test('SSE intent handlers form and settle ghosts', () => {
    EVENT_HANDLERS['ax-intent']({
      intent: {
        id: 'sse-client',
        kind: 'create',
        position: { x: 30, y: 40 },
        createdAt: Date.now(),
        expiresAt: Date.now() + 10_000,
      },
    });
    expect(intents.value.get('sse-client')?.phase).toBe('forming');

    EVENT_HANDLERS['ax-intent-clear']({
      id: 'sse-client',
      settled: true,
      nodeId: 'node-sse',
    });
    expect(intents.value.get('sse-client')).toMatchObject({
      phase: 'settling',
      settledNodeId: 'node-sse',
    });
  });
});
