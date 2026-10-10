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

function at(id: string, x: number, content = `${id} body`, revision = 1): CanvasNodeState {
  return { ...node(id, content, revision), position: { x, y: 0 } };
}

describe('near a pin (docs/design/NearPin.dc.html)', () => {
  test('neighbours follow the pins as title + short summary, nearest first, never full content', () => {
    const long = 'Detail. '.repeat(200);
    const brief = compileContextBrief(
      input({
        nodes: [at('pin', 0), at('near-b', 300, long), at('near-a', 150, long), at('far', 2000)],
        pinnedNodeIds: ['pin'],
        contentRevision: 1,
        since: 1,
      }),
    );
    const entries = brief.document?.entries ?? [];
    expect(entries.map((entry) => [entry.nodeId, entry.reason])).toEqual([
      ['pin', 'pinned'],
      ['near-a', 'near'],
      ['near-b', 'near'],
    ]);
    const near = entries.find((entry) => entry.nodeId === 'near-a');
    expect(near?.near).toEqual({ pinNodeId: 'pin', pinTitle: 'pin' });
    expect(near?.text.length).toBeLessThan(long.length);
  });

  test('a neighbour that changed since the cursor arrives in full as a change, not as near', () => {
    const brief = compileContextBrief(
      input({
        nodes: [at('pin', 0, 'pin body', 1), at('neighbour', 200, 'fresh edit', 2)],
        pinnedNodeIds: ['pin'],
        contentRevision: 2,
        since: 1,
      }),
    );
    expect(brief.document?.entries.map((entry) => [entry.nodeId, entry.reason])).toEqual([
      ['pin', 'pinned'],
      ['neighbour', 'changed'],
    ]);
  });

  test('at most five neighbours per pin', () => {
    const neighbours = Array.from({ length: 7 }, (_, index) => at(`n${index}`, 100 + index * 50));
    const brief = compileContextBrief(
      input({ nodes: [at('pin', 0), ...neighbours], pinnedNodeIds: ['pin'], contentRevision: 1, since: 1 }),
    );
    expect(brief.document?.entries.filter((entry) => entry.reason === 'near')).toHaveLength(5);
  });
});

