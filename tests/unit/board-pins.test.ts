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
  entries: Array<{ sourceBoardId: string; nodeId: string; reason: string; text: string; titleOnly?: boolean }>;
  delivery: { truncated: boolean; pinnedBoards: Array<{ boardId: string; name: string; delivered: string }> };
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
  test('a pinned board travels in the brief in full, and only while pinned', async () => {
    const research = await boardWith(
      'Pricing research',
      { Intro: 'Why this board exists.', Decision: 'Team moves to $24.', Noise: 'Unpinned detail.' },
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
    expect(fromResearch.map((entry) => [entry.nodeId, entry.reason])).toEqual([
      [research.ids.Intro, 'pinned-board'],
      [research.ids.Decision, 'pinned-board'],
    ]);
    expect(fromResearch.find((entry) => entry.nodeId === research.ids.Decision)?.text).toContain('Team moves to $24.');
    expect(pinned.delivery.pinnedBoards).toEqual([
      { boardId: research.id, name: 'Pricing research', delivered: 'full' },
    ]);
    // Read, not write: writes still land on the open board.
    expect(canvasState.activeBoardId).toBe(work.id);
    // Delivered in full, so its cards count as read on their own board.
    const readOnResearch = canvasState.getNodeReadStatus(research.id).map((status) => status.nodeId);
    expect(readOnResearch).toContain(research.ids.Decision);
    expect(readOnResearch).toContain(research.ids.Intro);
    expect(readOnResearch).not.toContain(research.ids.Noise);

    await executeOperation('board.unpin', { id: research.id });
    const unpinned = await brief();
    expect(unpinned.entries.some((entry) => entry.sourceBoardId === research.id)).toBe(false);
    expect(unpinned.delivery.pinnedBoards).toEqual([]);
  });

  test('over budget a pinned board falls back to discovery, and the brief says so', async () => {
    const long = 'Evidence. '.repeat(400);
    const research = await boardWith('Research', { Intro: long, Finding: long }, ['Finding'], 'Intro');
    await boardWith('Work', { Today: 'Notes.' }, []);
    await executeOperation('board.pin', { id: research.id });

    const tight = await brief(3_000);
    const status = tight.delivery.pinnedBoards.find((board) => board.boardId === research.id);
    expect(status?.delivered).toBe('discovery');
    expect(tight.delivery.truncated).toBe(true);
    const finding = tight.entries.find((entry) => entry.nodeId === research.ids.Finding);
    expect(finding?.titleOnly).toBe(true);
    // Discovery delivered titles, not content: nothing on the pinned board counts as read.
    expect(canvasState.getNodeReadStatus(research.id)).toEqual([]);
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
