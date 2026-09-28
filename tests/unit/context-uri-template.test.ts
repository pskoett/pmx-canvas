import { expect, test } from 'bun:test';
import { ContextUriTemplate } from '../../src/mcp/context-uri-template.ts';

test('context resource matches optional parameters in any order and decodes consumers', () => {
  const template = new ContextUriTemplate();
  expect(template.match('canvas://context')).toEqual({});
  expect(template.match('canvas://context?budget=50000')).toEqual({ budget: '50000' });
  expect(template.match('canvas://context?consumer=worker%3Aone&budget=900&since=12')).toEqual({
    consumer: 'worker:one',
    budget: '900',
    since: '12',
  });
  expect(template.match(template.expand({ consumer: 'reader' }))).toEqual({ consumer: 'reader' });
  for (const invalid of [
    'canvas://context/path',
    'https://context',
    'canvas://other',
    'canvas://context?unknown=1',
    'canvas://context?since=1&since=2',
  ]) {
    expect(template.match(invalid)).toBeNull();
  }
});
