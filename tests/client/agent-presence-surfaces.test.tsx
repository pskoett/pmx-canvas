import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { cleanup, render } from '@testing-library/preact';
import { AgentPresenceLayer } from '../../src/client/canvas/AgentPresenceLayer.tsx';
import { TopBar } from '../../src/client/canvas/TopBar.tsx';
import { nodes, viewport } from '../../src/client/state/canvas-store.ts';
import { applyPresenceSnapshot, resetPresence } from '../../src/client/state/presence-store.ts';
import type { CanvasNodeState } from '../../src/client/types.ts';
import type { AgentPresence } from '../../src/shared/agent-presence.ts';

// rail-chrome-v2 phase 3 (amended 2026-08-24): panels mount on sessionActive;
// the presence layer paints EVERY live writer, external ones dashed.

function presence(overrides: Partial<AgentPresence>): AgentPresence {
  return {
    sessionId: 'copilot',
    source: 'copilot',
    agentId: null,
    label: 'Claude',
    phase: 'idle',
    detail: null,
    focusNodeId: null,
    cursor: null,
    attached: true,
    opCount: 0,
    contextUsage: null,
    lastSeenAt: '2026-08-23T00:00:00.000Z',
    ...overrides,
  };
}

function makeNode(id: string): CanvasNodeState {
  return {
    id,
    type: 'markdown',
    position: { x: 100, y: 50 },
    size: { width: 300, height: 200 },
    zIndex: 1,
    collapsed: false,
    pinned: false,
    data: { title: id },
  };
}

// TopBar fetches /health on mount; keep happy-dom quiet about relative URLs.
const realFetch = globalThis.fetch;
beforeAll(() => {
  globalThis.fetch = (async () =>
    new Response('{"workspace":"/tmp/board"}', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })) as unknown as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
});

beforeEach(() => {
  resetPresence();
  nodes.value = new Map([['n1', makeNode('n1')]]);
  viewport.value = { x: 0, y: 0, scale: 1 };
});
afterEach(() => cleanup());

describe('top-bar agent chip', () => {
  test('is absent on the quiet board and when only unattached writers exist', () => {
    const { container, rerender } = render(<TopBar />);
    expect(container.querySelector('.agent-chip')).toBeNull();
    applyPresenceSnapshot({ presences: [presence({ sessionId: 'mcp', source: 'mcp', attached: false, opCount: 5 })] });
    rerender(<TopBar />);
    expect(container.querySelector('.agent-chip')).toBeNull();
  });

  test('shows the attached session phase and who it is', () => {
    applyPresenceSnapshot({
      presences: [presence({ phase: 'tooling', detail: 'bun test', label: 'Claude · sonnet' })],
    });
    const { container } = render(<TopBar />);
    const chip = container.querySelector('.agent-chip');
    expect(chip?.className).toContain('phase-tooling');
    expect(chip?.querySelector('.agent-chip-label')?.textContent).toBe('Running bun test');
    expect(chip?.querySelector('.agent-chip-who')?.textContent).toBe('Claude · sonnet');
  });
});

describe('agent presence layer', () => {
  test('an external (unattached) writer paints a dashed is-external cursor on the quiet board', () => {
    // No attached session at all — an agent editing through plain MCP/HTTP is
    // exactly when the human needs to see where it works (user call 2026-08-24).
    applyPresenceSnapshot({
      presences: [presence({ sessionId: 'api', source: 'api', attached: false, cursor: { x: 10, y: 10 } })],
    });
    const { container } = render(<AgentPresenceLayer />);
    const cursor = container.querySelector('.agent-cursor') as HTMLElement;
    expect(cursor).not.toBeNull();
    expect(cursor.className).toContain('is-external');
    expect(cursor.style.transform).toBe('translate(10px, 10px)');
  });

  test('renders every live writer — attached sessions plain, external writers marked', () => {
    viewport.value = { x: 0, y: 0, scale: 0.5 };
    applyPresenceSnapshot({
      presences: [
        presence({ sessionId: 'copilot', phase: 'thinking', focusNodeId: 'n1' }),
        presence({ sessionId: 'api', source: 'api', attached: false, cursor: { x: 10, y: 10 } }),
      ],
    });
    const { container } = render(<AgentPresenceLayer />);
    const cursors = container.querySelectorAll('.agent-cursor');
    expect(cursors).toHaveLength(2);
    const cursor = [...cursors].find((el) => (el as HTMLElement).dataset.sessionId === 'copilot') as HTMLElement;
    expect(cursor.className).toContain('phase-thinking');
    expect(cursor.className).not.toContain('is-external');
    // Focus node n1 at (100,50) × 300 wide → anchor (372, 66) in world space.
    expect(cursor.style.transform).toBe('translate(372px, 66px)');
    const inner = cursor.querySelector('.agent-cursor-inner') as HTMLElement;
    expect(inner.style.transform).toBe('scale(2)');
    expect(cursor.querySelector('.agent-cursor-label')?.textContent).toBe('Thinking');
    const external = [...cursors].find((el) => (el as HTMLElement).dataset.sessionId === 'api') as HTMLElement;
    expect(external.className).toContain('is-external');
  });

  test('keeps the last position when the focus node disappears', () => {
    applyPresenceSnapshot({ presences: [presence({ focusNodeId: 'n1' })] });
    const { container, rerender } = render(<AgentPresenceLayer />);
    const before = (container.querySelector('.agent-cursor') as HTMLElement).style.transform;
    nodes.value = new Map();
    applyPresenceSnapshot({ presences: [presence({ focusNodeId: 'n1' })] });
    rerender(<AgentPresenceLayer />);
    expect((container.querySelector('.agent-cursor') as HTMLElement).style.transform).toBe(before);
  });
});
