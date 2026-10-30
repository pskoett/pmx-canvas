import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canvasState } from '../src/server/canvas-state.js';
import { executeOperation } from '../src/server/operations/index.js';
import type { LifecycleResults } from '../src/server/knowledge-lifecycle.js';

// Same populated workload before/after: bun run scripts/benchmark-lifecycle.ts
// Setup is excluded; no server, browser, or persistent user workspace is touched.
const root = mkdtempSync(join(tmpdir(), 'pmx-lifecycle-benchmark-'));
const boards = 12;
const cardsPerBoard = 24;
const reviewsPerCard = 32;
const samples = 20;
const warmup = 5;
const originalRead = canvasState.readBoard.bind(canvasState);
const originalReviews = canvasState.knowledge.reviews.bind(canvasState.knowledge);
let boardReads = 0;
let historyRecords = 0;
const previousDatabase = process.env.PMX_CANVAS_DB_PATH;
try {
  process.env.PMX_CANVAS_DB_PATH = join(root, 'canvas.db');
  canvasState.setWorkspaceRoot(root);
  canvasState.loadFromDisk();
  const targets: Array<{ boardId: string; cardId: string; revision: number }> = [];
  for (let b = 0; b < boards; b++) {
    const board = canvasState.createBoard(`Board ${b}`, `Library/${b % 3}`)!;
    canvasState.switchBoard(board.id);
    for (let c = 0; c < cardsPerBoard; c++) {
      const id = `card-${c}`;
      canvasState.addNode({
        id,
        type: 'markdown',
        position: { x: c * 400, y: 0 },
        size: { width: 360, height: 240 },
        zIndex: c,
        data: { title: `Card ${c}`, content: 'Populated benchmark content. '.repeat(40) },
      });
      targets.push({ boardId: board.id, cardId: id, revision: canvasState.getNode(id)!.contentRevision! });
    }
  }
  canvasState.flushToDisk();
  const db = new Database(canvasState.databasePath!);
  const insert = db.query('INSERT INTO review_records (board_id, node_id, value) VALUES (?, ?, ?)');
  db.transaction(() => {
    for (const target of targets)
      for (let r = 0; r < reviewsPerCard; r++)
        insert.run(
          target.boardId,
          target.cardId,
          JSON.stringify({
            id: `${target.boardId}-${target.cardId}-${r}`,
            boardId: target.boardId,
            nodeId: target.cardId,
            outcome: r % 4 === 0 ? 'retain' : 'unresolved',
            applied: r % 4 === 0,
            evidence: `Evidence ${r}: ${'Primary observation. '.repeat(30)}`,
            who: { actor: 'human', source: 'workbench' },
            when: '2026-01-01T00:00:00.000Z',
            contentRevision: target.revision,
          }),
        );
  })();
  db.close();
  canvasState.readBoard = (...args) => {
    boardReads++;
    return originalRead(...args);
  };
  canvasState.knowledge.reviews = (...args) => {
    const result = originalReviews(...args);
    historyRecords += result.records.length;
    return result;
  };
  const target = targets[0];
  const run = async () => {
    const value = (await executeOperation('node.lifecycle-get', {
      board: target.boardId,
      id: target.cardId,
    })) as LifecycleResults['get'];
    if (
      value.records.length !== reviewsPerCard ||
      value.qualification.due ||
      value.lastValidation?.outcome !== 'retain'
    )
      throw new Error('Qualification/history correctness check failed.');
  };
  const coldStart = performance.now();
  await run();
  const coldMs = performance.now() - coldStart;
  for (let i = 0; i < warmup; i++) await run();
  boardReads = 0;
  historyRecords = 0;
  const milliseconds: number[] = [];
  for (let i = 0; i < samples; i++) {
    const start = performance.now();
    await run();
    milliseconds.push(performance.now() - start);
  }
  milliseconds.sort((a, b) => a - b);
  console.log(
    JSON.stringify(
      {
        boards,
        cardsPerBoard,
        reviewsPerCard,
        records: boards * cardsPerBoard * reviewsPerCard,
        warmup,
        samples,
        coldMs,
        medianMs: milliseconds[Math.floor(samples / 2)],
        minMs: milliseconds[0],
        maxMs: milliseconds.at(-1),
        boardReadsPerRequest: boardReads / samples,
        fullHistoryRecordsPerRequest: historyRecords / samples,
      },
      null,
      2,
    ),
  );
} finally {
  canvasState.readBoard = originalRead;
  canvasState.knowledge.reviews = originalReviews;
  canvasState.close();
  if (previousDatabase === undefined) delete process.env.PMX_CANVAS_DB_PATH;
  else process.env.PMX_CANVAS_DB_PATH = previousDatabase;
  rmSync(root, { recursive: true, force: true });
}
