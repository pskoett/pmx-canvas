import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { cleanup, render } from '@testing-library/preact';
import { FileNode } from '../../src/client/nodes/FileNode.tsx';
import { iframeMode } from '../../src/client/state/iframe-mode.ts';
import type { CanvasNodeState } from '../../src/client/types.ts';

function makeFileNode(data: Record<string, unknown>): CanvasNodeState {
  return {
    id: 'file-test',
    type: 'file',
    position: { x: 0, y: 0 },
    size: { width: 640, height: 420 },
    zIndex: 1,
    collapsed: false,
    pinned: false,
    data,
  };
}

beforeEach(() => {
  // Skip the boot-wide embed probe: render surface iframes in src mode.
  iframeMode.value = 'src';
});

afterEach(() => {
  // @testing-library/preact's auto-cleanup registers under the first importing
  // test file only — unmount explicitly so nodes don't leak across files.
  cleanup();
  iframeMode.value = null;
});

describe('FileNode delimited data', () => {
  test('renders a CSV as a table with header cells and one row per record', () => {
    const { container } = render(
      <FileNode
        node={makeFileNode({
          path: '/ws/data.csv',
          fileContent: 'name,city\nada,"London, UK"\ngrace,NYC\n',
        })}
      />,
    );
    const table = container.querySelector('table.file-table');
    expect(table).toBeTruthy();
    expect([...(table?.querySelectorAll('thead th') ?? [])].map((th) => th.textContent)).toEqual(['name', 'city']);
    const rows = table?.querySelectorAll('tbody tr') ?? [];
    expect(rows).toHaveLength(2);
    expect([...(rows[0]?.querySelectorAll('td') ?? [])].map((td) => td.textContent)).toEqual(['ada', 'London, UK']);
    // The table replaces the monospace line view entirely.
    expect(container.querySelector('pre')).toBeNull();
  });

  test('caps rendered rows and says how many were withheld', () => {
    const lines = ['a,b', ...Array.from({ length: 600 }, (_, i) => `${i},x`)].join('\n');
    const { container, getByText } = render(
      <FileNode node={makeFileNode({ path: '/ws/big.csv', fileContent: lines })} />,
    );
    expect(container.querySelectorAll('tbody tr')).toHaveLength(500);
    expect(getByText('Showing 500 of 600 rows')).toBeTruthy();
  });

  test('falls back to plain text when a .csv is not really delimited', () => {
    const { container } = render(
      <FileNode node={makeFileNode({ path: '/ws/notes.csv', fileContent: 'just prose\nmore prose\n' })} />,
    );
    expect(container.querySelector('table')).toBeNull();
    expect(container.querySelector('pre')).toBeTruthy();
  });

  test('renders a truncation banner while still showing the text', () => {
    const { container, getByText } = render(
      <FileNode
        node={makeFileNode({
          path: '/ws/huge.log',
          fileContent: 'x'.repeat(2048),
          truncated: true,
          byteSize: 6 * 1024 * 1024,
        })}
      />,
    );
    expect(getByText('Showing the first 2.0 KB of 6.0 MB')).toBeTruthy();
    expect(container.querySelector('pre')).toBeTruthy();
  });
});

describe('FileNode non-text files', () => {
  test('renders a placeholder with a formatted size for binary files', () => {
    const { container, getByText } = render(
      <FileNode
        node={makeFileNode({
          path: '/ws/logo.woff2',
          title: 'logo.woff2',
          binary: true,
          byteSize: 4.2 * 1024 * 1024,
        })}
      />,
    );
    expect(container.querySelector('.file-node-placeholder')).toBeTruthy();
    expect(getByText('logo.woff2')).toBeTruthy();
    expect(getByText('Binary file')).toBeTruthy();
    expect(getByText('4.2 MB')).toBeTruthy();
    expect(container.querySelector('table')).toBeNull();
    expect(container.querySelector('pre')).toBeNull();
    expect(container.textContent).not.toContain('Loading…');
  });

  test('renders a PDF in an iframe served from the byte route', () => {
    const { container } = render(
      <FileNode
        node={makeFileNode({ path: '/ws/spec.pdf', binary: true, mimeType: 'application/pdf', byteSize: 12345 })}
      />,
    );
    const iframe = container.querySelector('iframe');
    expect(iframe?.getAttribute('src')).toContain('/api/canvas/file-bytes?nodeId=');
    expect(iframe?.getAttribute('src')).toContain('nodeId=file-test');
    expect(container.querySelector('pre')).toBeNull();
  });

  test('offers an open link instead of a dead frame when the host forces srcdoc', () => {
    iframeMode.value = 'srcdoc';
    const { container, getByText } = render(
      <FileNode node={makeFileNode({ path: '/ws/spec.pdf', binary: true, mimeType: 'application/pdf' })} />,
    );
    expect(container.querySelector('iframe')).toBeNull();
    const link = getByText('Open PDF') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toContain('/api/canvas/file-bytes?nodeId=file-test');
    expect(link.getAttribute('target')).toBe('_blank');
  });
});
