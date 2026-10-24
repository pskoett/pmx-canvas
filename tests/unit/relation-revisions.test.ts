import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { withCurrentActor } from '../../src/server/attribution.ts';
import { canvasState, type CanvasNodeState } from '../../src/server/canvas-state.ts';
import { contextReadFromPayload, pinnedBoardReads } from '../../src/server/context-reads.ts';
import { mutationHistory } from '../../src/server/mutation-history.ts';
import { executeOperation } from '../../src/server/operations/registry.ts';
import type { KnowledgeResults, LifecycleResults } from '../../src/server/knowledge-lifecycle.ts';
import { lifecycleQualifications } from '../../src/server/lifecycle-status.ts';
import { agentPresence } from '../../src/server/agent-presence.ts';
import { createTestWorkspace, makeNode, removeTestWorkspace, resetCanvasForTests } from './helpers.ts';

// Connection changes (option C, docs/design/LinksOptions.dc.html): links are
// tracked apart from text. A link change advances both endpoints' links
// revision — never their content revision, so read marks stay — and reaches
// the consumer's next incremental brief; the link itself records who changed it.

let root = '';
beforeEach(() => {
  root = createTestWorkspace('pmx-canvas-relations-');
  resetCanvasForTests(root);
});
afterEach(() => {
  agentPresence.reset();
  canvasState.close();
  removeTestWorkspace(root);
});

const node = (id: string) => canvasState.getNode(id) as CanvasNodeState;
const links = (id: string) => node(id).linksRevision ?? 0;
const content = (id: string) => node(id).contentRevision ?? 0;
const edge = (id: string) => canvasState.getEdges().find((item) => item.id === id);

async function twoCards(): Promise<void> {
  canvasState.loadFromDisk({ clearExisting: true });
  const { board } = (await executeOperation('board.create', { name: 'Relations' })) as { board: { id: string } };
  await executeOperation('board.open', { id: board.id });
  canvasState.addNode(makeNode({ id: 'plan', type: 'markdown', position: { x: 0, y: 0 } }));
  canvasState.addNode(makeNode({ id: 'risk', type: 'markdown', position: { x: 2000, y: 0 } }));
}

