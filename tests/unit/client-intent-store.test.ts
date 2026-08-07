import { afterEach, describe, expect, test } from 'bun:test';
import { EVENT_HANDLERS } from '../../src/client/state/sse-bridge.ts';
import {
  MIN_FORMING_MS,
  intents,
  resetIntents,
  settleIntent,
  upsertIntent,
} from '../../src/client/state/intent-store.ts';

describe('ghost intent client store', () => {
  afterEach(() => {
    resetIntents();
  });

  test('settle frames retain the real node id for the render-layer morph', async () => {
    upsertIntent({
      id: 'settle-client',
      kind: 'create',
      position: { x: 10, y: 20 },
      createdAt: Date.now(),
      expiresAt: Date.now() + 10_000,
    });

    settleIntent('settle-client', 'node-real');

    // Minimum dwell: an instant settle holds the forming state first, then
    // plays the morph with the retained node id.
    expect(intents.value.get('settle-client')?.phase).toBe('forming');
    await new Promise((r) => setTimeout(r, MIN_FORMING_MS + 120));
    expect(intents.value.get('settle-client')).toMatchObject({
      phase: 'settling',
      settledNodeId: 'node-real',
    });
  });

  test('SSE intent handlers form and settle ghosts', async () => {
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
    // Dwell floor first, then the settle morph.
    await new Promise((r) => setTimeout(r, MIN_FORMING_MS + 120));
    expect(intents.value.get('sse-client')).toMatchObject({
      phase: 'settling',
      settledNodeId: 'node-sse',
    });
  });
});
