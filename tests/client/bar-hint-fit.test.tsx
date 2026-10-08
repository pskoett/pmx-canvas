import { afterEach, describe, expect, test } from 'bun:test';
import { cleanup, fireEvent, render } from '@testing-library/preact';
import { BarHint } from '../../src/client/canvas/BarHint.tsx';

// A node header chip sits anywhere along a card that clips its contents
// (.node-content is overflow:hidden). Its hint opens toward the side that fits.

type Rect = { left: number; right: number; width: number };
const rect = ({ left, right, width }: Rect) =>
  ({ left, right, width, top: 0, bottom: 20, height: 20, x: left, y: 0, toJSON: () => ({}) }) as DOMRect;

function mount(chip: Rect) {
  const view = render(
    <div class="node-content">
      <BarHint label="Near a pin" align="end" fitWithin=".node-content" tapToOpen>
        <span class="chip">near</span>
      </BarHint>
    </div>,
  );
  const box = view.container.querySelector('.node-content') as HTMLElement;
  const anchor = view.container.querySelector('.toolbar-tooltip-anchor') as HTMLElement;
  const tip = view.container.querySelector('.toolbar-tooltip') as HTMLElement;
  box.getBoundingClientRect = () => rect({ left: 0, right: 340, width: 340 });
  anchor.getBoundingClientRect = () => rect(chip);
  tip.getBoundingClientRect = () => rect({ left: 0, right: 240, width: 240 });
  return anchor;
}

afterEach(cleanup);

describe('BarHint fitWithin', () => {
  test('a chip near the left edge opens its hint rightwards so the card does not clip it', () => {
    const anchor = mount({ left: 70, right: 130, width: 60 });
    expect(anchor.className).toContain('toolbar-tooltip-anchor-end');
    fireEvent.pointerEnter(anchor);
    expect(anchor.className).toContain('toolbar-tooltip-anchor-start');
  });

  test('a chip far enough right keeps opening leftwards', () => {
    const anchor = mount({ left: 250, right: 310, width: 60 });
    fireEvent.pointerEnter(anchor);
    expect(anchor.className).toContain('toolbar-tooltip-anchor-end');
  });
});
