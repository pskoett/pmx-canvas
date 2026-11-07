import { expect, test } from 'bun:test';
import { signal } from '@preact/signals';
import { render } from 'preact';
import { useNodeResize } from '../../src/client/canvas/use-node-resize.ts';

test('a click on the resize handle is not a resize; a drag is', () => {
  const viewport = signal({ x: 0, y: 0, scale: 1 });
  let ends = 0;
  let start: ((e: PointerEvent, width: number, height: number) => void) | null = null;
  function Harness() {
    start = useNodeResize({ nodeId: 'n', viewport, onResize: () => {}, onResizeEnd: () => (ends += 1) });
    return null;
  }
  const host = document.createElement('div');
  render(<Harness />, host);
  const press = (x: number) => start!(new PointerEvent('pointerdown', { clientX: x, clientY: 0 }), 400, 300);

  press(100);
  document.dispatchEvent(new PointerEvent('pointerup'));
  expect(ends).toBe(0);

  press(100);
  document.dispatchEvent(new PointerEvent('pointermove', { clientX: 160, clientY: 40 }));
  document.dispatchEvent(new PointerEvent('pointerup'));
  expect(ends).toBe(1);
  render(null, host);
});
