import { afterEach, describe, expect, test } from 'bun:test';
import {
  MIN_FORMING_MS,
  dissolveIntent,
  intents,
  removeIntent,
  settleIntent,
  upsertIntent,
} from '../../src/client/state/intent-store.ts';

// Minimum dwell: fast agents (and every server auto-ghost) settle within
// milliseconds of signalling — the ghost must hold its forming state for a
// perceptible floor before the settle/dissolve morph plays.

function ghost(id: string) {
  return {
    id,
    kind: 'create' as const,
    label: 'Adding test node',
    createdAt: Date.now(),
    expiresAt: Date.now() + 8000,
  };
}

afterEach(() => {
  for (const id of [...intents.value.keys()]) removeIntent(id);
});

describe('intent minimum dwell', () => {
  test('an instant settle stays forming until the dwell floor, then morphs', async () => {
    upsertIntent(ghost('dwell-1'));
    settleIntent('dwell-1', 'node-real');
    // Immediately after the settle frame the ghost is still forming.
    expect(intents.value.get('dwell-1')?.phase).toBe('forming');
    await new Promise((r) => setTimeout(r, MIN_FORMING_MS + 120));
    expect(intents.value.get('dwell-1')?.phase).toBe('settling');
    expect(intents.value.get('dwell-1')?.settledNodeId).toBe('node-real');
  });

  test('a dissolve after the floor has already passed plays immediately', async () => {
    upsertIntent(ghost('dwell-2'));
    await new Promise((r) => setTimeout(r, MIN_FORMING_MS + 60));
    dissolveIntent('dwell-2');
    expect(intents.value.get('dwell-2')?.phase).toBe('dissolving');
  });
});
