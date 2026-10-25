import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { applyBoards, connectBoardCatalog } from '../../src/client/state/boards-store';
import { viewport } from '../../src/client/state/canvas-store';
import {
  applyTourExit,
  applyTourStep,
  dismissPresentation,
  endPresentation,
  presenting,
  presentationCursor,
  presentationError,
  startPresentation,
  stepTour,
} from '../../src/client/state/presentation';

let epoch = '';
let run = 0;
const step = (sequence: number, index: number) => ({
  ok: true,
  sequence,
  catalogEpoch: epoch,
  boardGeneration: 1,
  index,
  total: 3,
  stop: { target: { viewport: { x: 100 * index, y: 0, scale: 1 } }, duration: 0 },
});
beforeEach(() => {
  epoch = `ordered-tour-${++run}`;
  connectBoardCatalog(epoch);
  applyBoards({
    catalogEpoch: epoch,
    catalogRevision: 1,
    boardGeneration: 1,
    reloadRevision: 0,
    boards: [],
    activeBoardId: null,
  });
  presenting.value = true;
});
afterEach(dismissPresentation);

test('an unresolved exit cannot block a new local presentation', async () => {
  let finishExit!: (response: Response) => void;
  const fetch = spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(
      (input: string | URL | Request) => {
        if (String(input).endsWith('/tour/exit'))
          return new Promise<Response>((resolve) => {
            finishExit = resolve;
          });
        return Promise.resolve(Response.json(step(1, 0)));
      },
      { preconnect: globalThis.fetch.preconnect },
    ),
  );
  let restarted: Promise<void> | undefined;
  try {
    endPresentation();
    await new Promise((resolve) => setTimeout(resolve, 0));
    restarted = startPresentation();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(presenting.value).toBe(true);
    expect(presentationCursor.value).toEqual({ index: 0, total: 3 });
  } finally {
    finishExit(Response.json({ ok: true, superseded: true }));
    await restarted;
    fetch.mockRestore();
  }
});

test.each(['board', 'server', 'step'] as const)('a suspended resume cannot overtake a newer %s', async (change) => {
  let finishRead!: (response: Response) => void;
  let commands = 0;
  const fetch = spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(
      (input: string | URL | Request, init?: RequestInit) => {
        if (String(input).endsWith('/tour'))
          return new Promise<Response>((resolve) => {
            finishRead = resolve;
          });
        if (!String(input).endsWith('/tour/go')) return Promise.resolve(Response.json({}));
        commands++;
        const body = JSON.parse(String(init?.body)) as { stop?: number };
        return Promise.resolve(Response.json(step(commands + 2, body.stop ?? 1)));
      },
      { preconnect: globalThis.fetch.preconnect },
    ),
  );
  try {
    const resumed = startPresentation(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (change === 'step') await stepTour({ step: 'next' });
    else {
      if (change === 'server') {
        epoch += '-new';
        connectBoardCatalog(epoch);
      }
      const generation = change === 'board' ? 2 : 1;
      applyBoards({
        catalogEpoch: epoch,
        catalogRevision: 2,
        boardGeneration: generation,
        reloadRevision: 0,
        boards: [],
        activeBoardId: null,
      });
      applyTourStep({ ...step(2, 2), boardGeneration: generation, present: true });
    }
    finishRead(Response.json({ position: 0 }));
    await resumed;
    expect(commands).toBe(change === 'step' ? 1 : 0);
    expect(presentationCursor.value?.index).toBe(change === 'step' ? 1 : 2);
    expect(presenting.value).toBe(true);
  } finally {
    fetch.mockRestore();
  }
});

test('a current superseded start reports why it has no stop instead of silently waiting', async () => {
  const fetch = spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(() => Promise.resolve(Response.json({ ok: true, superseded: true })), {
      preconnect: globalThis.fetch.preconnect,
    }),
  );
  try {
    await startPresentation();
    expect(presenting.value).toBe(true);
    expect(presentationCursor.value).toBeNull();
    expect(presentationError.value).toContain('superseded');
  } finally {
    fetch.mockRestore();
  }
});

