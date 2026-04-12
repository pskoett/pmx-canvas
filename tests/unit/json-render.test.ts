import { describe, expect, test } from 'bun:test';
import { normalizeAndValidateJsonRenderSpec } from '../../src/json-render/server.ts';

describe('json-render validation', () => {
  test('rejects specs without root and elements', () => {
    expect(() => normalizeAndValidateJsonRenderSpec({})).toThrow('Missing root and elements in spec.');
  });

  test('accepts minimal valid specs', () => {
    const spec = normalizeAndValidateJsonRenderSpec({
      root: 'card',
      elements: {
        card: {
          type: 'Card',
          props: {
            title: 'Test card',
          },
          children: [],
        },
      },
    });

    expect(spec.root).toBe('card');
    expect(Object.keys(spec.elements)).toEqual(['card']);
  });

  test('normalizes common element aliases and cleans non-string children', () => {
    const spec = normalizeAndValidateJsonRenderSpec({
      root: 'panel',
      elements: {
        panel: {
          type: 'Panel',
          props: {
            title: 'Alias card',
            description: null,
            maxWidth: 'full',
            centered: false,
          },
          children: ['copy', 123, null],
        },
        copy: {
          type: 'Text',
          props: {
            text: 'Hello',
          },
          children: [],
        },
      },
    });

    expect(spec.elements.panel?.type).toBe('Card');
    expect(spec.elements.panel?.children).toEqual(['copy']);
    expect((spec.elements.panel?.props as Record<string, unknown>).description).toBeUndefined();
  });
});
