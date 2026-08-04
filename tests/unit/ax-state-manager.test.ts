/**
 * Unit tests for AxStateManager (plan-009 H7 remainder).
 *
 * The manager is constructed directly with fake injected deps — no canvasState
 * singleton, no HTTP server — so these tests pin the module's own contracts:
 * the three state partitions (canvas-bound vs timeline vs host capability),
 * normalization against the owner's node set on read AND write, undo/redo
 * closure recording through the suppression wrapper, save/notify wiring, the
 * null-returning error paths, and the DB-less / DB-failure degrade paths.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import type { Database } from 'bun:sqlite';
import { AxStateManager, type AxStateManagerDeps } from '../../src/server/ax-state-manager.ts';
import { openCanvasDb } from '../../src/server/canvas-db.ts';
import { AX_COMMAND_REGISTRY } from '../../src/server/ax-state.ts';
import type { CanvasChangeType, MutationRecordInfo } from '../../src/server/canvas-state.ts';

interface Harness {
  manager: AxStateManager;
  nodeIds: Set<string>;
  db: Database | null;
  counters: { saves: number; suppressedRuns: number };
  changes: CanvasChangeType[];
  mutations: MutationRecordInfo[];
  closeDb: () => void;
}

const harnesses: Harness[] = [];

function createHarness(options: { nodeIds?: string[]; withDb?: boolean; db?: Database } = {}): Harness {
  const nodeIds = new Set(options.nodeIds ?? []);
  const ownsDb = options.db === undefined && options.withDb !== false;
  const db = options.db ?? (ownsDb ? openCanvasDb(':memory:') : null);
  const counters = { saves: 0, suppressedRuns: 0 };
  const changes: CanvasChangeType[] = [];
  const mutations: MutationRecordInfo[] = [];
  let dbClosed = false;
  const deps: AxStateManagerDeps = {
    getNodeIds: () => nodeIds,
    getDb: () => db,
    scheduleSave: () => {
      counters.saves += 1;
    },
    notifyChange: (type) => {
      changes.push(type);
    },
    recordMutation: (info) => {
      mutations.push(info);
    },
    // Real owner wraps closures in withSuppressedRecording; the counter lets
    // tests prove replay goes through the wrapper (so replay cannot re-record).
    suppressed: (fn) => () => {
      counters.suppressedRuns += 1;
      fn();
    },
  };
  const harness: Harness = {
    manager: new AxStateManager(deps),
    nodeIds,
    db,
    counters,
    changes,
    mutations,
    closeDb: () => {
      if (ownsDb && db && !dbClosed) {
        dbClosed = true;
        db.close();
      }
    },
  };
  harnesses.push(harness);
  return harness;
}

afterEach(() => {
  for (const harness of harnesses.splice(0)) harness.closeDb();
});

describe('ax focus (canvas-bound)', () => {
  test('setAxFocus prunes unknown node ids, derives primary from the first valid id, and wires save/notify/history', () => {
    const h = createHarness({ nodeIds: ['a', 'b'] });
    // 'ghost' leads the raw list — primary must fall back to the first VALID id.
    const focus = h.manager.setAxFocus(['ghost', 'b', 'a']);
    expect(focus.nodeIds).toEqual(['b', 'a']);
    expect(focus.primaryNodeId).toBe('b');
    expect(focus.source).toBe('api');
    expect(focus.updatedAt).toBeTruthy();
    expect(h.counters.saves).toBe(1);
    expect(h.changes).toEqual(['ax']);
    expect(h.mutations).toHaveLength(1);
    expect(h.mutations[0].operationType).toBe('setAxFocus');

    // Explicit source is respected.
    expect(h.manager.setAxFocus(['a'], { source: 'browser' }).source).toBe('browser');
  });

  test('recordHistory:false still saves and notifies but records no history entry', () => {
    const h = createHarness({ nodeIds: ['a'] });
    h.manager.setAxFocus(['a'], { recordHistory: false });
    expect(h.counters.saves).toBe(1);
    expect(h.changes).toEqual(['ax']);
    expect(h.mutations).toHaveLength(0);
  });

  test('clearAxFocus empties focus with source system', () => {
    const h = createHarness({ nodeIds: ['a'] });
    h.manager.setAxFocus(['a']);
    const cleared = h.manager.clearAxFocus();
    expect(cleared.nodeIds).toEqual([]);
    expect(cleared.primaryNodeId).toBeNull();
    expect(cleared.source).toBe('system');
  });

  test('recorded inverse/forward closures replay the state change through the suppression wrapper', () => {
    const h = createHarness({ nodeIds: ['a', 'b'] });
    h.manager.setAxFocus(['a']);
    h.manager.setAxFocus(['b']);
    const second = h.mutations[1];
    expect(h.counters.suppressedRuns).toBe(0);

    second.inverse();
    expect(h.manager.getAxFocus().nodeIds).toEqual(['a']);
    second.forward();
    expect(h.manager.getAxFocus().nodeIds).toEqual(['b']);

    // Both replays ran inside the injected suppression wrapper, and replay
    // itself recorded no new history entries.
    expect(h.counters.suppressedRuns).toBe(2);
    expect(h.mutations).toHaveLength(2);
  });
});

describe('work items (canvas-bound)', () => {
  test('addWorkItem defaults status todo, prunes unknown node ids, and records history', () => {
    const h = createHarness({ nodeIds: ['a'] });
    const item = h.manager.addWorkItem({ title: 'Fix flake', nodeIds: ['a', 'ghost'] });
    expect(item.status).toBe('todo');
    expect(item.nodeIds).toEqual(['a']);
    expect(item.source).toBe('api');
    expect(h.manager.getWorkItems().map((w) => w.id)).toEqual([item.id]);
    expect(h.mutations.map((m) => m.operationType)).toEqual(['addWorkItem']);
    expect(h.changes).toEqual(['ax']);
  });

  test('updateWorkItem merges the patch, filters node ids, and keeps the source unless overridden', () => {
    const h = createHarness({ nodeIds: ['a', 'b'] });
    const item = h.manager.addWorkItem({ title: 'T', detail: 'old', nodeIds: ['a'] }, { source: 'mcp' });
    const updated = h.manager.updateWorkItem(item.id, { status: 'blocked', nodeIds: ['b', 'ghost'] });
    expect(updated).not.toBeNull();
    expect(updated?.status).toBe('blocked');
    expect(updated?.detail).toBe('old');
    expect(updated?.nodeIds).toEqual(['b']);
    expect(updated?.source).toBe('mcp');

    // detail: null explicitly clears; source override wins.
    const cleared = h.manager.updateWorkItem(item.id, { detail: null }, { source: 'browser' });
    expect(cleared?.detail).toBeNull();
    expect(cleared?.source).toBe('browser');
  });

  test('updateWorkItem on an unknown id is a pure null — no save, no notify, no history', () => {
    const h = createHarness({ nodeIds: ['a'] });
    expect(h.manager.updateWorkItem('nope', { status: 'done' })).toBeNull();
    expect(h.counters.saves).toBe(0);
    expect(h.changes).toHaveLength(0);
    expect(h.mutations).toHaveLength(0);
  });
});

describe('approval gates (canvas-bound)', () => {
  test('requestApproval creates a pending gate; resolveApproval stamps decision, resolution, and resolvedAt', () => {
    const h = createHarness();
    const gate = h.manager.requestApproval({ title: 'Deploy?', action: 'deploy' });
    expect(gate.status).toBe('pending');
    expect(h.manager.getApproval(gate.id)?.id).toBe(gate.id);

    const resolved = h.manager.resolveApproval(gate.id, 'approved', { resolution: 'ship it' });
    expect(resolved?.status).toBe('approved');
    expect(resolved?.resolution).toBe('ship it');
    expect(resolved?.resolvedAt).toBeTruthy();
    expect(h.mutations.map((m) => m.operationType)).toEqual(['requestApproval', 'resolveApproval']);
  });

  test('resolveApproval on a non-pending or unknown gate returns null without side effects', () => {
    const h = createHarness();
    const gate = h.manager.requestApproval({ title: 'Once' });
    expect(h.manager.resolveApproval(gate.id, 'rejected')).not.toBeNull();
    const before = { saves: h.counters.saves, changes: h.changes.length, mutations: h.mutations.length };
    expect(h.manager.resolveApproval(gate.id, 'approved')).toBeNull(); // already resolved
    expect(h.manager.resolveApproval('nope', 'approved')).toBeNull(); // unknown id
    expect(h.counters.saves).toBe(before.saves);
    expect(h.changes).toHaveLength(before.changes);
    expect(h.mutations).toHaveLength(before.mutations);
    expect(h.manager.getApproval(gate.id)?.status).toBe('rejected');
  });
});

describe('review annotations (canvas-bound)', () => {
  test('a body-only annotation succeeds as an unanchored file note', () => {
    const h = createHarness();
    const note = h.manager.addReviewAnnotation({ body: 'general observation' });
    expect(note).not.toBeNull();
    expect(note?.anchorType).toBe('file');
    expect(note?.nodeId).toBeNull();
    expect(note?.kind).toBe('comment');
    expect(note?.severity).toBe('info');
    expect(h.manager.getReviewAnnotations()).toHaveLength(1);
  });

  test('a node-anchored review with an unknown node is rejected with zero side effects (no phantom write)', () => {
    const h = createHarness({ nodeIds: ['a'] });
    // Explicit node anchor without a usable node id.
    expect(h.manager.addReviewAnnotation({ body: 'x', anchorType: 'node' })).toBeNull();
    // Implicit node anchor (nodeId present) pointing at a node that does not exist.
    expect(h.manager.addReviewAnnotation({ body: 'x', nodeId: 'ghost' })).toBeNull();
    expect(h.manager.getReviewAnnotations()).toHaveLength(0);
    expect(h.counters.saves).toBe(0);
    expect(h.changes).toHaveLength(0);
    expect(h.mutations).toHaveLength(0);
  });

  test('a valid nodeId implies a node anchor and sticks', () => {
    const h = createHarness({ nodeIds: ['a'] });
    const review = h.manager.addReviewAnnotation({ body: 'looks off', nodeId: 'a', severity: 'warning' });
    expect(review?.anchorType).toBe('node');
    expect(review?.nodeId).toBe('a');
    expect(review?.severity).toBe('warning');
  });

  test('updateReviewAnnotation merges the patch; unknown id returns null', () => {
    const h = createHarness({ nodeIds: ['a'] });
    const review = h.manager.addReviewAnnotation({ body: 'finding', nodeId: 'a', kind: 'finding' });
    expect(review).not.toBeNull();
    const updated = h.manager.updateReviewAnnotation(review?.id ?? '', { status: 'resolved', body: 'fixed' });
    expect(updated?.status).toBe('resolved');
    expect(updated?.body).toBe('fixed');
    expect(updated?.kind).toBe('finding');
    expect(h.manager.updateReviewAnnotation('nope', { status: 'resolved' })).toBeNull();
  });
});

describe('elicitations (canvas-bound)', () => {
  test('requestElicitation creates a pending request; respondElicitation stores the response and answers it', () => {
    const h = createHarness();
    const elicitation = h.manager.requestElicitation({ prompt: 'Which env?', fields: ['env'] });
    expect(elicitation.status).toBe('pending');
    expect(h.manager.getElicitation(elicitation.id)?.status).toBe('pending');

    const answered = h.manager.respondElicitation(elicitation.id, { env: 'prod' });
    expect(answered?.status).toBe('answered');
    expect(answered?.response).toEqual({ env: 'prod' });
    expect(answered?.resolvedAt).toBeTruthy();
  });

  test('respondElicitation on an answered or unknown elicitation returns null', () => {
    const h = createHarness();
    const elicitation = h.manager.requestElicitation({ prompt: 'Once' });
    expect(h.manager.respondElicitation(elicitation.id, { ok: true })).not.toBeNull();
    expect(h.manager.respondElicitation(elicitation.id, { ok: false })).toBeNull();
    expect(h.manager.respondElicitation('nope', {})).toBeNull();
    // The first response is preserved.
    expect(h.manager.getElicitation(elicitation.id)?.response).toEqual({ ok: true });
  });
});

describe('mode requests (canvas-bound)', () => {
  test('requestMode creates a pending request; resolveModeRequest stamps the decision once', () => {
    const h = createHarness();
    const request = h.manager.requestMode({ mode: 'autonomous', reason: 'batch work' });
    expect(request.status).toBe('pending');
    expect(h.manager.getModeRequest(request.id)?.mode).toBe('autonomous');

    const resolved = h.manager.resolveModeRequest(request.id, 'approved', { resolution: 'go' });
    expect(resolved?.status).toBe('approved');
    expect(resolved?.resolution).toBe('go');
    expect(h.manager.resolveModeRequest(request.id, 'rejected')).toBeNull(); // no longer pending
    expect(h.manager.resolveModeRequest('nope', 'approved')).toBeNull();
  });
});

describe('policy (canvas-bound)', () => {
  test('defaults to an empty policy; setPolicy merges patches without clobbering; undo restores', () => {
    const h = createHarness();
    expect(h.manager.getPolicy()).toEqual({
      tools: { allowed: [], excluded: [], approvalRequired: [] },
      prompt: { systemAppend: null, mode: null },
    });

    h.manager.setPolicy({ tools: { excluded: ['rm -rf'] } });
    const merged = h.manager.setPolicy({ prompt: { mode: 'plan' } });
    // The second patch must not clobber the first.
    expect(merged.tools.excluded).toEqual(['rm -rf']);
    expect(merged.prompt.mode).toBe('plan');
    expect(merged.tools.allowed).toEqual([]);

    h.mutations[h.mutations.length - 1].inverse();
    expect(h.manager.getPolicy().prompt.mode).toBeNull();
    expect(h.manager.getPolicy().tools.excluded).toEqual(['rm -rf']);
  });
});

describe('command registry', () => {
  test('getCommandRegistry lists the five built-in pmx commands', () => {
    const h = createHarness({ withDb: false });
    expect(
      h.manager
        .getCommandRegistry()
        .map((c) => c.name)
        .sort(),
    ).toEqual(['pmx.execute', 'pmx.plan', 'pmx.promote-context', 'pmx.review', 'pmx.summarize']);
  });

  test('invokeCommand rejects unknown names without recording anything', () => {
    const h = createHarness();
    expect(h.manager.invokeCommand('rm -rf /')).toBeNull();
    expect(h.manager.getAxEvents()).toHaveLength(0);
    expect(h.changes).toHaveLength(0);
  });

  test('invokeCommand records a command timeline event (intent only, no history entry)', () => {
    const h = createHarness();
    const event = h.manager.invokeCommand('pmx.plan', { scope: 'auth' }, { source: 'browser' });
    expect(event?.kind).toBe('command');
    expect(event?.summary).toBe('pmx.plan');
    expect(event?.detail).toBe(AX_COMMAND_REGISTRY['pmx.plan'].description);
    expect(event?.data).toEqual({ command: 'pmx.plan', args: { scope: 'auth' } });
    expect(event?.source).toBe('browser');
    expect(h.manager.getAxEvents().map((e) => e.id)).toEqual([event!.id]);
    // Timeline, not canvas-bound: no undo history, no debounced blob save.
    expect(h.mutations).toHaveLength(0);
    expect(h.counters.saves).toBe(0);
  });
});

describe('host capability (own partition)', () => {
  test('setHostCapability normalizes the report and roundtrips through the DB partition', () => {
    const h = createHarness();
    expect(h.manager.getHostCapability()).toBeNull();
    const cap = h.manager.setHostCapability({ host: 'copilot', capabilities: { canvas: true, tools: true } });
    expect(cap.host).toBe('copilot');
    expect(cap.canvas).toBe(true);
    expect(cap.tools).toBe(true);
    expect(cap.hooks).toBe(false);
    expect(cap.reportedAt).toBeTruthy();
    expect(h.changes).toEqual(['ax']);

    // A second manager sharing the same DB loads it back (survives "restart").
    const second = createHarness({ db: h.db ?? undefined });
    expect(second.manager.getHostCapability()).toBeNull();
    second.manager.loadHostCapabilityFromDb();
    expect(second.manager.getHostCapability()?.host).toBe('copilot');
    expect(second.manager.getHostCapability()?.canvas).toBe(true);
  });

  test('junk input degrades to an empty capability with reportedAt; works without a DB', () => {
    const h = createHarness({ withDb: false });
    const cap = h.manager.setHostCapability('garbage');
    expect(cap.host).toBeNull();
    expect(cap.canvas).toBe(false);
    expect(cap.reportedAt).toBeTruthy();
    expect(h.manager.getHostCapability()?.reportedAt).toBe(cap.reportedAt);
    h.manager.loadHostCapabilityFromDb(); // no DB → no-op, must not throw
  });
});

describe('timeline partition (DB-direct)', () => {
  test('appends assign monotonic seq, notify ax-timeline, and never touch save or history', () => {
    const h = createHarness();
    const first = h.manager.recordAxEvent({ kind: 'tool-start', summary: 'bun test' });
    const second = h.manager.recordAxEvent({ kind: 'tool-result', summary: 'passed' });
    const evidence = h.manager.addEvidence({ kind: 'test-output', title: '42 pass', ref: 'tests/unit' });
    const steering = h.manager.recordSteeringMessage('look at the flaky suite', { source: 'browser' });

    expect(first.seq).toBe(1);
    expect(second.seq).toBe(2);
    expect(evidence.seq).toBe(1); // evidence has its own sequence
    expect(steering.seq).toBe(1);
    expect(steering.delivered).toBe(false);
    expect(h.changes).toEqual(['ax-timeline', 'ax-timeline', 'ax-timeline', 'ax-timeline']);
    // Timeline is DB-direct: no canvas-bound blob save, no undo history.
    expect(h.counters.saves).toBe(0);
    expect(h.mutations).toHaveLength(0);
  });

  test('a DB-less manager degrades to seq 0 appends and empty readers', () => {
    const h = createHarness({ withDb: false });
    expect(h.manager.recordAxEvent({ kind: 'note', summary: 'n' }).seq).toBe(0);
    expect(h.manager.addEvidence({ kind: 'logs', title: 't' }).seq).toBe(0);
    expect(h.manager.recordSteeringMessage('m').seq).toBe(0);
    // Change notifications still fire so live surfaces refresh.
    expect(h.changes).toEqual(['ax-timeline', 'ax-timeline', 'ax-timeline']);
    expect(h.manager.markSteeringDelivered('anything')).toBe(false);
    expect(h.manager.getAxEvents()).toEqual([]);
    expect(h.manager.getAxEvidence()).toEqual([]);
    expect(h.manager.getAxSteering()).toEqual([]);
    expect(h.manager.getPendingSteering()).toEqual([]);
    expect(h.manager.getPendingSteeringCount()).toBe(0);
    expect(h.manager.getAxTimelineSummary().counts).toEqual({ events: 0, evidence: 0, steering: 0 });
  });

  test('a DB write failure degrades to seq 0 / false instead of throwing', () => {
    const h = createHarness();
    h.closeDb(); // getDb still hands out the closed handle → appends must catch
    const event = h.manager.recordAxEvent({ kind: 'note', summary: 'after close' });
    expect(event.seq).toBe(0);
    expect(h.manager.markSteeringDelivered('any')).toBe(false);
    // Host capability upsert also degrades: memory updated, DB error swallowed.
    expect(h.manager.setHostCapability({ host: 'copilot' }).host).toBe('copilot');
    expect(h.manager.getHostCapability()?.host).toBe('copilot');
  });

  test('steering delivery: FIFO pending order, loop-safe consumer exclusion, newest-first context order', () => {
    const h = createHarness();
    const fromCopilot = h.manager.recordSteeringMessage('one', { source: 'copilot' });
    const fromBrowser = h.manager.recordSteeringMessage('two', { source: 'browser' });
    const fromApi = h.manager.recordSteeringMessage('three');

    // Delivery queue is FIFO (oldest first)…
    expect(h.manager.getPendingSteering().map((s) => s.id)).toEqual([fromCopilot.id, fromBrowser.id, fromApi.id]);
    // …while the context lead block is newest-first.
    expect(h.manager.getPendingSteeringForContext().map((s) => s.id)).toEqual([
      fromApi.id,
      fromBrowser.id,
      fromCopilot.id,
    ]);
    // Loop safety: a consumer never receives steering it originated.
    expect(h.manager.getPendingSteering({ consumer: 'copilot' }).map((s) => s.id)).toEqual([
      fromBrowser.id,
      fromApi.id,
    ]);
    expect(h.manager.getPendingSteeringCount()).toBe(3);
    expect(h.manager.getPendingSteeringCount('browser')).toBe(2);

    expect(h.manager.markSteeringDelivered(fromCopilot.id)).toBe(true);
    expect(h.manager.markSteeringDelivered('nope')).toBe(false);
    expect(h.manager.getPendingSteering().map((s) => s.id)).toEqual([fromBrowser.id, fromApi.id]);
    expect(h.manager.getAxSteering({ onlyPending: true }).map((s) => s.id)).not.toContain(fromCopilot.id);
  });

  test('getAxTimeline aggregates events, evidence, steering, and summary counts', () => {
    const h = createHarness();
    h.manager.recordAxEvent({ kind: 'note', summary: 'e' });
    h.manager.addEvidence({ kind: 'diff', title: 'd' });
    h.manager.recordSteeringMessage('s');
    const timeline = h.manager.getAxTimeline();
    expect(timeline.events).toHaveLength(1);
    expect(timeline.evidence).toHaveLength(1);
    expect(timeline.steering).toHaveLength(1);
    expect(timeline.summary.counts).toEqual({ events: 1, evidence: 1, steering: 1 });
  });
});

describe('ingestActivity (report primitive A)', () => {
  test('failure defaults: timeline event + blocked work item + logs evidence + node-anchored error review', () => {
    const h = createHarness({ nodeIds: ['a'] });
    const result = h.manager.ingestActivity({
      kind: 'failure',
      title: 'Build failed',
      summary: 'tsc exploded',
      ref: 'src/x.ts',
      nodeIds: ['ghost', 'a'],
    });

    expect(result.event.kind).toBe('failure');
    expect(result.event.data?.activityKind).toBe('failure');
    expect(result.event.data?.ref).toBe('src/x.ts');
    // Timeline records node ids as reported (audit trail); canvas-bound prunes.
    expect(result.event.nodeIds).toEqual(['ghost', 'a']);

    expect(result.workItem?.status).toBe('blocked');
    expect(result.workItem?.detail).toBe('tsc exploded');
    expect(result.workItem?.nodeIds).toEqual(['a']);

    expect(result.evidence?.kind).toBe('logs');
    expect(result.evidence?.ref).toBe('src/x.ts');
    expect(result.evidence?.body).toBe('tsc exploded');

    // Review anchors to the first VALID node id.
    expect(result.review?.kind).toBe('finding');
    expect(result.review?.severity).toBe('error');
    expect(result.review?.anchorType).toBe('node');
    expect(result.review?.nodeId).toBe('a');
  });

  test('failure without a valid node anchors the review to the ref file', () => {
    const h = createHarness();
    const result = h.manager.ingestActivity({ kind: 'error', title: 'boom', ref: 'scripts/run.sh' });
    expect(result.event.kind).toBe('failure'); // 'error' maps onto the failure event kind
    expect(result.review?.anchorType).toBe('file');
    expect(result.review?.file).toBe('scripts/run.sh');
    expect(result.review?.nodeId).toBeNull();
  });

  test('tool-result success yields evidence only; tool-start and note are event-only', () => {
    const h = createHarness();
    const success = h.manager.ingestActivity({ kind: 'tool-result', title: 'bun test', outcome: 'success' });
    expect(success.evidence?.kind).toBe('tool-result');
    expect(success.workItem).toBeNull();
    expect(success.review).toBeNull();

    const start = h.manager.ingestActivity({ kind: 'tool-start', title: 'bun test' });
    expect(start.workItem).toBeNull();
    expect(start.evidence).toBeNull();
    expect(start.review).toBeNull();

    const note = h.manager.ingestActivity({ kind: 'note', title: 'context' });
    expect(note.event.kind).toBe('assistant-message'); // activity kind → coarser event kind
    expect(note.event.data?.activityKind).toBe('note');
    expect(note.evidence).toBeNull();

    // outcome:'failure' triggers the failure reactions regardless of kind.
    const failedTool = h.manager.ingestActivity({ kind: 'tool-result', title: 'lint', outcome: 'failure' });
    expect(failedTool.workItem?.status).toBe('blocked');
  });

  test('reactions:false suppress the defaults; overrides force reactions on non-failures', () => {
    const h = createHarness();
    const suppressed = h.manager.ingestActivity({
      kind: 'failure',
      title: 'quiet failure',
      reactions: { workItem: false, evidence: false, review: false },
    });
    expect(suppressed.workItem).toBeNull();
    expect(suppressed.evidence).toBeNull();
    expect(suppressed.review).toBeNull();
    expect(h.manager.getWorkItems()).toHaveLength(0);
    expect(h.manager.getAxEvents()).toHaveLength(1); // the event itself always lands

    const forced = h.manager.ingestActivity({
      kind: 'note',
      title: 'forced reactions',
      reactions: {
        workItem: { status: 'in-progress', detail: 'tracking' },
        evidence: { kind: 'diff', body: 'the diff' },
        review: { severity: 'warning', kind: 'comment' },
      },
    });
    expect(forced.workItem?.status).toBe('in-progress');
    expect(forced.workItem?.detail).toBe('tracking');
    expect(forced.evidence?.kind).toBe('diff');
    expect(forced.evidence?.body).toBe('the diff');
    expect(forced.review?.severity).toBe('warning');
    expect(forced.review?.kind).toBe('comment');
  });

  test('canonical event data fields win over caller-supplied data (spoof-proof)', () => {
    const h = createHarness();
    const result = h.manager.ingestActivity({
      kind: 'note',
      title: 'spoof attempt',
      outcome: 'success',
      ref: 'real/ref.ts',
      data: { activityKind: 'failure', outcome: 'failure', ref: 'fake/ref.ts', custom: 'kept' },
    });
    expect(result.event.data?.activityKind).toBe('note');
    expect(result.event.data?.outcome).toBe('success');
    expect(result.event.data?.ref).toBe('real/ref.ts');
    expect(result.event.data?.custom).toBe('kept');
  });

  test('a review anchor failure never fails the whole ingest', () => {
    const h = createHarness(); // no valid nodes, no ref
    const result = h.manager.ingestActivity({
      kind: 'failure',
      title: 'anchorless',
      reactions: { review: { anchorType: 'node' } }, // forces a node anchor that cannot resolve
    });
    expect(result.review).toBeNull();
    expect(result.event.kind).toBe('failure');
    expect(result.workItem).not.toBeNull();
    expect(result.evidence).not.toBeNull();
  });
});

describe('canvas-bound partition plumbing', () => {
  test('getAxState returns a detached clone', () => {
    const h = createHarness({ nodeIds: ['a'] });
    const item = h.manager.addWorkItem({ title: 'real' });
    const state = h.manager.getAxState();
    state.workItems.splice(0);
    state.focus.nodeIds.push('a');
    expect(h.manager.getWorkItems().map((w) => w.id)).toEqual([item.id]);
    expect(h.manager.getAxFocus().nodeIds).toEqual([]);
  });

  test('reads re-normalize against the CURRENT node set (a deleted node vanishes without revalidate)', () => {
    const h = createHarness({ nodeIds: ['a'] });
    h.manager.addWorkItem({ title: 'anchored', nodeIds: ['a'] });
    h.manager.setAxFocus(['a']);
    h.nodeIds.delete('a');
    expect(h.manager.getWorkItems()[0].nodeIds).toEqual([]);
    expect(h.manager.getAxFocus().nodeIds).toEqual([]);
  });

  test('applyPersistedAx normalizes blobs against current nodes; garbage becomes an empty state', () => {
    const h = createHarness({ nodeIds: ['a'] });
    h.manager.applyPersistedAx({
      workItems: [{ id: 'w1', title: 'kept', nodeIds: ['ghost', 'a'] }],
      reviewAnnotations: [
        { id: 'r1', anchorType: 'node', nodeId: 'ghost', body: 'dropped' },
        { id: 'r2', anchorType: 'file', file: 'f.ts', body: 'kept' },
      ],
      focus: { nodeIds: ['ghost'] },
      policy: { tools: { excluded: ['x'] } },
    });
    expect(h.manager.getWorkItems().map((w) => [w.id, w.nodeIds] as const)).toEqual([['w1', ['a']]]);
    // A node-anchored review whose node is gone is dropped entirely.
    expect(h.manager.getReviewAnnotations().map((r) => r.id)).toEqual(['r2']);
    expect(h.manager.getAxFocus().nodeIds).toEqual([]);
    expect(h.manager.getPolicy().tools.excluded).toEqual(['x']);

    h.manager.applyPersistedAx('total garbage');
    expect(h.manager.getWorkItems()).toEqual([]);
    expect(h.manager.getReviewAnnotations()).toEqual([]);
  });

  test('resetCanvasBound clears the canvas-bound partition but leaves the timeline intact', () => {
    const h = createHarness({ nodeIds: ['a'] });
    h.manager.addWorkItem({ title: 'gone after reset' });
    const event = h.manager.recordAxEvent({ kind: 'note', summary: 'survives reset' });
    h.manager.resetCanvasBound();
    expect(h.manager.getWorkItems()).toEqual([]);
    expect(h.manager.getAxEvents().map((e) => e.id)).toEqual([event.id]);
  });

  test('revalidateAfterNodeRemoval re-anchors items, drops node-anchored reviews, and reports what changed', () => {
    const h = createHarness({ nodeIds: ['a', 'b'] });
    const work = h.manager.addWorkItem({ title: 'w', nodeIds: ['a', 'b'] });
    const gate = h.manager.requestApproval({ title: 'g', nodeIds: ['a'] });
    const elicitation = h.manager.requestElicitation({ prompt: 'e', nodeIds: ['a'] });
    const mode = h.manager.requestMode({ mode: 'plan', nodeIds: ['a'] });
    const reviewA = h.manager.addReviewAnnotation({ body: 'on a', nodeId: 'a' });
    const reviewB = h.manager.addReviewAnnotation({ body: 'on b', nodeId: 'b' });
    h.manager.setAxFocus(['a', 'b']);

    h.nodeIds.delete('a');
    const report = h.manager.revalidateAfterNodeRemoval('a');

    expect(report.reanchoredIds.sort()).toEqual([work.id, gate.id, elicitation.id, mode.id].sort());
    expect(report.removedReviewIds).toEqual([reviewA!.id]);
    expect(report.reanchoredFocus).toBe(true);

    // Items survive with the dangling id stripped; node-anchored reviews are dropped.
    expect(h.manager.getWorkItems()[0].nodeIds).toEqual(['b']);
    expect(h.manager.getApprovalGates()[0].nodeIds).toEqual([]);
    expect(h.manager.getReviewAnnotations().map((r) => r.id)).toEqual([reviewB!.id]);
    expect(h.manager.getAxFocus().nodeIds).toEqual(['b']);
    expect(h.manager.getAxFocus().primaryNodeId).toBe('b');
  });

  test('revalidateAfterNodeRemoval on an unreferenced node reports nothing', () => {
    const h = createHarness({ nodeIds: ['a', 'b'] });
    h.manager.addWorkItem({ title: 'w', nodeIds: ['b'] });
    h.nodeIds.delete('a');
    const report = h.manager.revalidateAfterNodeRemoval('a');
    expect(report.reanchoredIds).toEqual([]);
    expect(report.removedReviewIds).toEqual([]);
    expect(report.reanchoredFocus).toBe(false);
  });
});
