import { describe, expect, mock, spyOn, test } from 'bun:test';
import { normalizeExtAppToolResult } from '../../src/shared/ext-app-tool-result.ts';

describe('normalizeExtAppToolResult', () => {
  test('passes through CallToolResult values and merges error state from the wrapper input', () => {
    const result = normalizeExtAppToolResult({
      result: {
        content: [{ type: 'text', text: 'already normalized' }],
        isError: false,
      },
      success: false,
    });

    expect(result).toEqual({
      content: [{ type: 'text', text: 'already normalized' }],
      isError: true,
    });
  });

  test('prefers explicit detailed and plain content fields before fallback record fields', () => {
    const detailed = normalizeExtAppToolResult({
      result: { text: 'from result', message: 'fallback' },
      detailedContent: 'preferred detailed content',
      content: 'plain content',
    });
    expect(detailed.content).toEqual([{ type: 'text', text: 'preferred detailed content' }]);
    expect(detailed.isError).toBe(false);

    const recordFallback = normalizeExtAppToolResult({
      result: {
        textResultForLlm: 'llm text',
        text: 'text',
        message: 'message',
      },
    });
    expect(recordFallback.content).toEqual([{ type: 'text', text: 'llm text' }]);
  });

  test('uses explicit error text when success is false and no other content is available', () => {
    const result = normalizeExtAppToolResult({
      result: null,
      success: false,
      error: 'tool failed cleanly',
    });

    expect(result).toEqual({
      content: [{ type: 'text', text: 'tool failed cleanly' }],
      isError: true,
    });
  });

  test('serializes non-string values and omits content when the value is undefined', () => {
    expect(
      normalizeExtAppToolResult({
        result: { ok: true, count: 3 },
      }),
    ).toEqual({
      content: [{ type: 'text', text: '{"ok":true,"count":3}' }],
      isError: false,
    });

    expect(
      normalizeExtAppToolResult({
        result: undefined,
      }),
    ).toEqual({
      content: [],
      isError: false,
    });
  });

  test('falls back to String(value) and logs when JSON serialization throws', () => {
    const debugSpy = spyOn(console, 'debug').mockImplementation(mock(() => {}));
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;

    const result = normalizeExtAppToolResult({ result: cyclic });

    expect(result.content).toEqual([{ type: 'text', text: '[object Object]' }]);
    expect(result.isError).toBe(false);
    expect(debugSpy).toHaveBeenCalledTimes(1);
    debugSpy.mockRestore();
  });
});
