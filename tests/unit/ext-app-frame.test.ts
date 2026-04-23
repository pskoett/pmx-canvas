import { describe, expect, test } from 'bun:test';
import { resolveExtAppDisplayModeRequest } from '../../src/client/nodes/ExtAppFrame.tsx';

describe('ExtAppFrame display mode requests', () => {
  test('expands into focus mode instead of resizing the backing node', () => {
    expect(resolveExtAppDisplayModeRequest('fullscreen', false)).toEqual({
      nextMode: 'fullscreen',
      shouldExpand: true,
      shouldCollapse: false,
    });
  });

  test('treats fullscreen as a no-op when the node is already expanded', () => {
    expect(resolveExtAppDisplayModeRequest('fullscreen', true)).toEqual({
      nextMode: 'fullscreen',
      shouldExpand: false,
      shouldCollapse: false,
    });
  });

  test('collapses focus mode when the app requests inline mode', () => {
    expect(resolveExtAppDisplayModeRequest('inline', true)).toEqual({
      nextMode: 'inline',
      shouldExpand: false,
      shouldCollapse: true,
    });
  });

  test('leaves pip requests alone', () => {
    expect(resolveExtAppDisplayModeRequest('pip', false)).toEqual({
      nextMode: 'pip',
      shouldExpand: false,
      shouldCollapse: false,
    });
  });
});
