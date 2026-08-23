import { describe, expect, test } from 'bun:test';
import { mutatingNodeIdsFrom, presenceWorldPosition } from '../../src/client/state/presence-store.ts';
import { agentPhaseLabel } from '../../src/shared/agent-presence.ts';

// rail-chrome-v2 phase 3: the pure derivations behind the presence surfaces.

describe('agentPhaseLabel', () => {
  test('maps every phase to its chip text', () => {
    expect(agentPhaseLabel({ phase: 'thinking', detail: null })).toBe('Thinking');
    expect(agentPhaseLabel({ phase: 'tooling', detail: 'bun test' })).toBe('Running bun test');
    expect(agentPhaseLabel({ phase: 'tooling', detail: null })).toBe('Working');
    expect(agentPhaseLabel({ phase: 'waiting-approval', detail: null })).toBe('Waiting on you');
    expect(agentPhaseLabel({ phase: 'idle', detail: null })).toBe('Idle');
  });
});

describe('presenceWorldPosition', () => {
  const nodeById = (id: string) => (id === 'n1' ? { position: { x: 100, y: 200 }, size: { width: 400 } } : undefined);

  test('an explicit cursor wins over the focus node', () => {
    expect(presenceWorldPosition({ cursor: { x: 5, y: 6 }, focusNodeId: 'n1' }, nodeById)).toEqual({ x: 5, y: 6 });
  });

  test('falls back to the focus node, anchored near its title bar', () => {
    expect(presenceWorldPosition({ cursor: null, focusNodeId: 'n1' }, nodeById)).toEqual({ x: 472, y: 216 });
  });

  test('a narrow node still anchors inside its own box', () => {
    const narrow = () => ({ position: { x: 0, y: 0 }, size: { width: 40 } });
    expect(presenceWorldPosition({ cursor: null, focusNodeId: 'x' }, narrow)).toEqual({ x: 24, y: 16 });
  });

  test('no cursor and no resolvable node → null (the layer keeps the last position)', () => {
    expect(presenceWorldPosition({ cursor: null, focusNodeId: 'missing' }, nodeById)).toBeNull();
    expect(presenceWorldPosition({ cursor: null, focusNodeId: null }, nodeById)).toBeNull();
  });
});

describe('mutatingNodeIdsFrom', () => {
  test('collects the targets of in-flight move / edit / remove ghosts, never creates', () => {
    const ids = mutatingNodeIdsFrom([
      { kind: 'edit', nodeId: 'a' },
      { kind: 'move', nodeId: 'b' },
      { kind: 'remove', nodeId: 'c' },
      { kind: 'create', nodeId: 'ghost-target-should-not-count' },
      { kind: 'connect' },
    ]);
    expect([...ids].sort()).toEqual(['a', 'b', 'c']);
  });
});