describe('links changed after a read (docs/design/LinksChanged.dc.html)', () => {
  const human = { actor: 'human', source: 'browser' };
  const codex = { actor: 'agent', source: 'mcp', agentId: 'codex' };
  const raise = { ...node('raise', 'Question for Q4 pricing.', 1), linksRevision: 4 };
  const smb = { ...node('smb', 'Eight of twelve churned on price.', 5), linksRevision: 4 };
  const links = [
    {
      from: 'smb',
      to: 'raise',
      type: 'relation',
      label: 'supports',
      revision: 4,
      changedBy: human,
      createdAt: 't4',
      changedAt: 't4',
    },
    { from: 'raise', to: 'smb', type: 'flow', revision: 2, changedBy: codex, createdAt: 't1', changedAt: 't2' },
  ];

  test('a later read says what changed on each card and marks links drawn since, with who drew them', () => {
    const brief = compileContextBrief(input({ nodes: [raise, smb], edges: links, contentRevision: 5, since: 3 }));
    const byId = new Map(brief.document?.entries.map((entry) => [entry.nodeId, entry]));
    expect(byId.get('raise')?.changes).toEqual(['links']);
    expect(byId.get('smb')?.changes).toEqual(['text', 'links']);
    expect(byId.get('raise')?.text).toContain('← relation "supports": smb (smb) (new, by a person)');
    // Changed before the cursor: no mark.
    expect(byId.get('raise')?.text.split('\n')).toContain('→ flow: smb (smb)');
  });

  test('a link relabelled since the read says "changed", by the agent that did it', () => {
    const brief = compileContextBrief(input({ nodes: [raise, smb], edges: links, contentRevision: 5, since: 1 }));
    const raiseText = brief.document?.entries.find((entry) => entry.nodeId === 'raise')?.text ?? '';
    expect(raiseText).toContain('→ flow: smb (smb) (changed, by codex)');
  });

  test('a pinned card stays "pinned" and carries its changes; a first read marks nothing', () => {
    const later = compileContextBrief(
      input({ nodes: [raise, smb], edges: links, pinnedNodeIds: ['smb'], contentRevision: 5, since: 3 }),
    );
    const pinned = later.document?.entries.find((entry) => entry.nodeId === 'smb');
    expect([pinned?.reason, pinned?.changes]).toEqual(['pinned', ['text', 'links']]);

    const first = compileContextBrief(input({ nodes: [raise, smb], edges: links, contentRevision: 5, since: null }));
    for (const entry of first.document?.entries ?? []) {
      expect(entry.changes).toBeUndefined();
      expect(entry.text).not.toContain('(new');
    }
  });
});

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
      // Each change carries its `changes` marks, so the noisy card needs a little more room.
      budget: 720,
    });
    const plain = compileContextBrief(snapshot);
    const curated = compileContextBrief({ ...snapshot, pinnedNodeIds: ['decision-a', 'decision-b'] });
    // Without pins the oldest card's summary fills the brief; with pins the decisions lead.
    expect(plain.document!.entries.filter((entry) => !entry.truncated).map((entry) => entry.nodeId)).toEqual(['noise']);
    expect(curated.document!.entries.filter((entry) => !entry.truncated)).toEqual([
      expect.objectContaining({
        sourceBoardId: 'active',
        nodeId: 'decision-a',
        reason: 'pinned',
        text: 'Use SQLite WAL; backups must include a checkpoint.',
        summaryOnly: true,
      }),
      expect.objectContaining({
        sourceBoardId: 'active',
        nodeId: 'decision-b',
        reason: 'pinned',
        text: 'Keep the active board unchanged when copying.',
      }),
    ]);
    expect(curated.serialized.length).toBeLessThanOrEqual(720);
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

  test('a first read larger than the budget sends pins first, then whole oldest revisions, and pages on', () => {
    const body = 'Y'.repeat(300);
    // Spread far apart so no card is "near" the pin and every read pages through revisions.
    const nodes = ['a', 'b', 'c', 'd', 'e'].map((id, index) => at(id, index * 2_000, body, index + 1));
    const first = compileContextBrief(
      input({ nodes, pinnedNodeIds: ['e'], contentRevision: 5, since: null, budget: 1_400 }),
    );
    const firstIds = first.document!.entries.map((entry) => `${entry.nodeId}:${entry.reason}`);
    expect(firstIds[0]).toBe('e:pinned');
    expect(firstIds).toContain('a:changed');
    expect(first.reset).toBe('first-read');
    // Whole entries only, except a truncated preview of the group that did not fit, last.
    const truncatedAt = first.document!.entries.findIndex((entry) => entry.truncated);
    expect(truncatedAt === -1 || truncatedAt === first.document!.entries.length - 1).toBe(true);
    expect(first.nextCursor).toBeGreaterThanOrEqual(1);
    expect(first.nextCursor).toBeLessThan(5);

    const second = compileContextBrief(
      input({ nodes, pinnedNodeIds: ['e'], contentRevision: 5, since: first.nextCursor, budget: 1_400 }),
    );
    const delivered = new Set([...first.document!.entries, ...second.document!.entries].map((entry) => entry.nodeId));
    expect(second.reset).toBeNull();
    expect(delivered.has('b')).toBe(true);
    expect(second.nextCursor!).toBeGreaterThan(first.nextCursor!);
  });

  test('a first-read page never returns a cursor below the retention floor', () => {
    const body = 'Z'.repeat(300);
    const nodes = ['a', 'b', 'c', 'd', 'e'].map((id, index) => at(id, index * 2_000, body, index + 1));
    const page = compileContextBrief(
      input({ nodes, contentRevision: 905, retentionFloor: 900, since: null, budget: 1_400 }),
    );
    expect(page.document!.entries.length).toBeGreaterThan(0);
    // Below the floor a continuation would be read as expired; the page keeps the first-read cursor.
    expect(page.nextCursor).toBeNull();
    const whole = compileContextBrief(input({ nodes, contentRevision: 905, retentionFloor: 900, since: null }));
    expect(whole.nextCursor).toBe(905);
  });

  test('the brief is a map: overview, summaries, why pinned, relations and pinned boards', () => {
    const long = 'Detail. '.repeat(200);
    const result = compileContextBrief(
      input({
        nodes: [node('plan', long, 1), node('risk', 'Vendor lock-in.', 2)],
        edges: [{ from: 'plan', to: 'risk', type: 'depends-on', label: 'blocked by' }],
        pinnedNodeIds: ['plan'],
        pinReasons: { plan: 'the Q4 bet' },
        overview: { folder: 'Planning', readmeSummary: 'Q4 planning board.', links: ['Research'], backlinks: [] },
        pinnedBoards: [
          {
            boardId: 'research',
            name: 'Research',
            folder: 'Research',
            readmeSummary: 'Pricing research.',
            cards: [{ nodeId: 'finding', title: 'Finding', summary: 'Churn flat at $20.' }],
            links: [],
            backlinks: ['Active'],
          },
        ],
        since: null,
        budget: 10_000,
      }),
    );
    const entries = result.document!.entries;
    expect(entries[0]).toMatchObject({ reason: 'overview', nodeId: 'board:active' });
    expect(entries[0]!.text).toContain('Folder: Planning.');
    expect(entries[0]!.text).toContain('Links to: Research.');
    const plan = entries.find((entry) => entry.nodeId === 'plan')!;
    expect(plan).toMatchObject({ reason: 'pinned', summaryOnly: true });
    expect(plan.text.length).toBeLessThan(long.length);
    expect(plan.text).toContain('Pinned because: the Q4 bet');
    expect(plan.text).toContain('→ depends-on "blocked by": risk (risk)');
    expect(entries.find((entry) => entry.nodeId === 'risk')!.text).toContain('← depends-on "blocked by": plan (plan)');
    const map = entries.find((entry) => entry.nodeId === 'board:research')!;
    expect(map).toMatchObject({ reason: 'pinned-board', sourceBoardId: 'research' });
    expect(map.text).toContain('Pricing research.');
    expect(map.text).toContain('Linked from: Active.');
    expect(entries.find((entry) => entry.nodeId === 'finding')).toMatchObject({
      reason: 'pinned-board',
      text: 'Churn flat at $20.',
      summaryOnly: true,
    });
  });

  test('a first read skips deletions: a first reader holds nothing to delete', () => {
    const result = compileContextBrief(
      input({
        nodes: [node('kept', 'state', 2)],
        tombstones: [{ nodeId: 'gone', revision: 1, deletedBy: actor }],
        contentRevision: 2,
        since: null,
      }),
    );
    expect(result.document!.deletions).toEqual([]);
    expect(result.nextCursor).toBe(2);
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
