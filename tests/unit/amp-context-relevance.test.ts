import { expect, test } from 'bun:test';
import type { ScoreAnswer } from '@ampcode/plugin';
import { rankContextBrief, type ContextDecider } from '../../plugins/amp/context-relevance.js';
import { relevanceBrief, relevanceCaseBrief, relevanceCases } from '../fixtures/context-relevance.js';

const thread = 'T-context-relevance';
const answer = (score: number): ScoreAnswer => ({
  type: 'score',
  score,
  legend: { '0': 'unrelated', '1': 'background', '2': 'direct' },
  probabilities: {},
  confidence: 0.9,
});

test('ranking only permutes optional slots, preserving pins, instructions, changes and receipt metadata', async () => {
  const brief = relevanceCaseBrief(relevanceCases[0]);
  brief.entries.splice(2, 0, { ...brief.entries[0], nodeId: 'instruction', reason: 'human' });
  brief.entries.push(
    { ...brief.entries[0], nodeId: 'changed', reason: 'changed' },
    { ...brief.entries[0], nodeId: 'board-pin', reason: 'pinned-board' },
    { ...brief.entries[0], nodeId: 'linked-pin', reason: 'linked', titleOnly: true },
  );
  const original = structuredClone(brief);
  const result = await rankContextBrief(brief, 'Diagnose checkout', thread, async (request) => {
    expect(request.model).toBe('typesafe/jev');
    expect(request.threadID).toBe(thread);
    expect(JSON.stringify(request.state)).not.toContain('Keep this unrelated pin');
    return { model: 'fixture-model', answers: { candidate0: answer(0.1), candidate1: answer(1.9) } };
  });
  expect(result.brief.entries.map((entry) => entry.nodeId)).toEqual([
    'explicit-pin',
    'retry',
    'instruction',
    'picnic',
    'changed',
    'board-pin',
    'linked-pin',
  ]);
  expect(result.brief).toEqual({
    ...original,
    entries: [
      original.entries[0],
      original.entries[3],
      original.entries[2],
      original.entries[1],
      ...original.entries.slice(4),
    ],
  });
  expect(brief).toEqual(original);
  expect(JSON.stringify(result.brief).length).toBe(JSON.stringify(brief).length);
  expect(result.report).toMatchObject({ mode: 'jev', model: 'fixture-model', eligible: 2, ranked: 2 });
});

test('retired and explicitly selected optional entries are excluded before inference', async () => {
  const brief = relevanceCaseBrief(relevanceCases[0]);
  for (const relevance of ['card-pinned', 'board-pinned', 'not-selected'] as const) {
    brief.entries.push({
      ...brief.entries[1],
      nodeId: relevance,
      title: `excluded-${relevance}`,
      qualification: {
        relevance,
        retired: relevance === 'not-selected',
        unknown: false,
        due: false,
        reasons: [],
        changedSinceRead: false,
        lastReadAt: null,
        lastValidatedAt: null,
        contentRevision: 1,
        contentChangedAt: null,
        observations: {},
        sources: [],
      },
    });
  }
  const result = await rankContextBrief(brief, 'task', thread, async (request) => {
    expect(JSON.stringify(request.state)).not.toContain('excluded-');
    return { model: 'fixture', answers: { candidate0: answer(0), candidate1: answer(2) } };
  });
  expect(result.report).toMatchObject({ mode: 'jev', eligible: 2 });
  expect(result.brief.entries.slice(3)).toEqual(brief.entries.slice(3));
});

test('ranking bounds input and questions, leaves the tail alone and preserves tie order', async () => {
  const brief = relevanceBrief(
    Array.from({ length: 23 }, (_, i) => ({
      sourceBoardId: 'fictional',
      nodeId: `card-${i}`,
      reason: 'folder',
      title: 't'.repeat(161),
      text: 's'.repeat(601),
      summaryOnly: true,
    })),
  );
  let calls = 0;
  const result = await rankContextBrief(brief, 'p'.repeat(2001), thread, async (request) => {
    calls++;
    const state = request.state as { task: string; candidates: Array<{ title: string; summary: string }> };
    expect(state.task).toHaveLength(2000);
    expect(state.candidates).toHaveLength(20);
    expect(state.candidates.every((item) => item.title.length === 160 && item.summary.length === 600)).toBe(true);
    expect(JSON.stringify(request.state).length).toBeLessThanOrEqual(24000);
    return {
      model: 'fixture-model',
      answers: Object.fromEntries(Object.keys(request.questions).map((key) => [key, answer(1)])),
    };
  });
  expect(calls).toBe(1);
  expect(result.brief).toEqual(brief);
  expect(result.report).toMatchObject({ eligible: 23, ranked: 20, inputClipped: true });
  brief.entries.forEach((entry) => {
    entry.text = '\u0000'.repeat(600);
  });
  expect(
    (
      await rankContextBrief(brief, 'task', thread, async () => {
        throw new Error('must not call');
      })
    ).report.reason,
  ).toBe('input-too-large');
});

test('missing API, refused calls and invalid answers keep the complete deterministic brief', async () => {
  const brief = relevanceCaseBrief(relevanceCases[0]);
  const deciders: Array<ContextDecider | undefined> = [
    undefined,
    async () => {
      throw new Error('provider disabled');
    },
    async () => ({ model: 'fixture', answers: {} }),
    async () => ({ model: 'fixture', answers: { candidate0: answer(0), candidate1: answer(Number.NaN) } }),
  ];
  for (const decide of deciders) {
    const result = await rankContextBrief(brief, 'task', thread, decide);
    expect(result.brief).toBe(brief);
    expect(result.report.mode).toBe('fallback');
    expect(result.report.ranked).toBe(0);
  }
  expect((await rankContextBrief(brief, ' ', thread)).report.reason).toBe('no-task');
  expect((await rankContextBrief(relevanceBrief([brief.entries[0]]), 'task', thread)).report.reason).toBe(
    'too-few-candidates',
  );
});

test('a timed-out decision returns deterministic context and its late answer cannot alter delivery', async () => {
  const brief = relevanceCaseBrief(relevanceCases[0]);
  let resolve!: (value: Awaited<ReturnType<ContextDecider>>) => void;
  const pending = new Promise<Awaited<ReturnType<ContextDecider>>>((done) => {
    resolve = done;
  });
  const result = await rankContextBrief(brief, 'task', thread, () => pending);
  expect(result.report.reason).toBe('timeout');
  resolve({ model: 'late', answers: { candidate0: answer(0), candidate1: answer(2) } });
  await pending;
  expect(result.brief).toBe(brief);
  expect(result.brief.entries[1].nodeId).toBe('picnic');
});
