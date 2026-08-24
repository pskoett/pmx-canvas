import { describe, expect, test } from 'bun:test';
import { toggleTaskMarker } from '../../src/client/nodes/MarkdownNode.tsx';

// Card-level task ticking: the Nth rendered checkbox maps to the Nth task
// marker in the source, whatever list style or nesting carries it.
describe('toggleTaskMarker', () => {
  const md = [
    '# Plan',
    '',
    '- [ ] first',
    '- [x] second',
    '  - [ ] nested',
    '* [ ] starred',
    '1. [ ] numbered',
    '- plain bullet',
  ].join('\n');

  test('flips exactly the addressed marker, both directions', () => {
    expect(toggleTaskMarker(md, 0)).toContain('- [x] first');
    expect(toggleTaskMarker(md, 1)).toContain('- [ ] second');
    expect(toggleTaskMarker(md, 2)).toContain('  - [x] nested');
    expect(toggleTaskMarker(md, 3)).toContain('* [x] starred');
    expect(toggleTaskMarker(md, 4)).toContain('1. [x] numbered');
  });

  test('leaves everything else byte-identical; out-of-range is a no-op', () => {
    const flipped = toggleTaskMarker(md, 0);
    expect(flipped.split('\n').filter((line) => line !== '- [x] first')).toEqual(
      md.split('\n').filter((line) => line !== '- [ ] first'),
    );
    expect(toggleTaskMarker(md, 99)).toBe(md);
    expect(toggleTaskMarker('no tasks here\n- [not a task]', 0)).toBe('no tasks here\n- [not a task]');
  });
});
