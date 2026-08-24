import { describe, expect, test } from 'bun:test';
import { mergeTimeline, timelineCategory } from '../../src/client/state/session-store.ts';

describe('mergeTimeline', () => {
  test('a filter keeps only its category and applies BEFORE the cap, so sparse kinds are not starved', () => {
    const timeline = {
      events: [
        {
          id: 'e1',
          kind: 'policy' as const,
          summary: 'Fence set',
          detail: null,
          createdAt: '2026-08-23T13:00:00.000Z',
        },
        {
          id: 'e2',
          kind: 'yield' as const,
          summary: 'mia took over “Spec”',
          detail: null,
          createdAt: '2026-08-23T13:01:00.000Z',
        },
      ],
      evidence: [{ id: 'v1', title: 'tests green', body: null, createdAt: '2026-08-23T13:02:00.000Z' }],
      steering: [{ id: 's1', message: 'oldest steer', createdAt: '2026-08-23T12:00:00.000Z' }],
    };
    // 30 newer Update rows would push the lone steer out of a capped mixed feed…
    const writes = Array.from({ length: 30 }, (_, i) => ({
      id: `act-${i}`,
      at: `2026-08-23T14:${String(i).padStart(2, '0')}:00.000Z`,
      op: 'node.update',
      summary: `write ${i}`,
    }));
    expect(mergeTimeline(timeline, 20, writes, null).some((entry) => entry.kind === 'steer')).toBe(false);
    // …but the Steer chip still shows it (and the steering-shaped yield row).
    const steers = mergeTimeline(timeline, 20, writes, null, 'steer');
    expect(steers.map((entry) => `${entry.label}:${entry.body}`)).toEqual([
      'Yield:mia took over “Spec”',
      'Steer:oldest steer',
    ]);
    expect(mergeTimeline(timeline, 20, writes, null, 'update')).toHaveLength(20);
    expect(mergeTimeline(timeline, 20, writes, null, 'evidence').map((entry) => entry.label)).toEqual(['Evidence']);
    expect(mergeTimeline(timeline, 20, writes, null, 'event').map((entry) => entry.label)).toEqual(['Policy']);
    // The category mapping the chips rely on.
    expect(
      ['update', 'steer', 'steering', 'yield', 'evidence', 'policy', 'prompt'].map((kind) =>
        timelineCategory(kind as Parameters<typeof timelineCategory>[0]),
      ),
    ).toEqual(['update', 'steer', 'steer', 'steer', 'evidence', 'event', 'event']);
  });

  test('interleaves the three tables newest-first with kind labels and bounded length', () => {
    const merged = mergeTimeline(
      {
        events: [
          { id: 'e1', kind: 'prompt', summary: 'Ship it', detail: null, createdAt: '2026-08-23T14:02:00.000Z' },
          { id: 'e2', kind: 'tool-start', summary: 'bun test', detail: 'unit', createdAt: '2026-08-23T14:04:00.000Z' },
        ],
        evidence: [{ id: 'v1', title: '14 suites green', body: null, createdAt: '2026-08-23T14:03:00.000Z' }],
        steering: [{ id: 's1', message: 'focus on the gate', createdAt: '2026-08-23T14:05:00.000Z' }],
      },
      3,
    );
    expect(merged.map((entry) => `${entry.label}:${entry.body}`)).toEqual([
      'Steer:focus on the gate',
      'Tool run:bun test — unit',
      'Evidence:14 suites green',
    ]);
    expect(merged.every((entry) => entry.id.length > 0)).toBe(true);
  });

  test('agent writes join the feed as Update rows; only the newest board write is undoable, and only while an agent edit tops the stack', () => {
    const timeline = {
      events: [
        { id: 'e1', kind: 'prompt' as const, summary: 'Ship it', detail: null, createdAt: '2026-08-23T14:02:00.000Z' },
      ],
      evidence: [],
      steering: [],
    };
    const writes = [
      { id: 'act-3', at: '2026-08-23T14:06:00.000Z', op: 'ax.work.create', summary: 'Opened work item “Draft”' },
      { id: 'act-2', at: '2026-08-23T14:05:00.000Z', op: 'node.update', summary: 'Updated “Control Tower”' },
      { id: 'act-1', at: '2026-08-23T14:03:00.000Z', op: 'node.add', summary: 'Created markdown “Notes”' },
    ];
    const agentTop = mergeTimeline(timeline, 40, writes, { actor: 'agent' });
    expect(agentTop.map((entry) => `${entry.label}:${entry.body}${entry.undoable ? ' ↩' : ''}`)).toEqual([
      'Update:Opened work item “Draft”',
      'Update:Updated “Control Tower” ↩',
      'Update:Created markdown “Notes”',
      'Prompt:Ship it',
    ]);
    const humanTop = mergeTimeline(timeline, 40, writes, { actor: 'human' });
    expect(humanTop.some((entry) => entry.undoable)).toBe(false);
    expect(mergeTimeline(timeline, 40, writes, null).some((entry) => entry.undoable)).toBe(false);
  });
});
