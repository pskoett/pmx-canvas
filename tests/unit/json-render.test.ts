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
});
