import { expect, test } from 'bun:test';
import { adviceSchema, adviseCanvas, type AdviceDecider, type AdviceRequest } from '../../plugins/amp/jev-advice.js';
import { reviewInput } from '../fixtures/jev-advice.js';

const thread = 'T-advice-test';
const representation: AdviceRequest = {
  action: 'representation',
  requestId: 'format',
  task: 'Draw a request flow',
  summary: 'Browser to server to database',
};
const score = (value: number) => ({
  type: 'score' as const,
  score: value,
  confidence: 1,
  legend: {},
  probabilities: {},
});

test('representation honors explicit formats without inference and otherwise chooses only existing formats', async () => {
  let calls = 0;
  const decide: AdviceDecider = async (request) => {
    calls++;
    expect(request.model).toBe('typesafe/jev');
    expect(request.threadID).toBe(thread);
    expect(request.state).toEqual({ task: representation.task, summary: representation.summary });
    return {
      model: 'fixture',
      answers: { format: { type: 'choice', choice: 'mermaid', confidence: 1, probabilities: {} } },
    };
  };
  for (const explicitFormat of ['markdown', 'unsupported-format']) {
    expect(await adviseCanvas({ ...representation, explicitFormat }, thread, decide)).toMatchObject({
      mode: 'explicit',
      format: explicitFormat,
    });
  }
  expect(calls).toBe(0);
  expect(await adviseCanvas(representation, thread, decide)).toMatchObject({
    mode: 'jev',
    format: 'mermaid',
    model: 'fixture',
  });
  expect(calls).toBe(1);
  expect(
    await adviseCanvas(representation, thread, async () => ({
      model: 'fixture',
      answers: { format: { type: 'choice', choice: 'unknown-renderer', confidence: 1, probabilities: {} } },
    })),
  ).toMatchObject({ mode: 'fallback', format: 'markdown', reason: 'invalid-response' });
});

test('review preserves every supplied change, stable ties and source inputs without declaring correctness', async () => {
  const input = reviewInput();
  input.changes.push({ id: 'another-copy', title: 'Caption', summary: 'Correct a second caption.' });
  const original = structuredClone(input);
  const result = await adviseCanvas(input, thread, async () => ({
    model: 'fixture',
    answers: { change0: score(0), change1: score(2), change2: score(0) },
  }));
  expect(result).toMatchObject({ mode: 'jev', orderedIds: ['auth', 'copy', 'another-copy'] });
  expect(result.limitation).toContain('not evidence');
  expect(input).toEqual(original);
  expect(
    await adviseCanvas(input, thread, async () => ({
      model: 'fixture',
      answers: { change0: score(0), change1: score(2) },
    })),
  ).toMatchObject({ mode: 'fallback', orderedIds: ['copy', 'auth', 'another-copy'], reason: 'invalid-response' });
});

test('advice rejects oversized and ambiguous input and falls back on provider failures', async () => {
  const input = reviewInput();
  expect(adviceSchema.safeParse({ ...input, changes: [input.changes[0], input.changes[0]] }).success).toBe(false);
  expect(
    adviceSchema.safeParse({
      ...input,
      changes: Array.from({ length: 21 }, (_, index) => ({ ...input.changes[0], id: String(index) })),
    }).success,
  ).toBe(false);
  expect(adviceSchema.safeParse({ ...representation, task: 'x'.repeat(2001) }).success).toBe(false);
  expect(adviceSchema.safeParse({ ...representation, secret: 'not accepted' }).success).toBe(false);
  for (const decide of [
    undefined,
    async () => {
      throw new Error('unavailable');
    },
  ] as Array<AdviceDecider | undefined>) {
    expect(await adviseCanvas(representation, thread, decide)).toMatchObject({
      mode: 'fallback',
      format: 'markdown',
      reason: 'unavailable',
    });
    expect(await adviseCanvas(input, thread, decide)).toMatchObject({ mode: 'fallback', orderedIds: ['copy', 'auth'] });
  }
  let calls = 0;
  expect(
    await adviseCanvas({ ...representation, summary: '\u0000'.repeat(12000) }, thread, async () => {
      calls++;
      throw new Error('must not call');
    }),
  ).toMatchObject({ reason: 'input-too-large' });
  expect(calls).toBe(0);
});

test('late advice cannot replace deterministic timeout fallback', async () => {
  const pending = Promise.withResolvers<Awaited<ReturnType<AdviceDecider>>>();
  const result = await adviseCanvas(reviewInput(), thread, () => pending.promise);
  expect(result).toMatchObject({ mode: 'fallback', reason: 'timeout', orderedIds: ['copy', 'auth'] });
  pending.resolve({ model: 'late', answers: { change0: score(0), change1: score(2) } });
  await pending.promise;
  expect(result.orderedIds).toEqual(['copy', 'auth']);
});
