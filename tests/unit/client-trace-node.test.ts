import { describe, expect, test } from 'bun:test';
import { buildTraceDisplayModel } from '../../src/client/nodes/trace-model.ts';

describe('trace node model', () => {
  test('falls back to generic title and content fields', () => {
    expect(buildTraceDisplayModel({ title: 'Generic trace', content: 'Generic trace details' })).toMatchObject({
      toolName: 'Generic trace',
      resultSummary: 'Generic trace details',
      category: 'other',
      status: 'running',
    });
  });
});
