import { describe, expect, test } from 'bun:test';
import { htmlAxCapabilitySignature, shouldShowPresentationControls } from '../../src/client/nodes/HtmlNode.tsx';
import type { CanvasNodeState } from '../../src/client/types.ts';

function makeHtmlNode(data: Record<string, unknown>): CanvasNodeState {
  return {
    id: 'html-test',
    type: 'html',
    position: { x: 0, y: 0 },
    size: { width: 720, height: 640 },
    zIndex: 1,
    collapsed: false,
    pinned: false,
    data,
  };
}

describe('HtmlNode presentation controls', () => {
  test('only explicit presentation html nodes can present', () => {
    expect(shouldShowPresentationControls(makeHtmlNode({ html: '<main>Report</main>' }))).toBe(false);
    expect(shouldShowPresentationControls(makeHtmlNode({ html: '<main>Deck</main>', presentation: true }))).toBe(true);
  });
});

describe('HtmlNode AX capability document identity', () => {
  test('distinguishes effective bridge states and allowed actions', () => {
    expect(htmlAxCapabilitySignature(undefined)).toBe('disabled');
    expect(htmlAxCapabilitySignature({ enabled: false, allowed: ['ax.steer'] })).toBe('disabled');
    expect(htmlAxCapabilitySignature({ enabled: true, allowed: [] })).toBe('disabled');
    expect(htmlAxCapabilitySignature({ enabled: true })).toBe('enabled:default');
    expect(htmlAxCapabilitySignature({ enabled: true, allowed: ['ax.steer', 'ax.work.create'] })).toBe(
      'enabled:ax.steer,ax.work.create',
    );
  });

  test('does not change for equivalent allowed-action sets', () => {
    expect(htmlAxCapabilitySignature({ enabled: true, allowed: ['ax.steer', 'ax.work.create', 'ax.steer'] })).toBe(
      htmlAxCapabilitySignature({ enabled: true, allowed: ['ax.work.create', 'ax.steer'] }),
    );
  });
});
