import { describe, expect, test } from 'bun:test';
import { mergeTimeline } from '../../src/client/state/session-store.ts';

describe('mergeTimeline', () => {
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