describe('connection changes are tracked apart from text', () => {
  test('one-card lifecycle reads only dependency boards and only the requested audit history', async () => {
    await twoCards();
    const targetBoard = canvasState.activeBoardId!;
    const sourceBoard = canvasState.createBoard('Incoming source', 'Sources')!;
    canvasState.switchBoard(sourceBoard.id);
    canvasState.addNode(makeNode({ id: 'source', type: 'markdown' }));
    await executeOperation('edge.add', {
      from: 'source',
      to: 'plan',
      toBoardId: targetBoard,
      kind: 'derived-from',
      type: 'relation',
    });
    for (let i = 0; i < 3; i++) {
      const unrelated = canvasState.createBoard(`Unrelated ${i}`, 'Elsewhere')!;
      canvasState.switchBoard(unrelated.id);
      canvasState.addNode(makeNode({ id: 'plan', type: 'markdown' }));
      for (let r = 0; r < 8; r++)
        canvasState.knowledge.record(unrelated.id, 'plan', {
          outcome: 'unresolved',
          applied: false,
          evidence: `Audit ${r}`,
        });
    }
    canvasState.switchBoard(targetBoard);
    for (let r = 0; r < 8; r++)
      canvasState.knowledge.record(targetBoard, 'plan', {
        outcome: 'unresolved',
        applied: false,
        evidence: `Audit ${r}`,
      });
    const expected = lifecycleQualifications(Date.now(), [{ boardId: targetBoard, cardId: 'plan' }])[
      JSON.stringify([targetBoard, 'plan'])
    ];
    const read = spyOn(canvasState, 'readBoard');
    const history = spyOn(canvasState.knowledge, 'reviews');
    const summaries = spyOn(canvasState.knowledge, 'reviewSummaries');
    try {
      const result = (await executeOperation('node.lifecycle-get', { id: 'plan' })) as LifecycleResults['get'];
      expect(result.qualification).toEqual(expected);
      expect(result.records).toHaveLength(8);
      expect(new Set(read.mock.calls.map(([id]) => id))).toEqual(new Set([targetBoard, sourceBoard.id]));
      expect(read).toHaveBeenCalledTimes(2);
      expect(history.mock.calls).toEqual([[targetBoard, 'plan']]);
      read.mockClear();
      history.mockClear();
      summaries.mockClear();
      const node = (await executeOperation('node.get', { id: 'plan' })) as {
        qualification: LifecycleResults['get']['qualification'];
      };
      expect(node.qualification).toEqual(expected);
      expect(new Set(read.mock.calls.map(([id]) => id))).toEqual(new Set([targetBoard, sourceBoard.id]));
      expect(read).toHaveBeenCalledTimes(2);
      expect(history).not.toHaveBeenCalled();
      read.mockClear();
      summaries.mockClear();
      await executeOperation('node.review', {
        id: 'plan',
        outcome: 'unresolved',
        applied: false,
        evidence: 'Still investigating',
      });
      // The mutation's boards-changed broadcast separately reads the library; qualification stays bounded.
      expect(summaries.mock.calls).toEqual([
        [
          [
            { boardId: targetBoard, cardId: 'plan' },
            { boardId: sourceBoard.id, cardId: 'source' },
          ],
        ],
      ]);
      expect(history).not.toHaveBeenCalled();
    } finally {
      read.mockRestore();
      history.mockRestore();
      summaries.mockRestore();
    }
  });

  test('bounded qualifications preserve incoming live edges, provenance, portal cycles and missing sources', async () => {
    await twoCards();
    const first = canvasState.activeBoardId!;
    const second = canvasState.createBoard('Sources')!;
    canvasState.switchBoard(second.id);
    canvasState.addNode(makeNode({ id: 'source', type: 'markdown' }));
    canvasState.addNode(makeNode({ id: 'back', type: 'board', data: { boardId: first } }));
    const relation = (await executeOperation('edge.add', {
      from: 'source',
      to: 'plan',
      toBoardId: first,
      kind: 'contradicts',
      type: 'relation',
    })) as { id: string };
    canvasState.switchBoard(first);
    canvasState.addNode(makeNode({ id: 'portal', type: 'board', data: { boardId: second.id } }));
    await executeOperation('edge.add', {
      from: 'plan',
      to: 'source',
      toBoardId: second.id,
      kind: 'derived-from',
      type: 'relation',
    });
    canvasState.addNode(
      makeNode({
        id: 'derived',
        type: 'markdown',
        data: {
          title: 'Derived',
          content: 'Cached source',
          provenance: {
            sourceKind: 'recipe',
            sourceUri: 'recipe:test',
            refreshStrategy: 'agent-request',
            snapshotContent: true,
            sources: [
              { boardId: second.id, cardId: 'source', contentRevision: 0, availability: 'cached' },
              { boardId: 'missing-board', cardId: 'missing-card', availability: 'unavailable' },
            ],
          },
        },
      }),
    );
    const unrelated = canvasState.createBoard('Unrelated')!;
    canvasState.switchBoard(unrelated.id);
    canvasState.addNode(makeNode({ id: 'source', type: 'markdown' }));
    canvasState.switchBoard(second.id);
    // An unsaved removal must shadow the stored incoming relation.
    canvasState.removeEdge(relation.id);
    canvasState.addEdge({
      id: 'live-source',
      from: 'source',
      to: 'plan',
      toBoardId: first,
      type: 'relation',
      kind: 'supersedes',
    });
    for (const cardId of ['plan', 'portal', 'derived']) {
      const expected = lifecycleQualifications(Date.now(), [{ boardId: first, cardId }])[
        JSON.stringify([first, cardId])
      ];
      const read = spyOn(canvasState, 'readBoard');
      try {
        const result = (await executeOperation('node.lifecycle-get', {
          board: first,
          id: cardId,
        })) as LifecycleResults['get'];
        expect(result.qualification).toEqual(expected);
        expect(read.mock.calls.some(([id]) => id === unrelated.id)).toBe(false);
        if (cardId === 'plan') {
          expect(result.qualification.due).toBe(true);
          expect(Object.keys(result.qualification.observations).join()).toContain('live-source');
          expect(Object.keys(result.qualification.observations).join()).not.toContain(relation.id);
        }
        if (cardId === 'portal') expect(result.qualification.sources.length).toBeGreaterThan(0);
        if (cardId === 'derived') expect(result.qualification.sources.some((source) => source.unavailable)).toBe(true);
      } finally {
        read.mockRestore();
      }
    }
  });

  test('dependency cycles propagate source changes but a reason edit and a reference do not reset or spread them', async () => {
    await twoCards();
    canvasState.addNode(makeNode({ id: 'downstream', type: 'markdown' }));
    canvasState.addNode(makeNode({ id: 'reference', type: 'markdown' }));
    const connect = async (from: string, to: string, kind: string) =>
      (await executeOperation('edge.add', { from, to, kind, type: 'relation' })) as { id: string };
    const forward = await connect('plan', 'risk', 'derived-from');
    await connect('risk', 'plan', 'derived-from');
    await connect('risk', 'downstream', 'derived-from');
    await connect('plan', 'reference', 'cites');
    const get = async (id: string) => (await executeOperation('node.lifecycle-get', { id })) as LifecycleResults['get'];
    expect((await get('downstream')).qualification.due).toBe(false);
    canvasState.updateNode('plan', { data: { ...node('plan').data, content: 'A changed primary observation.' } });
    await executeOperation('edge.update', { id: forward.id, reason: 'Clarified why this depends on the source.' });
    for (const id of ['plan', 'risk', 'downstream']) expect((await get(id)).qualification.due).toBe(true);
    expect((await get('reference')).qualification.due).toBe(false);
    for (const id of ['plan', 'risk', 'downstream']) {
      const checked = await get(id);
      await executeOperation('node.review', {
        id,
        outcome: 'retain',
        applied: true,
        evidence: 'Compared the current dependency evidence.',
        expectedContentRevision: checked.contentRevision,
        expectedSources: checked.qualification.observations,
      });
    }
    for (const id of ['plan', 'risk', 'downstream']) expect((await get(id)).qualification.due).toBe(false);
    await connect('reference', 'downstream', 'contradicts');
    expect((await get('downstream')).qualification.due).toBe(true);
    expect((await get('risk')).qualification.due).toBe(false);
  });

  test('cadence boundaries and new-session reads keep validation separate from use', async () => {
    await twoCards();
    canvasState.updateNode('plan', { data: { title: 'Capacity plan', content: 'Check the primary observation.' } });
    const boardId = canvasState.activeBoardId!;
    const policy = {
      decayType: 'reality',
      rate: 'medium',
      cadenceDays: 17,
      triggers: [],
      revalidationMethod: 'Compare primary evidence',
    };
    for (const cadenceDays of [undefined, 0, 0.5, 36501]) {
      const invalid = { ...policy, cadenceDays };
      await expect(
        executeOperation('node.lifecycle-set', { id: 'plan', lifecycleOverride: invalid }),
      ).rejects.toThrow();
      await expect(
        executeOperation('knowledge.folder-set', {
          path: 'Invalid cadence',
          categoryId: null,
          lifecycleOverride: invalid,
        }),
      ).rejects.toThrow();
      await expect(
        executeOperation('knowledge.category-set', {
          category: { ...invalid, id: 'invalid', name: 'Invalid', glyph: '◇' },
        }),
      ).rejects.toThrow();
    }
    await expect(
      executeOperation('node.lifecycle-set', {
        id: 'plan',
        lifecycleOverride: { ...policy, revalidationMethod: '   ' },
      }),
    ).rejects.toThrow();
    await executeOperation('node.lifecycle-set', { id: 'plan', lifecycleOverride: policy });
    await executeOperation('node.review', {
      id: 'plan',
      outcome: 'retain',
      applied: true,
      evidence: 'Checked',
      expectedContentRevision: content('plan'),
    });
    const checked = (await executeOperation('node.lifecycle-get', { id: 'plan' })) as LifecycleResults['get'];
    const at = Date.parse(checked.lastValidation!.when);
    const key = JSON.stringify([boardId, 'plan']);
    expect(lifecycleQualifications(at + 17 * 86400000 - 1)[key].due).toBe(false);
    expect(lifecycleQualifications(at + 17 * 86400000)[key].due).toBe(true);
    expect(lifecycleQualifications(at + 999 * 86400000)[JSON.stringify([boardId, 'risk'])].due).toBe(false);
    await executeOperation('node.lifecycle-set', { id: 'plan', lifecycleOverride: { ...policy, rate: 'durable' } });
    expect(lifecycleQualifications(at + 999 * 86400000)[key].due).toBe(false);
    await executeOperation('node.lifecycle-set', { id: 'plan', lifecycleOverride: { ...policy, rate: 'fast' } });
    agentPresence.touch({ source: 'test', agentId: 'reviewer', attached: true }, at);
    expect(lifecycleQualifications(at)[key].due).toBe(false);
    agentPresence.touch({ source: 'test', agentId: 'new-reviewer', attached: true }, at + 1);
    expect(lifecycleQualifications(at + 1)[key].due).toBe(true);
    const other = canvasState.createBoard('Unrelated')!;
    canvasState.switchBoard(other.id);
    expect(lifecycleQualifications(at + 1)[key].due).toBe(false);
    const search = (await executeOperation('search', { q: 'plan', scope: 'library' })) as {
      results: Array<{ cardId: string; qualification: LifecycleResults['get']['qualification'] }>;
    };
    expect(search.results.find((entry) => entry.cardId === 'plan')?.qualification.due).toBe(true);
    const read = (await executeOperation('node.get', { board: boardId, id: 'plan' })) as {
      qualification: LifecycleResults['get']['qualification'];
    };
    expect(read.qualification.due).toBe(true);
    expect(read.qualification.lastValidatedAt).toBe(checked.lastValidation!.when);
    expect(canvasState.activeBoardId).toBe(other.id);
    const pins = (await executeOperation('pinned-context.get', { board: boardId })) as { nodes: unknown[] };
    expect(pins.nodes).toEqual([]);
  });

  test('new authored content gets a decay window without inventing evidence or resetting it on edits', async () => {
    await twoCards();
    const policy = {
      decayType: 'reality',
      rate: 'medium',
      cadenceDays: 17,
      triggers: [],
      revalidationMethod: 'Check sources',
    };
    await executeOperation('node.lifecycle-set', { id: 'plan', lifecycleOverride: policy });
    const read = async () => (await executeOperation('node.lifecycle-get', { id: 'plan' })) as LifecycleResults['get'];
    expect(await read()).toMatchObject({
      records: [],
      lastValidation: null,
      qualification: { due: false, lastValidatedAt: null },
    });
    const birth = Date.parse(node('plan').freshnessStartedAt!);
    expect(Number.isFinite(birth)).toBe(true);
    const key = JSON.stringify([canvasState.activeBoardId, 'plan']);
    expect(lifecycleQualifications(birth + 17 * 86400000 - 1)[key].due).toBe(false);
    expect(lifecycleQualifications(birth + 17 * 86400000)[key].due).toBe(true);
    const saved = canvasState.saveSnapshot('Authored freshness')!;
    await executeOperation('node.update', { id: 'plan', content: 'Edited, not revalidated.' });
    expect(Date.parse(node('plan').freshnessStartedAt!)).toBe(birth);
    expect(lifecycleQualifications(birth + 17 * 86400000)[key].due).toBe(true);
    mutationHistory.undo();
    mutationHistory.redo();
    expect(Date.parse(node('plan').freshnessStartedAt!)).toBe(birth);
    expect(canvasState.restoreSnapshot(saved.id)).toBe(true);
    expect(Date.parse(node('plan').freshnessStartedAt!)).toBe(birth);
    canvasState.flushToDisk();
    canvasState.close();
    resetCanvasForTests(root);
    canvasState.loadFromDisk({ clearExisting: true });
    expect(Date.parse(node('plan').freshnessStartedAt!)).toBe(birth);
    expect(await read()).toMatchObject({ records: [], lastValidation: null });
  });

  test('imports stay unvalidated and navigation structures skip inherited factual decay unless explicitly assigned', async () => {
    await twoCards();
    const board = canvasState.activeBoardId!;
    const policy = {
      decayType: 'reality',
      rate: 'medium',
      cadenceDays: 90,
      triggers: [],
      revalidationMethod: 'Check sources',
    };
    await executeOperation('knowledge.category-set', {
      category: { ...policy, id: 'facts', name: 'Facts', glyph: 'F' },
    });
    await executeOperation('knowledge.folder-set', { path: 'Facts', categoryId: 'facts', lifecycleOverride: null });
    await executeOperation('board.update', { id: board, folder: 'Facts' });
    const imported = (await executeOperation('node.add', {
      type: 'markdown',
      title: 'Old imported fact',
      content: 'Historical source.',
      data: { contentOrigin: 'imported' },
    })) as { id: string };
    const group = (await executeOperation('group.create', { title: 'Navigation group' })) as { id: string };
    const get = async (id: string) => (await executeOperation('node.lifecycle-get', { id })) as LifecycleResults['get'];
    expect(await get(imported.id)).toMatchObject({ records: [], lastValidation: null, qualification: { due: true } });
    expect(await get('plan')).toMatchObject({ records: [], lastValidation: null, qualification: { due: false } });
    expect(await get(group.id)).toMatchObject({ lifecycle: null, qualification: { due: false } });
    await executeOperation('node.lifecycle-set', { id: group.id, lifecycleOverride: policy });
    const groupKey = JSON.stringify([board, group.id]);
    expect(lifecycleQualifications(Date.parse(node(group.id).freshnessStartedAt!) + 90 * 86400000)[groupKey].due).toBe(
      true,
    );
    await executeOperation('node.update', { id: imported.id, content: 'Reworded history, no new evidence.' });
    expect(await get(imported.id)).toMatchObject({ qualification: { due: true } });
    await expect(
      executeOperation('node.update', { id: imported.id, data: { contentOrigin: 'authored' } }),
    ).rejects.toThrow('origin');
  });

  test.each([
    'fast',
    'slow',
  ] as const)('new %s content is fresh until a later use session, with no synthetic review', async (rate) => {
    await twoCards();
    const birth = Date.parse(node('plan').freshnessStartedAt!);
    await executeOperation('node.lifecycle-set', {
      id: 'plan',
      lifecycleOverride: { decayType: 'reality', rate, triggers: [], revalidationMethod: 'Check sources' },
    });
    const key = JSON.stringify([canvasState.activeBoardId, 'plan']);
    agentPresence.touch({ source: 'test', agentId: 'author', attached: true }, birth);
    expect(lifecycleQualifications(birth)[key].due).toBe(false);
    agentPresence.touch({ source: 'test', agentId: 'reader', attached: true }, birth + 1);
    expect(lifecycleQualifications(birth + 1)[key].due).toBe(true);
    expect(await executeOperation('node.lifecycle-get', { id: 'plan' })).toMatchObject({
      records: [],
      lastValidation: null,
    });
  });

  test('dashboard qualification follows explicit sources, keeps clocks separate and excludes retired cards', async () => {
    await twoCards();
    canvasState.updateNode('plan', { data: { title: 'Capacity conclusion', content: 'Add a replica.' } });
    const dashboard = canvasState.activeBoardId!;
    const source = canvasState.createBoard('Operational status')!;
    canvasState.switchBoard(source.id);
    canvasState.addNode(makeNode({ id: 'plan', type: 'markdown', data: { title: 'Status', content: '99.2%' } }));
    const policy = {
      decayType: 'reality',
      rate: 'fast',
      triggers: ['source changed'],
      revalidationMethod: 'Compare the source',
    };
    await executeOperation('node.lifecycle-set', { id: 'plan', lifecycleOverride: policy });
    const get = async (id: string, board = canvasState.activeBoardId!) =>
      (await executeOperation('node.lifecycle-get', { id, board })) as LifecycleResults['get'];
    const validate = async (id: string) => {
      const checked = await get(id);
      return executeOperation('node.review', {
        id,
        outcome: 'retain',
        evidence: 'Compared primary evidence',
        applied: true,
        expectedContentRevision: checked.contentRevision,
        expectedSources: checked.qualification.observations,
      });
    };
    await validate('plan');
    const validatedAt = (await get('plan')).lastValidation!.when;
    canvasState.switchBoard(dashboard);
    for (const id of ['plan', 'risk'])
      await executeOperation('node.lifecycle-set', { id, lifecycleOverride: { ...policy, rate: 'durable' } });
    canvasState.addNode(makeNode({ id: 'portal', type: 'board', data: { title: 'Operations', boardId: source.id } }));
    await executeOperation('edge.add', { from: 'plan', to: 'plan', toBoardId: source.id, type: 'depends-on' });
    await executeOperation('edge.add', { from: 'risk', to: 'plan', toBoardId: source.id, type: 'references' });
    const before = await get('plan');
    canvasState.switchBoard(source.id);
    canvasState.updateNode('plan', { data: { ...node('plan').data, content: '95.0%' } });
    canvasState.switchBoard(dashboard);
    const conclusion = await get('plan');
    expect(conclusion.qualification.due).toBe(true);
    expect((await get('risk')).qualification.due).toBe(false);
    const portal = await get('portal');
    expect(portal.qualification.due).toBe(false);
    expect(portal.qualification.sources[0]?.title).toBe('Status');
    expect(portal.qualification.sources[0]?.reasons.length).toBeGreaterThan(0);
    await expect(
      executeOperation('node.review', {
        id: 'plan',
        outcome: 'retain',
        applied: true,
        evidence: 'stale evidence',
        expectedContentRevision: before.contentRevision,
        expectedSources: before.qualification.observations,
      }),
    ).rejects.toThrow('Sources changed');
    const brief = (await executeOperation('context.get', { budget: 50000 })) as {
      entries: Array<{ nodeId: string; qualification?: LifecycleResults['get']['qualification'] }>;
    };
    expect(brief.entries.find((entry) => entry.nodeId === 'plan')?.qualification?.due).toBe(true);
    expect(brief.entries.find((entry) => entry.nodeId === 'risk')?.qualification?.due).toBe(false);
    await executeOperation('node.get', { id: 'plan', board: source.id });
    expect((await get('plan', source.id)).lastValidation!.when).toBe(validatedAt);
    await executeOperation('pin.set', { nodeIds: ['plan'] });
    const cursor = canvasState.getContentRevision().revision;
    await executeOperation('node.review', {
      id: 'plan',
      outcome: 'retire',
      evidence: 'No longer active',
      applied: true,
    });
    const retired = (await executeOperation('context.get', { budget: 50000 })) as typeof brief;
    expect(retired.entries.some((entry) => entry.nodeId === 'plan' && entry.qualification?.retired)).toBe(false);
    expect(retired.entries.some((entry) => entry.nodeId === 'plan')).toBe(false);
    const delta = (await executeOperation('context.get', { since: cursor, budget: 50000 })) as {
      lifecycle: { retired: string[] };
    };
    expect(delta.lifecycle.retired).toContain(JSON.stringify([dashboard, 'plan']));
    expect(canvasState.getContentRevision().revision).toBe(cursor);
    const pins = (await executeOperation('pinned-context.get', {})) as { nodeIds: string[]; preamble: string };
    expect(pins.nodeIds).not.toContain('plan');
    expect(pins.preamble).not.toContain('Capacity conclusion');
    const found = (await executeOperation('search', { q: String(node('plan').data.title) })) as {
      results: Array<{ id: string; qualification: { retired: boolean } }>;
    };
    expect(found.results.find((entry) => entry.id === 'plan')?.qualification.retired).toBe(true);
    await executeOperation('node.lifecycle-restore', { id: 'plan', evidence: 'Needed again' });
    expect((await get('plan')).qualification.due).toBe(true);
    const restoredDelta = (await executeOperation('context.get', { since: cursor, budget: 50000 })) as typeof delta;
    expect(restoredDelta.lifecycle.retired).not.toContain(JSON.stringify([dashboard, 'plan']));
    canvasState.flushToDisk();
    canvasState.close();
    canvasState.setWorkspaceRoot(root);
    canvasState.loadFromDisk({ clearExisting: true });
    expect((await get('plan', dashboard)).qualification.due).toBe(true);
    expect((await get('plan', source.id)).lastValidation!.when).toBe(validatedAt);
  });

  test('retrieval metadata is not a content change; cached and unavailable provenance stays qualified', async () => {
    await twoCards();
    const boardId = canvasState.activeBoardId!;
    const provenance = {
      sourceKind: 'recipe',
      sourceUri: 'recipe://status',
      refreshStrategy: 'agent-request',
      snapshotContent: true,
      syncedAt: '2026-01-01T00:00:00Z',
      recipe: { tool: 'status', input: { region: 'west' }, prompt: 'Compare capacity.' },
    };
    canvasState.updateNode('plan', { data: { ...node('plan').data, provenance } });
    const revision = content('plan');
    const changedAt = node('plan').contentChangedAt;
    canvasState.updateNode('plan', {
      data: {
        ...node('plan').data,
        fetchedAt: '2026-02-01T00:00:00Z',
        provenance: { ...provenance, syncedAt: '2026-02-01T00:00:00Z' },
      },
    });
    expect(content('plan')).toBe(revision);
    expect(node('plan').contentChangedAt).toBe(changedAt);
    canvasState.updateNode('risk', {
      data: {
        ...node('risk').data,
        provenance: {
          ...provenance,
          sources: [
            {
              boardId,
              cardId: 'plan',
              contentRevision: revision,
              observedAt: '2026-01-01T00:00:00Z',
              availability: 'cached',
            },
          ],
        },
      },
    });
    const cached = (await executeOperation('node.lifecycle-get', { id: 'risk' })) as LifecycleResults['get'];
    expect(cached.qualification.sources[0]).toMatchObject({
      observedAt: '2026-01-01T00:00:00Z',
      observedRevision: revision,
    });
    expect(cached.qualification.sources[0].reasons).toContain('Cached observation; not freshly checked.');
    await expect(
      executeOperation('node.update', {
        id: 'risk',
        data: {
          provenance: {
            ...provenance,
            sources: [
              { boardId, cardId: 'plan', availability: 'unavailable' },
              { boardId, cardId: 'plan', availability: 'live' },
            ],
          },
        },
      }),
    ).rejects.toThrow('Source targets must be unique');
    canvasState.removeNode('plan');
    const unavailable = (await executeOperation('node.lifecycle-get', { id: 'risk' })) as LifecycleResults['get'];
    expect(unavailable.qualification.due).toBe(true);
    expect(unavailable.qualification.sources[0].unavailable).toBe(true);
    await expect(
      executeOperation('node.review', {
        id: 'risk',
        outcome: 'retain',
        applied: true,
        evidence: 'Only the old cached value',
        expectedContentRevision: unavailable.contentRevision,
        expectedSources: unavailable.qualification.observations,
      }),
    ).rejects.toThrow('Sources changed or are unavailable');
  });

  test('rich parallel relations keep reasons through the brief, snapshots and restart without editing content', async () => {
    await twoCards();
    const boardId = canvasState.activeBoardId!;
    const revision = content('plan');
    const vocabulary = [{ kind: 'qualifies', ink: 'informs' as const, directed: true }];
    await executeOperation('board.update', { id: boardId, relationVocabulary: vocabulary });
    const first = (await executeOperation('edge.add', {
      from: 'plan',
      to: 'risk',
      type: 'relation',
      kind: 'supports',
      reason: 'Six interviews agree.',
    })) as { id: string };
    await executeOperation('edge.add', {
      from: 'plan',
      to: 'risk',
      type: 'relation',
      kind: 'cites',
      reason: 'Interview log, page 2.',
    });
    expect(content('plan')).toBe(revision);
    const brief = JSON.stringify(await executeOperation('context.get', { budget: 50000 }));
    expect(brief).toContain('Six interviews agree.');
    expect(brief).toContain('Interview log, page 2.');
    const snapshot = canvasState.saveSnapshot('Rich relations')!;
    await executeOperation('edge.update', { id: first.id, kind: 'qualifies', reason: 'Only the SMB segment.' });
    const graph = JSON.stringify(await executeOperation('memory-graph.get', {}));
    expect(graph).toContain('qualifies');
    expect(graph).toContain('Only the SMB segment.');
    expect(content('plan')).toBe(revision);
    canvasState.restoreSnapshot(snapshot.id);
    expect(edge(first.id)?.reason).toBe('Six interviews agree.');
    canvasState.flushToDisk();
    canvasState.close();
    canvasState.setWorkspaceRoot(root);
    expect(canvasState.loadFromDisk({ clearExisting: true })).toBe(true);
    canvasState.switchBoard(boardId);
    expect(edge(first.id)?.kind).toBe('supports');
    expect(edge(first.id)?.reason).toBe('Six interviews agree.');
    expect(canvasState.listBoards().find((board) => board.id === boardId)?.relationVocabulary).toEqual(vocabulary);
  });

  test('shared relation presets survive restart without changing boards or connections', async () => {
    await twoCards();
    const boardId = canvasState.activeBoardId;
    await executeOperation('edge.add', { from: 'plan', to: 'risk', type: 'relation', kind: 'supports' });
    const before = canvasState.getLayout();
    const list = async () => (await executeOperation('knowledge.list', {})) as KnowledgeResults['list'];
    expect((await list()).relationPresets.map((preset) => preset.name)).toEqual([
      'Research',
      'Dependencies',
      'Decision',
      'Flow',
    ]);
    const preset = {
      id: 'verification',
      name: 'Verification',
      vocabulary: [{ kind: 'qualifies', ink: 'informs' as const, directed: true }],
    };
    await executeOperation('knowledge.relation-preset-set', { preset });
    await executeOperation('knowledge.relation-preset-remove', { id: 'Research' });
    await executeOperation('board.open', { id: null });
    expect((await list()).relationPresets).toContainEqual(preset);
    expect(canvasState.activeBoardId).toBeNull();
    canvasState.flushToDisk();
    canvasState.close();
    canvasState.setWorkspaceRoot(root);
    canvasState.loadFromDisk({ clearExisting: true });
    const restored = await list();
    expect(restored.relationPresets).toContainEqual(preset);
    expect(restored.relationPresets.some((entry) => entry.id === 'Research')).toBe(false);
    await executeOperation('board.open', { id: boardId });
    expect(canvasState.getLayout().nodes).toEqual(before.nodes);
    expect(canvasState.getLayout().edges).toEqual(before.edges);
    await executeOperation('knowledge.relation-preset-remove', { id: preset.id });
    expect((await list()).relationPresets.some((entry) => entry.id === preset.id)).toBe(false);
  });

  test.each([
    'node.get',
    'layout.get',
  ])('%s reads content without acknowledging omitted incoming relations', async (operation) => {
    await twoCards();
    const target = canvasState.activeBoardId as string;
    const source = canvasState.createBoard('Remote source')!;
    canvasState.switchBoard(source.id);
    canvasState.addNode(makeNode({ id: 'source', type: 'markdown' }));
    canvasState.addEdge({ id: 'incoming', from: 'source', to: 'plan', toBoardId: target, type: 'references' });
    canvasState.switchBoard(target);
    canvasState.setContextPins(['plan']);
    expect(links('plan')).toBeGreaterThan(0);
    await executeOperation(operation, operation === 'node.get' ? { id: 'plan' } : {});
    const read = canvasState.getContextReads().reads.find((item) => item.resource === operation);
    expect(read?.deliveredNodeIds).toEqual(['plan']);
    expect(read?.readNodes.plan).toBe(content('plan'));
    expect(read?.seenLinks).toEqual({});
    expect(canvasState.getSeenLinks().plan).toBeUndefined();
    await executeOperation('memory-graph.get', {});
    expect(canvasState.getSeenLinks().plan).toBe(links('plan'));
  });

  test.each(['ax.context.get', 'ax.get'])('partial %s delivery keeps omitted relations unseen', async (operation) => {
    await twoCards();
    canvasState.addEdge({ id: 'omitted', from: 'plan', to: 'risk', type: 'references' });
    canvasState.setContextPins(['plan']);
    await executeOperation('annotation.add', {
      type: 'freehand',
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ],
    });
    const pending = executeOperation(operation, {});
    canvasState.addEdge({ id: 'after-delivery', from: 'plan', to: 'risk', type: 'relation' });
    await pending;
    const read = canvasState.getContextReads().reads.find((item) => item.resource === operation);
    expect(read?.deliveredNodeIds).toEqual(['plan']);
    expect(read?.readNodes.plan).toBe(content('plan'));
    expect(read?.seenLinks).toEqual({});
    expect(canvasState.getSeenLinks().plan).toBeUndefined();
    await executeOperation('memory-graph.get', {});
    expect(canvasState.getSeenLinks().plan).toBe(links('plan'));
  });

  test('linked README summaries cannot acknowledge a same-ID local card', async () => {
    await twoCards();
    const source = canvasState.activeBoardId as string;
    const target = canvasState.createBoard('Linked README');
    expect(target).not.toBeNull();
    canvasState.switchBoard(target!.id);
    canvasState.addNode(
      makeNode({ id: 'plan', type: 'markdown', data: { title: 'README', content: 'Remote summary' } }),
    );
    canvasState.setBoardReadme(target!.id, 'plan');
    canvasState.switchBoard(source);
    canvasState.addNode(makeNode({ id: 'portal', type: 'board', data: { boardId: target!.id } }));
    const before = (await executeOperation('context.get', { consumer: 'qualified-brief', budget: 50000 })) as {
      cursor: { next: number };
    };
    canvasState.addEdge({ id: 'new-link', from: 'plan', to: 'risk', type: 'relation' });
    // A later cursor leaves only the linked README, not the local changed card.
    const brief = (await executeOperation('context.get', {
      since: canvasState.getContentRevision().revision,
      budget: 50000,
    })) as {
      entries: Array<{ sourceBoardId: string; nodeId: string; text: string }>;
    };
    expect(before.cursor.next).toBeGreaterThanOrEqual(0);
    expect(brief.entries.some((entry) => entry.sourceBoardId === target!.id && entry.nodeId === 'plan')).toBe(true);
    expect(canvasState.getNodeReadStatus().find((item) => item.nodeId === 'plan')).toBeUndefined();
    expect(canvasState.getSeenLinks().plan ?? -1).toBeLessThan(links('plan'));
  });

  test('a second human summary does not acknowledge capped relations omitted on the first read', async () => {
    await twoCards();
    canvasState.removeNode('plan');
    withCurrentActor({ actor: 'human', source: 'browser' }, () =>
      canvasState.addNode(
        makeNode({ id: 'plan', type: 'markdown', data: { title: 'Human plan', content: 'Human authored' } }),
      ),
    );
    for (let index = 0; index < 9; index += 1) {
      canvasState.addNode(makeNode({ id: `relation-${index}`, type: 'markdown' }));
      canvasState.addEdge({ id: `link-${index}`, from: 'plan', to: `relation-${index}`, type: 'relation' });
    }
    const first = (await executeOperation('context.get', { consumer: 'human-capped', budget: 50000 })) as {
      entries: Array<{ nodeId: string; linksComplete?: false }>;
    };
    expect(first.entries.find((entry) => entry.nodeId === 'plan')?.linksComplete).toBe(false);
    expect(canvasState.getSeenLinks().plan).toBeUndefined();
    const second = (await executeOperation('context.get', { consumer: 'human-capped', budget: 50000 })) as {
      entries: Array<{ nodeId: string; reason: string }>;
    };
    expect(second.entries.find((entry) => entry.nodeId === 'plan')?.reason).toBe('human');
    expect(canvasState.getSeenLinks().plan).toBeUndefined();
  });

  test('a graph acknowledges the projected revision, not a relation added while its read completes', async () => {
    await twoCards();
    const before = links('plan');
    const pending = executeOperation('memory-graph.get', {});
    canvasState.addEdge({ id: 'after-projection', from: 'plan', to: 'risk', type: 'relation' });
    const graph = (await pending) as { edges: Array<{ id: string }> };
    expect(graph.edges.some((edge) => edge.id.endsWith(':after-projection'))).toBe(false);
    expect(links('plan')).toBeGreaterThan(before);
    expect(canvasState.getSeenLinks().plan).toBe(before);
  });

  test('a brief acknowledges its captured clock, while clockless relations stay unseen', async () => {
    await twoCards();
    const boardId = canvasState.activeBoardId as string;
    const before = links('plan');
    const base = {
      channel: 'operation' as const,
      resource: 'context.get',
      source: 'api',
      consumer: null,
      agentId: null,
    };
    const payload = {
      board: { boardId },
      entries: [
        {
          sourceBoardId: boardId,
          nodeId: 'plan',
          text: 'Complete relations',
          linksRevision: before,
          summaryOnly: true,
        },
        { sourceBoardId: boardId, nodeId: 'risk', text: 'No captured clock', summaryOnly: true },
      ],
    };
    const read = contextReadFromPayload({ ...base, pinnedNodeIds: ['plan'] }, payload);
    canvasState.addEdge({ id: 'after-delivery', from: 'plan', to: 'risk', type: 'relation' });
    canvasState.recordContextRead(read);
    expect(canvasState.getSeenLinks().plan).toBe(before);
    expect(canvasState.getSeenLinks().risk).toBeUndefined();
    const pinnedRead = pinnedBoardReads(base, {
      entries: [
        { sourceBoardId: boardId, nodeId: `board:${boardId}`, reason: 'pinned-board', text: 'Board' },
        payload.entries[0],
      ],
    })[0]!;
    canvasState.recordContextRead(pinnedRead, boardId);
    expect(canvasState.getSeenLinks().plan).toBe(before);
    expect(canvasState.getSeenLinks().risk).toBeUndefined();
  });

  test('saved wiki bindings invalidate both endpoints on changes, replay and target disappearance', async () => {
    await twoCards();
    canvasState.onMutation((info) => mutationHistory.record(info));
    const source = canvasState.activeBoardId as string;
    const { board } = (await executeOperation('board.create', { name: 'Wiki target' })) as { board: { id: string } };
    await executeOperation('board.open', { id: board.id });
    canvasState.addNode(
      makeNode({ id: 'plan', type: 'markdown', data: { title: 'Evidence', content: 'Remote body' } }),
    );
    const targetContent = content('plan');
    await executeOperation('board.open', { id: source });
    canvasState.updateNode('plan', { data: { title: 'Source', content: '[[Wiki target#Evidence]]' } });
    const targetLinks = () =>
      canvasState.readBoard(board.id, false)!.layout.nodes.find((node) => node.id === 'plan')!.linksRevision ?? 0;
    expect(targetLinks()).toBeGreaterThan(0);
    const beforeRemove = targetLinks();
    canvasState.updateNode('plan', { data: { title: 'Source', content: 'No link' } });
    expect(targetLinks()).toBeGreaterThan(beforeRemove);
    mutationHistory.undo();
    expect(targetLinks()).toBeGreaterThan(beforeRemove);
    expect(canvasState.getNode('plan')!.data.wikiLinks).toEqual([
      { ref: 'Wiki target#Evidence', target: { boardId: board.id, cardId: 'plan' } },
    ]);
    const sourceContent = content('plan');
    await executeOperation('context.get', { consumer: 'wiki-reader', budget: 50000 });
    const beforeDeletion = links('plan');
    const localControl = links('risk');
    await executeOperation('board.open', { id: board.id });
    expect(content('plan')).toBe(targetContent);
    canvasState.removeNode('plan');
    await executeOperation('board.open', { id: source });
    expect(links('plan')).toBeGreaterThan(beforeDeletion);
    expect(content('plan')).toBe(sourceContent);
    expect(links('risk')).toBe(localControl);
    const brief = (await executeOperation('context.get', { consumer: 'wiki-reader', budget: 50000 })) as {
      entries: Array<{ nodeId: string; changes?: string[]; text: string }>;
    };
    expect(brief.entries.find((entry) => entry.nodeId === 'plan')).toMatchObject({ changes: ['links'] });
    expect(brief.entries.find((entry) => entry.nodeId === 'plan')?.text).toContain('Missing target');
  });

  test('capped relations stay unseen while a complete nearby card is acknowledged', async () => {
    await twoCards();
    const target = canvasState.activeBoardId as string;
    for (let index = 0; index < 8; index += 1) {
      canvasState.addNode(makeNode({ id: `local-${index}`, type: 'markdown' }));
      await executeOperation('edge.add', {
        id: `local-edge-${index}`,
        from: 'plan',
        to: `local-${index}`,
        type: 'relation',
      });
    }
    await executeOperation('pin.set', { nodeIds: ['plan', 'risk'] });
    await executeOperation('context.get', { consumer: 'capped-reader', budget: 50000 });
    const before = links('plan');
    expect(canvasState.getSeenLinks().plan).toBe(before);
    const { board } = (await executeOperation('board.create', { name: 'Incoming' })) as { board: { id: string } };
    await executeOperation('board.open', { id: board.id });
    canvasState.addNode(makeNode({ id: 'source', type: 'markdown' }));
    await executeOperation('edge.add', {
      from: 'source',
      to: 'plan',
      toBoardId: target,
      type: 'relation',
      label: 'NEW INCOMING',
    });
    await executeOperation('edge.add', {
      from: 'source',
      to: 'risk',
      toBoardId: target,
      type: 'relation',
      label: 'CONTROL INCOMING',
    });
    await executeOperation('board.open', { id: target });
    const revision = links('plan');
    expect(revision).toBeGreaterThan(before);
    const brief = (await executeOperation('context.get', { consumer: 'capped-reader', budget: 50000 })) as {
      entries: Array<{ nodeId: string; text: string; linksComplete?: false }>;
    };
    const capped = brief.entries.find((entry) => entry.nodeId === 'plan');
    expect(capped?.text).toContain('… 1 more relations');
    expect(capped?.text).not.toContain('NEW INCOMING');
    expect(capped?.linksComplete).toBe(false);
    expect(canvasState.getSeenLinks().plan).toBe(before);
    expect(brief.entries.find((entry) => entry.nodeId === 'risk')?.text).toContain('CONTROL INCOMING');
    expect(canvasState.getSeenLinks().risk).toBe(links('risk'));

    // A pinned-board map carries summaries, not card relations, even at a large budget.
    await executeOperation('board.pin', { id: target });
    await executeOperation('board.open', { id: board.id });
    await executeOperation('context.get', { budget: 50000 });
    await executeOperation('board.open', { id: target });
    expect(canvasState.getSeenLinks().plan).toBe(before);
    expect(canvasState.getNodeReadStatus().find((item) => item.nodeId === 'plan')).toBeUndefined();
  });

  test('brief resolves remote card titles in both directions without duplicating local edges', async () => {
    await twoCards();
    const source = canvasState.activeBoardId as string;
    const { board } = (await executeOperation('board.create', { name: 'Remote board' })) as { board: { id: string } };
    await executeOperation('board.open', { id: board.id });
    canvasState.addNode(makeNode({ id: 'risk', type: 'markdown', data: { title: 'Remote risk', content: 'Target' } }));
    await executeOperation('board.open', { id: source });
    canvasState.updateNode('plan', { data: { title: 'Source plan' } });
    canvasState.addEdge({ id: 'local', from: 'plan', to: 'risk', type: 'depends-on' });
    canvasState.addEdge({
      id: 'remote',
      from: 'plan',
      to: 'risk',
      toBoardId: board.id,
      type: 'references',
      label: 'remote label',
    });
    canvasState.addEdge({ id: 'missing', from: 'plan', to: 'absent', toBoardId: board.id, type: 'flow' });
    const read = async () =>
      (await executeOperation('context.get', {})) as { entries: Array<{ nodeId: string; text: string }> };
    const outgoing = (await read()).entries.find((entry) => entry.nodeId === 'plan')?.text ?? '';
    expect(outgoing).toContain('Remote board / Remote risk');
    expect(outgoing).toContain('remote label');
    expect(outgoing).toContain('Missing target');
    expect(outgoing).toContain(`${board.id} / absent`);
    expect(outgoing.match(/→ depends-on/g)).toHaveLength(1);
    await executeOperation('board.open', { id: board.id });
    const incoming = (await read()).entries.find((entry) => entry.nodeId === 'risk')?.text ?? '';
    expect(incoming).toContain('← references "remote label": Relations / Source plan');
    expect(incoming).not.toContain('depends-on');
  });

  test('add, relabel and remove advance both links revisions; text, style and auto-edges do not', async () => {
    await twoCards();
    const cursor = canvasState.getContentRevision().revision;
    const text = { plan: content('plan'), risk: content('risk') };

    canvasState.addEdge({ id: 'e1', from: 'plan', to: 'risk', type: 'depends-on' });
    expect(links('plan')).toBeGreaterThan(cursor);
    expect(links('risk')).toBe(links('plan'));
    expect(content('plan')).toBe(text.plan);
    expect(edge('e1')?.revision).toBe(links('plan'));
    expect(edge('e1')?.changedBy?.actor).toBe('agent');
    const brief = (await executeOperation('context.get', { since: cursor })) as {
      entries: Array<{ nodeId: string; text: string }>;
    };
    expect(brief.entries.find((entry) => entry.nodeId === 'plan')?.text).toContain('→ depends-on');

    let before = links('plan');
    canvasState.updateEdge('e1', { style: 'dashed' });
    expect(links('plan')).toBe(before);
    canvasState.updateEdge('e1', { label: 'blocked by' });
    expect(links('plan')).toBeGreaterThan(before);
    expect(edge('e1')?.revision).toBe(links('plan'));

    before = links('risk');
    canvasState.removeEdge('e1');
    expect(links('risk')).toBeGreaterThan(before);
    expect(content('risk')).toBe(text.risk);

    before = links('plan');
    canvasState.addEdge({ id: 'codegraph-plan-risk', from: 'plan', to: 'risk', type: 'depends-on' });
    expect(links('plan')).toBe(before);
    expect(edge('codegraph-plan-risk')?.revision).toBeUndefined();
  });

  test('a brief that carries either end marks the link seen; a later change is unseen again', async () => {
    await twoCards();
    canvasState.addEdge({ id: 'e1', from: 'plan', to: 'risk', type: 'relation', label: 'supports' });
    const revision = edge('e1')?.revision ?? 0;
    expect(canvasState.getSeenLinks()).toEqual({});

    await executeOperation('context.get', {});
    const seen = canvasState.getSeenLinks();
    expect(Math.max(seen.plan ?? -1, seen.risk ?? -1)).toBeGreaterThanOrEqual(revision);
    const status = (await executeOperation('ax.reads.status', {})) as { links: Record<string, number> };
    expect(status.links).toEqual(seen);

    canvasState.updateEdge('e1', { label: 'contradicts' });
    const after = canvasState.getSeenLinks();
    expect(edge('e1')?.revision ?? 0).toBeGreaterThan(Math.max(after.plan ?? -1, after.risk ?? -1));
  });

  test('stamps survive a reload, and a restore that changes links restamps both ends', async () => {
    await twoCards();
    canvasState.addEdge({ id: 'e1', from: 'plan', to: 'risk', type: 'relation' });
    const stamped = edge('e1');
    await executeOperation('snapshot.save', { name: 'with link' });
    canvasState.removeEdge('e1');
    const text = content('plan');
    const before = links('plan');

    await executeOperation('snapshot.restore', { id: 'with link' });
    expect(edge('e1')).toBeDefined();
    expect(links('plan')).toBeGreaterThan(before);
    expect(content('plan')).toBe(text);
    expect(edge('e1')?.revision).toBe(links('plan'));

    const restored = edge('e1');
    canvasState.flushToDisk();
    canvasState.close();
    canvasState.setWorkspaceRoot(root);
    expect(canvasState.loadFromDisk({ clearExisting: true })).toBe(true);
    expect(edge('e1')?.revision).toBe(restored?.revision);
    expect(edge('e1')?.changedBy).toEqual(restored?.changedBy);
    expect(links('plan')).toBe(restored?.revision ?? -1);
    expect(stamped?.revision).toBeLessThan(restored?.revision ?? 0);
  });

  test('undoing a node or style change never rolls a links revision or stamp back', async () => {
    await twoCards();
    canvasState.onMutation((info) => mutationHistory.record(info));
    canvasState.addEdge({ id: 'e1', from: 'plan', to: 'risk', type: 'relation' });
    canvasState.updateNode('plan', { position: { x: 40, y: 40 } });
    canvasState.updateEdge('e1', { style: 'dashed' });
    canvasState.updateEdge('e1', { label: 'supports' });
    const stamp = edge('e1')?.revision ?? 0;
    expect(links('plan')).toBe(stamp);

    mutationHistory.undo(); // relabel: a link change of its own, restamped
    mutationHistory.undo(); // style: keeps the current stamp
    const afterStyleUndo = edge('e1')?.revision ?? 0;
    expect(afterStyleUndo).toBeGreaterThan(stamp);
    mutationHistory.undo(); // the move: links revision stays
    expect(links('plan')).toBe(afterStyleUndo);
  });

  test('deleting a card stamps the card it was linked to', async () => {
    await twoCards();
    canvasState.addEdge({ id: 'e1', from: 'plan', to: 'risk', type: 'relation' });
    const before = links('risk');
    canvasState.removeNode('plan');
    expect(links('risk')).toBeGreaterThan(before);
  });

  test('a copied board starts without the source board stamps', async () => {
    await twoCards();
    canvasState.addEdge({ id: 'e1', from: 'plan', to: 'risk', type: 'relation', label: 'supports' });
    const source = canvasState.activeBoardId as string;
    const copy = canvasState.createBoardFromBoard({ sourceBoardId: source, name: 'Copy', nodeIds: ['plan', 'risk'] });
    const read = canvasState.readBoard(copy?.id as string, false);
    expect(read?.state.edges).toHaveLength(1);
    expect(read?.state.edges[0]?.revision).toBeUndefined();
    expect(read?.state.edges[0]?.changedBy).toBeUndefined();
    expect(read?.state.nodes.every((item) => (item.linksRevision ?? 0) === 0)).toBe(true);
  });

  test('a clipped entry has not carried its relations; a pinned board records its unclipped summaries', () => {
    const base = {
      channel: 'operation' as const,
      resource: 'context.get',
      source: 'mcp',
      consumer: null,
      agentId: null,
    };
    const brief = {
      board: { boardId: 'a' },
      entries: [
        {
          sourceBoardId: 'a',
          nodeId: 'whole',
          reason: 'pinned',
          text: 'Summary\n→ relation: x',
          summaryOnly: true,
          linksRevision: 0,
        },
        { sourceBoardId: 'a', nodeId: 'cut', reason: 'changed', text: 'Summ', summaryOnly: true, truncated: true },
        { sourceBoardId: 'b', nodeId: 'board:b', reason: 'pinned-board', text: 'Board b' },
        {
          sourceBoardId: 'b',
          nodeId: 'b-card',
          reason: 'pinned-board',
          text: 'Card',
          summaryOnly: true,
          linksRevision: 3,
        },
        { sourceBoardId: 'b', nodeId: 'b-cut', reason: 'pinned-board', text: 'Ca', summaryOnly: true, truncated: true },
      ],
    };
    const read = contextReadFromPayload({ ...base, pinnedNodeIds: ['cut'] }, brief);
    expect(read.deliveredNodeIds).toEqual(['cut']);
    expect(read.seenNodeIds).toContain('whole');
    expect(read.seenNodeIds).not.toContain('cut');
    expect(read.seenLinkRevisions).toEqual({ whole: 0 });
    expect(pinnedBoardReads(base, brief).map((item) => [item.boardId, item.seenNodeIds])).toEqual([['b', ['b-card']]]);
    expect(pinnedBoardReads(base, brief)[0]?.seenLinkRevisions).toEqual({ 'b-card': 3 });
  });

  test('a link keeps its author until a person changes it; undo restores it as it was (LinkAuthorship.dc.html)', async () => {
    await twoCards();
    canvasState.onMutation((info) => mutationHistory.record(info));
    canvasState.addEdge({ id: 'e1', from: 'plan', to: 'risk', type: 'relation', label: 'supports' });
    const drawn = edge('e1');
    expect(drawn?.changedBy?.actor).toBe('agent');
    expect(drawn?.createdBy).toEqual(drawn?.changedBy);
    expect(typeof drawn?.changedAt).toBe('string');
    expect(drawn?.createdAt).toBe(drawn?.changedAt);

    // Deleting and undoing restores the agent's link, not a new one by whoever pressed undo.
    withCurrentActor({ actor: 'human', source: 'browser' }, () => canvasState.removeEdge('e1'));
    withCurrentActor({ actor: 'human', source: 'browser' }, () => mutationHistory.undo());
    expect(edge('e1')?.changedBy).toEqual(drawn?.changedBy);
    expect(edge('e1')?.createdAt).toBe(drawn?.createdAt);

    // A person's relabel takes it over; who first drew it stays. Undoing the
    // relabel hands the link back to the agent, under a new revision.
    withCurrentActor({ actor: 'human', source: 'browser' }, () => canvasState.updateEdge('e1', { label: 'informs' }));
    expect(edge('e1')?.changedBy?.actor).toBe('human');
    expect(edge('e1')?.createdBy).toEqual(drawn?.createdBy);
    const relabelled = edge('e1')?.revision ?? 0;
    withCurrentActor({ actor: 'human', source: 'browser' }, () => mutationHistory.undo());
    expect(edge('e1')?.label).toBe('supports');
    expect(edge('e1')?.changedBy).toEqual(drawn?.changedBy);
    expect(edge('e1')?.revision ?? 0).toBeGreaterThan(relabelled);
    withCurrentActor({ actor: 'human', source: 'browser' }, () => mutationHistory.redo());
    expect(edge('e1')?.changedBy?.actor).toBe('human');

    // Authorship survives a reload.
    const before = edge('e1');
    canvasState.flushToDisk();
    canvasState.close();
    canvasState.setWorkspaceRoot(root);
    expect(canvasState.loadFromDisk({ clearExisting: true })).toBe(true);
    const after = edge('e1');
    expect([after?.changedBy, after?.changedAt, after?.createdBy, after?.createdAt]).toEqual([
      before?.changedBy,
      before?.changedAt,
      before?.createdBy,
      before?.createdAt,
    ]);
  });

  test('undoing a snapshot restore brings a link back with its author, not as the undoer’s', async () => {
    await twoCards();
    canvasState.onMutation((info) => mutationHistory.record(info));
    await executeOperation('snapshot.save', { name: 'before the link' });
    canvasState.addEdge({ id: 'e1', from: 'plan', to: 'risk', type: 'relation', label: 'supports' });
    const drawn = edge('e1');
    expect(drawn?.changedBy?.actor).toBe('agent');

    await withCurrentActor({ actor: 'human', source: 'browser' }, () =>
      executeOperation('snapshot.restore', { id: 'before the link' }),
    );
    expect(edge('e1')).toBeUndefined();
    withCurrentActor({ actor: 'human', source: 'browser' }, () => mutationHistory.undo());
    expect(edge('e1')?.changedBy).toEqual(drawn?.changedBy);
    expect(edge('e1')?.createdAt).toBe(drawn?.createdAt);
    expect(edge('e1')?.revision ?? 0).toBeGreaterThan(drawn?.revision ?? 0);
  });
});
