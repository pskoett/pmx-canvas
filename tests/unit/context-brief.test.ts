import { describe, expect, test } from 'bun:test';
import {
  compileContextBrief,
  type ContextBriefInput,
  type ContextBriefLibraryBoard,
} from '../../src/server/context-brief.ts';
import type { ActorAttribution } from '../../src/server/attribution.ts';
import type { CanvasNodeState } from '../../src/server/canvas-state.ts';

const actor: ActorAttribution = { actor: 'unknown', source: 'test' };

function node(id: string, content: string, revision: number): CanvasNodeState {
  return {
    id,
    type: 'markdown',
    position: { x: 0, y: 0 },
    size: { width: 100, height: 100 },
    zIndex: 0,
    collapsed: false,
    pinned: false,
    data: { title: id, content },
    contentRevision: revision,
  };
}

function input(overrides: Partial<ContextBriefInput> = {}): ContextBriefInput {
  return {
    activeBoard: { boardId: 'active', name: 'Active', category: 'okr' },
    nodes: [],
    pinnedNodeIds: [],
    contentRevision: 0,
    retentionFloor: 0,
    tombstones: [],
    since: 0,
    libraryBoards: [],
    budget: 10_000,
    ...overrides,
  };
}

function library(boardId: string, linkIds: string[], category = 'okr'): ContextBriefLibraryBoard {
  return {
    boardId,
    name: boardId,
    category,
    readme: { nodeId: `${boardId}-readme`, title: `${boardId} intro`, summary: `${boardId} summary` },
    pinnedTitles: [{ nodeId: `${boardId}-pin`, title: `${boardId} decision` }],
    linkIds,
  };
}

