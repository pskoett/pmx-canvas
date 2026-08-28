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
      ['update', 'steer', 'steering', 'yield', 'assistant-message', 'evidence', 'policy', 'prompt'].map((kind) =>
        timelineCategory(kind as Parameters<typeof timelineCategory>[0]),
      ),
    ).toEqual(['update', 'steer', 'steer', 'steer', 'assistant', 'evidence', 'event', 'event']);
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

    // Agent-sent steering names the sender (and the recipient, or "all"):
    // inter-agent coordination must be legible to the human.
    const agentToAgent = mergeTimeline(
      {
        events: [],
        evidence: [],
        steering: [
          {
            id: 's2',
            message: 'lane 2 is yours',
            createdAt: '2026-08-24T10:00:00.000Z',
            source: 'claude-code',
            target: 'copilot',
          },
          { id: 's3', message: 'pausing writes', createdAt: '2026-08-24T10:01:00.000Z', source: 'codex', target: null },
          {
            id: 's4',
            message: 'from the composer',
            createdAt: '2026-08-24T10:02:00.000Z',
            source: 'browser',
            target: 'codex',
          },
        ],
      },
      10,
    );
    expect(agentToAgent.map((entry) => entry.body)).toEqual([
      '→ codex · from the composer',
      'codex → all · pausing writes',
      'claude-code → copilot · lane 2 is yours',
    ]);
    expect(merged.every((entry) => entry.id.length > 0)).toBe(true);
  });

  test('every row names its writer — multi-assistant boards need per-row attribution', () => {
    const merged = mergeTimeline(
      {
        events: [
          // Per-agent identity wins over the transport source.
          {
            id: 'e1',
            kind: 'assistant-message',
            summary: 'probe verified',
            detail: null,
            createdAt: '2026-08-27T22:00:00.000Z',
            source: 'api',
            agentId: 'codex',
          },
          // A bare transport tells the human nothing — no writer shown.
          {
            id: 'e2',
            kind: 'note',
            summary: 'anon note',
            detail: null,
            createdAt: '2026-08-27T22:01:00.000Z',
            source: 'mcp',
            agentId: null,
          },
        ],
        evidence: [
          {
            id: 'v1',
            title: 'ladder green',
            body: null,
            createdAt: '2026-08-27T22:02:00.000Z',
            source: 'claude-code',
            agentId: null,
          },
        ],
        steering: [
          {
            id: 's1',
            message: 'from the composer',
            createdAt: '2026-08-27T22:03:00.000Z',
            source: 'browser',
            target: 'codex',
          },
        ],
      },
      10,
      [
        {
          id: 'w1',
          at: '2026-08-27T22:04:00.000Z',
          op: 'node.add',
          summary: 'Created markdown',
          sessionId: 'copilot',
          label: 'GitHub Copilot',
        },
      ],
    );
    expect(merged.map((entry) => `${entry.label}:${entry.who ?? '—'}`)).toEqual([
      'Update:copilot',
      'Steer:browser',
      'Evidence:claude-code',
      'Note:—',
      'Assistant:codex',
    ]);
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
