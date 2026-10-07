#!/usr/bin/env bun
/**
 * Seed the curation-effect eval boards (docs/evals/curation-effect.md) on a running
 * PMX Canvas server, through the real HTTP API:
 *
 *   PMX_CANVAS_URL=http://127.0.0.1:4313 bun run scripts/eval-curation/seed.ts
 *
 * Creates two boards with identical cards in the same order and layout:
 * "<name> (curated)" with `PINNED_KEYS` pinned, and "<name> (uncurated)" with no pins.
 * Neither is left open. Use a scratch workspace or database: the eval must not mix
 * with real boards.
 */

import { BOARD_NAME, CARD_SIZE, CARDS, PINNED_KEYS, cardPosition } from './board.ts';

const BASE = (process.env.PMX_CANVAS_URL ?? 'http://127.0.0.1:4313').replace(/\/$/, '');

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${method} ${path} → HTTP ${response.status}: ${await response.text()}`);
  return (await response.json()) as T;
}

async function seedBoard(name: string, pinned: readonly string[]): Promise<string> {
  const { board } = await call<{ board: { id: string } }>('POST', '/api/canvas/boards', { name });
  const opened = await call<{ activeBoardId: string }>('POST', '/api/canvas/boards/open', { id: board.id });
  if (opened.activeBoardId !== board.id) throw new Error(`Could not open ${name}`);
  const ids = new Map<string, string>();
  for (const [index, card] of CARDS.entries()) {
    const { x, y } = cardPosition(index);
    const { node } = await call<{ node: { id: string } }>('POST', '/api/canvas/node', {
      type: 'markdown',
      title: card.title,
      content: card.content,
      x,
      y,
      width: CARD_SIZE.width,
      height: CARD_SIZE.height,
      strictSize: true,
    });
    ids.set(card.key, node.id);
  }
  if (pinned.length) {
    await call('POST', '/api/canvas/context-pins', {
      nodeIds: pinned.map((key) => ids.get(key)),
      mode: 'add',
      reason: 'what this task rests on',
    });
  }
  return board.id;
}

const curated = await seedBoard(`${BOARD_NAME} (curated)`, PINNED_KEYS);
const uncurated = await seedBoard(`${BOARD_NAME} (uncurated)`, []);
await call('POST', '/api/canvas/boards/open', { id: null });
console.log(JSON.stringify({ ok: true, curated, uncurated, cards: CARDS.length, pinned: PINNED_KEYS }, null, 2));