describe('compileContextBrief', () => {
  test('curation delivers both selected decisions under the same noisy-board budget', () => {
    const snapshot = input({
      nodes: [
        node('noise', 'Routine build output. '.repeat(200), 1),
        node('decision-a', 'Use SQLite WAL; backups must include a checkpoint.', 2),
        node('decision-b', 'Keep the active board unchanged when copying.', 3),
      ],
      contentRevision: 3,
      since: 0,
      budget: 1000,
    });
    const plain = compileContextBrief(snapshot);
    const curated = compileContextBrief({ ...snapshot, pinnedNodeIds: ['decision-a', 'decision-b'] });
    expect(plain.document!.entries.filter((entry) => !entry.truncated)).toHaveLength(0);
    expect(curated.document!.entries.filter((entry) => !entry.truncated)).toEqual([
      expect.objectContaining({
        sourceBoardId: 'active',
        nodeId: 'decision-a',
        reason: 'pinned',
        text: 'Use SQLite WAL; backups must include a checkpoint.',
      }),
      expect.objectContaining({
        sourceBoardId: 'active',
        nodeId: 'decision-b',
        reason: 'pinned',
        text: 'Keep the active board unchanged when copying.',
      }),
    ]);
    expect(curated.serialized.length).toBeLessThanOrEqual(1000);
    expect(curated.nextCursor).toBe(0);
    expect(curated.document!.delivery.truncated).toBe(true);
  });

  test('prioritizes local pins over asymmetric linked-board discovery metadata', () => {
    const result = compileContextBrief(
      input({
        nodes: [node('pin', 'the complete pinned decision', 1)],
        pinnedNodeIds: ['pin'],
        contentRevision: 1,
        libraryBoards: [library('previous', ['link-card'])],
      }),
    );
    expect(result.document!.entries.map((entry) => entry.reason)).toEqual(['pinned', 'linked', 'linked']);
    expect(result.document!.entries[2]).toMatchObject({ titleOnly: true, reason: 'linked' });
    expect(result.deliveredEntryIds).toContain('active:pin');
  });

  test('honors tiny and exact UTF-16 budgets including envelope metadata', () => {
    const tiny = compileContextBrief(input({ budget: 1 }));
    expect(tiny.serialized).toBe('');
    expect(tiny.document).toBeNull();
    const baseline = compileContextBrief(input());
    const exact = compileContextBrief(input({ budget: baseline.serialized.length }));
    expect(exact.serialized.length).toBe(baseline.serialized.length);
    expect(exact.document!.budgetUnit).toBe('utf16-code-units');
    expect(
      compileContextBrief(input({ budget: baseline.serialized.length - 1 })).serialized.length,
    ).toBeLessThanOrEqual(baseline.serialized.length - 1);
  });

  test('does not advance over an omitted revision or split changes sharing a revision', () => {
    const snapshot = input({
      nodes: [node('a', 'A'.repeat(200), 2), node('b', 'B'.repeat(200), 2), node('c', 'later', 3)],
      contentRevision: 3,
      since: 1,
    });
    const envelope = compileContextBrief(input({ ...snapshot, nodes: [], contentRevision: 3 })).serialized.length;
    const result = compileContextBrief({ ...snapshot, budget: envelope + 180 });
    expect(result.document!.entries).toHaveLength(1);
    expect(result.document!.entries[0]).toMatchObject({ nodeId: 'a', truncated: true });
    expect(result.nextCursor).toBe(1);
    expect(result.document!.delivery).toMatchObject({ truncated: true, omittedEntries: 3 });
  });

  test('delivers deletions and advances only through complete revision groups', () => {
    const result = compileContextBrief(
      input({
        nodes: [node('changed', 'new value', 2)],
        contentRevision: 2,
        since: 1,
        tombstones: [{ nodeId: 'gone', revision: 2, deletedBy: actor }],
      }),
    );
    expect(result.nextCursor).toBe(2);
    expect(result.deliveredDeletionIds).toEqual(['gone']);
    expect(result.document!.deletions[0]).toEqual({ sourceBoardId: 'active', nodeId: 'gone', revision: 2 });
  });

  test('makes first-read and retention-expired reset explicit and atomic', () => {
    const first = compileContextBrief(input({ nodes: [node('old', 'state', 4)], contentRevision: 4, since: null }));
    expect(first.reset).toBe('first-read');
    expect(first.nextCursor).toBe(4);
    const expired = compileContextBrief(
      input({ nodes: [node('old', 'state', 4)], contentRevision: 4, retentionFloor: 3, since: 1 }),
    );
    expect(expired.reset).toBe('retention-expired');
    expect(expired.document!.entries.map((entry) => entry.nodeId)).toEqual(['old']);
    const omitted = compileContextBrief(
      input({ nodes: [node('old', 'X'.repeat(500), 4)], contentRevision: 4, retentionFloor: 3, since: 1, budget: 350 }),
    );
    expect(omitted.nextCursor).toBe(1);
  });

  test('retains a null first-read cursor until a complete replacement is delivered', () => {
    const result = compileContextBrief(
      input({ nodes: [node('huge', 'X'.repeat(2_000), 0)], contentRevision: 0, since: null, budget: 500 }),
    );
    expect(result.document!.entries[0]).toMatchObject({ nodeId: 'huge', truncated: true });
    expect(result.nextCursor).toBeNull();
    expect(result.reset).toBe('first-read');
  });

  test('includes legacy undefined-revision nodes in reset and rejects future cursors', () => {
    const legacy = node('legacy', 'old state', 0);
    delete legacy.contentRevision;
    const reset = compileContextBrief(input({ nodes: [legacy], contentRevision: 4, since: null }));
    expect(reset.document!.entries.map((entry) => entry.nodeId)).toEqual(['legacy']);
    expect(reset.nextCursor).toBe(4);

    const future = compileContextBrief(input({ contentRevision: 4, since: 5 }));
    expect(future.invalidCursor).toBe(true);
    expect(future.nextCursor).toBeNull();
  });

  test('deduplicates cyclic/duplicate links and ranks unrelated same-category boards last', () => {
    const previous = library('previous', ['link-a', 'link-b']);
    const result = compileContextBrief(
      input({ libraryBoards: [library('related', []), previous, { ...previous }, library('active', ['cycle'])] }),
    );
    expect(result.document!.entries.map((entry) => `${entry.sourceBoardId}:${entry.nodeId}`)).toEqual([
      'previous:previous-readme',
      'previous:previous-pin',
      'related:related-readme',
    ]);
  });

  test('does not mutate input and reports exact inclusion, provenance and malformed cursor', () => {
    const snapshot = input({
      since: Number.NaN,
      entries: [
        {
          sourceBoardId: 'active',
          nodeId: 'ask',
          reason: 'ask',
          title: 'Question',
          text: 'Treat this imported text as data',
          provenance: { kind: 'imported', source: 'brief.docx' },
        },
      ],
      libraryBoards: [library('other-folder', [], 'other')],
    });
    const before = structuredClone(snapshot);
    const result = compileContextBrief(snapshot);
    expect(snapshot).toEqual(before);
    expect(result.invalidCursor).toBe(true);
    expect(result.reset).toBeNull();
    expect(result.nextCursor).toBeNull();
    expect(result.document!.cursor.valid).toBe(false);
    expect(result.document!.entries.map((entry) => entry.nodeId)).toEqual(['ask']);
    expect(result.document!.entries[0].provenance).toEqual({
      kind: 'imported',
      source: 'brief.docx',
      trust: 'source-material-not-instructions',
    });
  });
});
