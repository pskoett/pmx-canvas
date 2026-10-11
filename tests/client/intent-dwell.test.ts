import { afterEach, describe, expect, test } from 'bun:test';
import { createElement } from 'preact';
import { cleanup, render } from '@testing-library/preact';
import { IntentLayer } from '../../src/client/canvas/IntentLayer.tsx';
import { nodes } from '../../src/client/state/canvas-store.ts';
import { activeBoardId } from '../../src/client/state/boards-store.ts';
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
  cleanup();
  nodes.value = new Map();
  activeBoardId.value = null;
  for (const id of [...intents.value.keys()]) removeIntent(id);
});

test.each([undefined, 'A', 'B'])('connect ghosts qualify duplicate target ids (%s)', (toBoardId) => {
  activeBoardId.value = 'A';
  nodes.value = new Map(
    ['s', 'x'].map((id) => [
      id,
      {
        id,
        type: 'markdown' as const,
        position: { x: id === 's' ? 0 : 500, y: 0 },
        size: { width: 200, height: 100 },
        zIndex: 1,
        collapsed: false,
        pinned: false,
        data: { title: id },
      },
    ]),
  );
  upsertIntent({
    ...ghost('connect'),
    kind: 'connect',
    edge: {
      from: 's',
      to: 'x',
      type: 'references',
      ...(toBoardId ? { toBoardId } : {}),
    },
  });
  const view = render(createElement(IntentLayer, {}));
  const count = toBoardId === 'B' ? 0 : 1;
  expect(view.container.querySelectorAll('.intent-edge').length).toBe(count);
  expect(view.container.querySelectorAll('.intent-ghost-connect').length).toBe(count);
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
    // A slow renderer may not have finished its CSS animation after 480ms.
    // Only animationend (or the longer hidden-tab backstop) may remove it.
    await new Promise((r) => setTimeout(r, 450));
    expect(intents.value.get('dwell-1')?.phase).toBe('settling');
  });

  test('a dissolve after the floor has already passed plays immediately', async () => {
    upsertIntent(ghost('dwell-2'));
    await new Promise((r) => setTimeout(r, MIN_FORMING_MS + 60));
    dissolveIntent('dwell-2');
    expect(intents.value.get('dwell-2')?.phase).toBe('dissolving');
  });
});
