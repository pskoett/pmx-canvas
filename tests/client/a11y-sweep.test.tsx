import { afterEach, describe, expect, test } from 'bun:test';
import { cleanup, fireEvent, render } from '@testing-library/preact';
import { useRef } from 'preact/hooks';
import { nearestNodeInDirection } from '../../src/client/canvas/CanvasNode.tsx';
import { useFocusTrap } from '../../src/client/canvas/use-focus-trap.ts';
import type { CanvasNodeState } from '../../src/client/types.ts';

// rail-chrome-v2 item 18: keyboard traversal across nodes and focus traps.

function node(id: string, x: number, y: number): CanvasNodeState {
  return {
    id,
    type: 'markdown',
    position: { x, y },
    size: { width: 100, height: 60 },
    zIndex: 1,
    collapsed: false,
    pinned: false,
    data: { title: id },
  };
}

afterEach(cleanup);

describe('nearestNodeInDirection', () => {
  const nodes = [
    node('origin', 0, 0),
    node('right', 300, 10),
    node('far-right', 900, 0),
    node('below', 20, 400),
    node('diag', 400, 400),
  ];

  test('picks the closest node inside a 90° cone, ignoring the other directions', () => {
    const from = nodes[0]!;
    expect(nearestNodeInDirection(from, { dx: 1, dy: 0 }, nodes)?.id).toBe('right');
    expect(nearestNodeInDirection(from, { dx: 0, dy: 1 }, nodes)?.id).toBe('below');
    expect(nearestNodeInDirection(from, { dx: -1, dy: 0 }, nodes)).toBeNull();
    expect(nearestNodeInDirection(nodes[2]!, { dx: -1, dy: 0 }, nodes)?.id).toBe('right');
  });
});

function Trap({
  active,
  onRender,
  restoreTo,
}: {
  active: boolean;
  onRender?: () => void;
  restoreTo?: () => HTMLElement | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, active, { restoreTo });
  onRender?.();
  return (
    <div ref={ref}>
      <button type="button">first</button>
      <button type="button">last</button>
    </div>
  );
}

describe('useFocusTrap', () => {
  test('focuses the first control, wraps Tab at both ends, and restores the opener on close', () => {
    const opener = document.createElement('button');
    opener.textContent = 'opener';
    document.body.appendChild(opener);
    opener.focus();
    expect(document.activeElement).toBe(opener);

    const { getByText, unmount } = render(<Trap active />);
    const first = getByText('first');
    const last = getByText('last');
    expect(document.activeElement).toBe(first);

    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(document.activeElement).toBe(first);

    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  test('delayed restoration returns to the card unless another control has taken focus', async () => {
    const card = document.createElement('button');
    const menuItem = document.createElement('button');
    document.body.append(card, menuItem);
    try {
      for (const moveFocus of [false, true]) {
        card.focus();
        const { unmount } = render(<Trap active restoreTo={() => card} />);
        unmount();
        if (moveFocus) menuItem.focus();
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        expect(document.activeElement).toBe(moveFocus ? menuItem : card);
      }
    } finally {
      card.remove();
      menuItem.remove();
    }
  });
});
