import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { canvasState } from '../../src/server/canvas-state.ts';
import { executeOperation } from '../../src/server/operations/registry.ts';
import { createTestWorkspace, removeTestWorkspace, resetCanvasForTests } from './helpers.ts';

// Board pins (vision move 0a): a pinned board's README and pinned cards reach
// the brief whichever board is open; pinning is context, never a write target.

let root = '';

beforeEach(() => {
  root = createTestWorkspace('pmx-canvas-board-pins-');
  resetCanvasForTests(root);
  canvasState.loadFromDisk({ clearExisting: true });
});

afterEach(() => {
  canvasState.close();
  removeTestWorkspace(root);
});

type Brief = {
  entries: Array<{ sourceBoardId: string; nodeId: string; reason: string; text: string; summaryOnly?: boolean }>;
  delivery: { truncated: boolean };
};

async function boardWith(name: string, cards: Record<string, string>, pinned: string[], readme?: string) {
  const { board } = (await executeOperation('board.create', { name })) as { board: { id: string } };
  await executeOperation('board.open', { id: board.id });
  const ids: Record<string, string> = {};
  for (const [title, content] of Object.entries(cards)) {
    const { node } = (await executeOperation('node.add', { type: 'markdown', title, content })) as {
      node: { id: string };
    };
    ids[title] = node.id;
  }
  if (pinned.length) await executeOperation('pin.set', { nodeIds: pinned.map((title) => ids[title]), mode: 'add' });
  if (readme) await executeOperation('board.update', { id: board.id, readmeNodeId: ids[readme] });
  return { id: board.id, ids };
}

const brief = async (budget?: number) =>
  (await executeOperation('context.get', budget === undefined ? {} : { budget })) as Brief;

describe('board pins', () => {
  test('a pinned board travels in the brief as a map, and only while pinned', async () => {
    const research = await boardWith(
      'Pricing research',
      { Intro: 'Why this board exists.', Decision: `Team moves to $24. ${'Evidence. '.repeat(100)}`, Noise: 'Detail.' },
      ['Decision'],
      'Intro',
    );
    const work = await boardWith('Q4 plan', { Today: 'Working notes.' }, []);
    await executeOperation('board.pin', { id: research.id, reason: 'Q4 rests on it' });

    const pin = canvasState.listBoards().find((board) => board.id === research.id)?.pin;
    expect(pin?.reason).toBe('Q4 rests on it');
    expect(typeof pin?.pinnedAt).toBe('string');

    const pinned = await brief();
    const fromResearch = pinned.entries.filter((entry) => entry.sourceBoardId === research.id);
    // A map: the board (README summary, relations) and each pinned card as title + short summary.
    expect(fromResearch.map((entry) => [entry.nodeId, entry.reason])).toEqual([
      [`board:${research.id}`, 'pinned-board'],
      [research.ids.Decision, 'pinned-board'],
    ]);
    expect(fromResearch[0]?.text).toContain('Why this board exists.');
    const decision = fromResearch[1]!;
    expect(decision.text).toContain('Team moves to $24.');
    expect(decision.text.length).toBeLessThan(400);
    // Read, not write: writes still land on the open board.
    expect(canvasState.activeBoardId).toBe(work.id);

    // The map counts as the board being read; its cards stay unread until pulled in full.
    expect(canvasState.getContextReads().reads.some((read) => read.boardId === research.id)).toBe(true);
    const status = (await executeOperation('ax.reads.status', { board: research.id })) as {
      board: { lastReadAt: string } | null;
    };
    expect(typeof status.board?.lastReadAt).toBe('string');
    expect(canvasState.getNodeReadStatus(research.id).map((status) => status.nodeId)).not.toContain(
      research.ids.Decision,
    );

    await executeOperation('board.unpin', { id: research.id });
    const unpinned = await brief();
    expect(unpinned.entries.some((entry) => entry.sourceBoardId === research.id)).toBe(false);
  });

  test('pins survive board switches and go with a deleted board; unknown boards are refused', async () => {
    const research = await boardWith('Research', { Intro: 'Intro.' }, []);
    const work = await boardWith('Work', { Today: 'Notes.' }, []);
    await executeOperation('board.pin', { id: research.id });
    await executeOperation('board.pin', { id: research.id, reason: 'later reason does not overwrite' });
    await executeOperation('board.open', { id: research.id });
    await executeOperation('board.open', { id: work.id });
    const pin = canvasState.listBoards().find((board) => board.id === research.id)?.pin;
    expect(pin).not.toBeNull();
    expect(pin?.reason).toBeUndefined();

    await executeOperation('board.delete', { id: research.id }, { fromWorkbench: true, humanAuthor: true });
    const again = await boardWith('Research again', { Intro: 'Intro.' }, []);
    expect(canvasState.listBoards().find((board) => board.id === again.id)?.pin).toBeNull();

    await expect(executeOperation('board.pin', { id: 'board-missing' })).rejects.toThrow('not found');
  });
});
