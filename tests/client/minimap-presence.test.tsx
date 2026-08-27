import { beforeEach, describe, expect, test } from 'bun:test';
import { render } from 'preact';
import { Minimap } from '../../src/client/canvas/Minimap.tsx';
import { edges, nodes, viewport } from '../../src/client/state/canvas-store.ts';
import { applyPresenceSnapshot, resetPresence } from '../../src/client/state/presence-store.ts';
import type { AgentPresence } from '../../src/shared/agent-presence.ts';
import type { CanvasNodeState } from '../../src/client/types.ts';

function presence(overrides: Partial<AgentPresence> & Pick<AgentPresence, 'sessionId'>): AgentPresence {
  return {
    sessionId: overrides.sessionId,
    source: overrides.source ?? overrides.sessionId,
    agentId: null,
    label: overrides.label ?? overrides.sessionId,
    phase: overrides.phase ?? 'idle',
    detail: null,
    focusNodeId: overrides.focusNodeId ?? null,
    cursor: overrides.cursor ?? null,
    attached: overrides.attached ?? true,
    parentAgentId: overrides.parentAgentId ?? null,
    opCount: 1,
    contextUsage: null,
    lastSeenAt: new Date().toISOString(),
  };
}

function node(id: string, x: number, y: number): CanvasNodeState {
  return {
    id,
    type: 'markdown',
    position: { x, y },
    size: { width: 300, height: 160 },
    zIndex: 1,
    collapsed: false,
    pinned: false,
    data: { title: id },
  };
}

describe('minimap presence dots', () => {
  beforeEach(() => {
    resetPresence();
    viewport.value = { x: 0, y: 0, scale: 1 };
    nodes.value = new Map([['n1', node('n1', 100, 100)]]);
    edges.value = new Map();
  });

  test('every live writer paints a phase-classed dot — sessions, workers, external writers alike', () => {
    applyPresenceSnapshot({
      presences: [
        presence({ sessionId: 'copilot', phase: 'tooling', focusNodeId: 'n1' }),
        presence({
          sessionId: 'hive:w1',
          source: 'sdk',
          attached: false,
          parentAgentId: 'copilot',
          phase: 'thinking',
          cursor: { x: 500, y: 300 },
        }),
        presence({ sessionId: 'api', source: 'api', attached: false, cursor: { x: 900, y: 40 } }),
        // No resolvable position → no dot.
        presence({ sessionId: 'ghosty', source: 'mcp', attached: false }),
      ],
    });
    const host = document.createElement('div');
    document.body.appendChild(host);
    render(
      <Minimap
        viewport={viewport}
        nodes={nodes}
        edges={edges}
        onNavigate={() => {}}
        containerWidth={1200}
        containerHeight={800}
      />,
      host,
    );
    const dots = [...host.querySelectorAll('.minimap-presence')];
    expect(dots).toHaveLength(3);
    expect(dots.some((d) => d.className.includes('phase-tooling') && !d.className.includes('is-worker'))).toBe(true);
    expect(dots.some((d) => d.className.includes('phase-thinking') && d.className.includes('is-worker'))).toBe(true);
    expect(dots.some((d) => d.className.includes('is-external'))).toBe(true);
    render(null, host);
    host.remove();
  });
});