test('two successful steps cannot be rewound or replayed by delayed event echoes', () => {
  applyTourStep(step(1, 1));
  applyTourStep(step(2, 2));
  expect(viewport.value.x).toBe(200);
  applyTourStep(step(1, 1));
  expect(viewport.value.x).toBe(200);
  expect(presentationCursor.value?.index).toBe(2);
  // Local panning distinguishes an ignored echo from restarting the same stop.
  viewport.value = { x: 250, y: 0, scale: 1 };
  applyTourStep(step(2, 2));
  expect(viewport.value.x).toBe(250);
  // Intentionally revisiting that stop is a new server operation, not an echo.
  applyTourStep(step(3, 2));
  expect(viewport.value.x).toBe(200);
});

test('an old echo during an HTTP request cannot discard its success, but a newer step can', async () => {
  applyTourStep(step(1, 1));
  let complete!: (response: Response) => void;
  const fetch = spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(
      () =>
        new Promise<Response>((resolve) => {
          complete = resolve;
        }),
      { preconnect: globalThis.fetch.preconnect },
    ),
  );
  try {
    const next = stepTour({ step: 'next' });
    applyTourStep(step(1, 1));
    complete(Response.json(step(2, 2)));
    await next;
    expect(presentationCursor.value?.index).toBe(2);
    expect(viewport.value.x).toBe(200);
    const previous = stepTour({ step: 'previous' });
    applyTourStep(step(4, 0));
    complete(Response.json(step(3, 1)));
    await previous;
    expect(viewport.value.x).toBe(0);
    expect(presentationCursor.value?.index).toBe(0);
    const restart = stepTour({ stop: 1 });
    applyTourExit(step(5, 0));
    expect(presenting.value).toBe(false);
    complete(Response.json(step(6, 1)));
    await restart;
    expect(presenting.value).toBe(true);
    expect(presentationCursor.value?.index).toBe(1);
    const older = stepTour({ stop: 2 });
    applyTourExit(step(8, 0));
    complete(Response.json(step(7, 2)));
    await older;
    expect(presenting.value).toBe(false);
    expect(presentationCursor.value).toBeNull();
    presenting.value = true;
    const superseded = stepTour({ stop: 1 });
    applyTourExit(step(9, 0));
    applyTourStep(step(11, 2));
    complete(Response.json(step(10, 1)));
    await superseded;
    expect(presenting.value).toBe(false);
    expect(presentationCursor.value).toBeNull();
    presenting.value = true;
    const sameOperation = stepTour({ stop: 1 });
    applyTourExit(step(12, 0));
    applyTourStep(step(13, 1));
    expect(presenting.value).toBe(false);
    complete(Response.json(step(13, 1)));
    await sameOperation;
    expect(presenting.value).toBe(true);
    expect(presentationCursor.value?.index).toBe(1);
  } finally {
    fetch.mockRestore();
  }
});

test('foreign board/server steps and responses from a dismissed presentation do not move the camera', async () => {
  applyTourStep(step(1, 1));
  applyTourStep({ ...step(2, 2), catalogEpoch: 'old-server' });
  applyTourStep({ ...step(2, 2), boardGeneration: 0 });
  expect(viewport.value.x).toBe(100);
  let complete!: (response: Response) => void;
  const fetch = spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(
      () =>
        new Promise<Response>((resolve) => {
          complete = resolve;
        }),
      { preconnect: globalThis.fetch.preconnect },
    ),
  );
  try {
    const next = stepTour({ step: 'next' });
    dismissPresentation();
    presenting.value = true;
    complete(Response.json(step(2, 2)));
    await next;
    expect(viewport.value.x).toBe(100);
    expect(presentationCursor.value).toBeNull();
  } finally {
    fetch.mockRestore();
  }
});
