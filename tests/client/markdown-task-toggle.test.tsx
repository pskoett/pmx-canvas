import { afterEach, describe, expect, test } from 'bun:test';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/preact';
import { marked } from 'marked';
import { MarkdownNode, toggleTaskMarker } from '../../src/client/nodes/MarkdownNode.tsx';
import { InlineMarkdownEditor } from '../../src/client/nodes/InlineMarkdownEditor.tsx';
import { renderWikiMarkdown } from '../../src/server/wiki-links.ts';
import { activeBoardId } from '../../src/client/state/boards-store.ts';
import { hasInitialServerLayout, nodes } from '../../src/client/state/canvas-store.ts';
import { EVENT_HANDLERS } from '../../src/client/state/sse-bridge.ts';
import type { CanvasNodeState } from '../../src/client/types.ts';
import { wikiLinksFromData, type WikiLink } from '../../src/shared/memory-graph.ts';

const originalFetch = globalThis.fetch;
afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
});

test.each(
  [
    'same-text save resolves a binding',
    'undo removes only a binding',
    'restore changes only a binding',
    'target disappears',
    'target reappears',
  ].flatMap((scenario) => [[scenario, false] as const, [scenario, true] as const]),
)('Markdown refreshes when %s (expanded=%s) without rerendering on drags', async (scenario, expanded) => {
  const bound: WikiLink[] = [{ ref: 'B', target: { boardId: 'b' } }];
  const unbound: WikiLink[] = [{ ref: 'B' }];
  const availabilityChange = scenario.startsWith('target');
  let targetExists = scenario !== 'target reappears';
  const source: CanvasNodeState = {
    id: 'wiki-source',
    type: 'markdown',
    position: { x: 0, y: 0 },
    size: { width: 360, height: 240 },
    zIndex: 1,
    collapsed: false,
    pinned: false,
    contentRevision: 40,
    linksRevision: 10,
    data: { content: 'See [[B]]', wikiLinks: scenario.startsWith('same-text') ? unbound : bound },
  };
  let renders = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) === '/api/render') {
      renders += 1;
      const body = JSON.parse(String(init?.body)) as { markdown: string };
      return Response.json({
        html: renderWikiMarkdown(
          body.markdown,
          wikiLinksFromData(nodes.value.get(source.id)!.data),
          () => targetExists,
        ),
      });
    }
    return Response.json({});
  }) as typeof fetch;
  activeBoardId.value = null;
  hasInitialServerLayout.value = false;
  const replay = (node: CanvasNodeState) =>
    EVENT_HANDLERS['canvas-layout-update']({ layout: { nodes: [node], edges: [] } });
  replay(source);
  function Card() {
    return <MarkdownNode node={nodes.value.get(source.id)!} expanded={expanded} />;
  }
  const view = render(<Card />);
  await waitFor(() => expect(view.container.querySelector('a.wiki-link')?.textContent).toBe('B'));
  expect(view.container.querySelector('a')?.getAttribute('data-wiki-board')).toBe(
    scenario.startsWith('same-text') || !targetExists ? null : 'b',
  );
  const initialRenders = renders;
  targetExists = scenario !== 'target disappears';
  const next = {
    ...source,
    // Binding-only restores must work even when source revisions are unchanged.
    linksRevision: availabilityChange ? 11 : 10,
    data: {
      ...source.data,
      wikiLinks: scenario.startsWith('undo')
        ? unbound
        : scenario.startsWith('restore')
          ? [{ ref: 'B', target: { boardId: 'restored-b' } }]
          : bound,
    },
  };
  await act(async () => replay(next));
  const expectedBoard =
    scenario.startsWith('undo') || !targetExists ? null : scenario.startsWith('restore') ? 'restored-b' : 'b';
  await waitFor(() => {
    const link = view.container.querySelector('a.wiki-link')!;
    expect(link.getAttribute('data-wiki-board')).toBe(expectedBoard);
    expect(link.classList.contains('is-unresolved')).toBe(expectedBoard === null);
    expect(link.getAttribute('data-wiki-missing')).toBe(targetExists ? null : 'true');
  });
  expect(renders).toBe(initialRenders + 1);
  const refreshedRenders = renders;
  // SSE replaces the bindings array even on a position-only layout; depend on
  // serialized bindings, not object identity or the whole node/catalog.
  await act(async () => replay({ ...next, position: { x: 80, y: 90 } }));
  await Bun.sleep(20);
  expect(nodes.value.get(source.id)?.position).toEqual({ x: 80, y: 90 });
  expect(renders).toBe(refreshedRenders);
});

test('a delayed save acknowledgement cannot overwrite newly resolved wiki HTML', async () => {
  const source: CanvasNodeState = {
    id: 'saving-wiki',
    type: 'markdown',
    position: { x: 0, y: 0 },
    size: { width: 360, height: 240 },
    zIndex: 1,
    collapsed: false,
    pinned: false,
    contentRevision: 40,
    linksRevision: 10,
    data: { content: 'See [[B]]', wikiLinks: [{ ref: 'B' }] },
  };
  const acknowledgements: Array<(response: Response) => void> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) === '/api/render')
      return Response.json({
        html: renderWikiMarkdown('See [[B]]', wikiLinksFromData(nodes.value.get(source.id)!.data), () => true),
      });
    if (init?.method === 'PATCH') return new Promise<Response>((resolve) => acknowledgements.push(resolve));
    return Response.json({});
  }) as typeof fetch;
  activeBoardId.value = null;
  hasInitialServerLayout.value = false;
  const replay = (node: CanvasNodeState) =>
    EVENT_HANDLERS['canvas-layout-update']({ layout: { nodes: [node], edges: [] } });
  replay(source);
  function Card() {
    return <MarkdownNode node={nodes.value.get(source.id)!} expanded />;
  }
  const view = render(<Card />);
  await waitFor(() => expect(view.container.querySelector('a')?.classList.contains('is-unresolved')).toBe(true));
  fireEvent.blur(view.container.querySelector('[contenteditable]')!);
  await waitFor(() => expect(acknowledgements).toHaveLength(1));
  await act(async () =>
    replay({
      ...source,
      contentRevision: 41,
      linksRevision: 11,
      data: { content: 'See [[B]]', wikiLinks: [{ ref: 'B', target: { boardId: 'b' } }] },
    }),
  );
  await waitFor(() => expect(nodes.value.get(source.id)?.data.rendered).toContain('data-wiki-board="b"'));
  await act(async () => acknowledgements[0]!(Response.json({ ok: true, contentRevision: 41 })));
  await Bun.sleep(20);
  expect(nodes.value.get(source.id)?.data.rendered).toContain('data-wiki-board="b"');
  expect(view.container.querySelector('a')?.getAttribute('data-wiki-board')).toBe('b');
});

test('the rich editor preserves wiki references and aliases while editing their visible labels', async () => {
  const content = 'See [[Old research#Evidence|Read this]] and [[Pending]] and [Ordinary](https://example.com).';
  const html = renderWikiMarkdown(
    content,
    [{ ref: 'Old research#Evidence', target: { boardId: 'r1', cardId: 'e1' } }, { ref: 'Pending' }],
    () => true,
  );
  let saved = '';
  const view = render(
    <InlineMarkdownEditor
      initialHtml={html}
      onChange={(md) => {
        saved = md;
      }}
      onSave={(md) => {
        saved = md;
      }}
    />,
  );
  const editor = view.container.querySelector('[contenteditable]')!;
  await waitFor(() => expect(editor.querySelectorAll('a')).toHaveLength(3));
  fireEvent.blur(editor);
  expect(saved).toContain('[[Old research#Evidence|Read this]]');
  expect(saved).toContain('[[Pending]]');
  expect(saved).toContain('[Ordinary](https://example.com)');
  editor.querySelector('a')!.textContent = 'Read fresh';
  fireEvent.input(editor);
  expect(saved).toContain('[[Old research#Evidence|Read fresh]]');
  expect(saved).toContain('[[Pending]]');
  const draftText = editor.querySelector('a')!.firstChild!;
  const range = document.createRange();
  range.setStart(draftText, 4);
  range.collapse(true);
  document.getSelection()!.removeAllRanges();
  document.getSelection()!.addRange(range);
  view.rerender(
    <InlineMarkdownEditor
      initialHtml={renderWikiMarkdown(
        content,
        [{ ref: 'Old research#Evidence', target: { boardId: 'r1', cardId: 'e1' } }, { ref: 'Pending' }],
        () => false,
      )}
      onChange={(md) => {
        saved = md;
      }}
      onSave={(md) => {
        saved = md;
      }}
    />,
  );
  await waitFor(() => expect(editor.querySelector('a')?.getAttribute('data-wiki-missing')).toBe('true'));
  expect(editor.querySelector('a')?.firstChild).toBe(draftText);
  expect(editor.querySelector('a')?.textContent).toBe('Read fresh');
  expect(document.getSelection()?.anchorNode).toBe(draftText);
  expect(document.getSelection()?.anchorOffset).toBe(4);
  fireEvent.blur(editor);
  expect(saved).toContain('[[Old research#Evidence|Read fresh]]');
});

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

test.each([
  'before',
  'after',
])('an older poll %s the save acknowledgement cannot untick a saved task', async (timing) => {
  const unchecked = '- [x] first\n- [ ] second';
  const checked = '- [x] first\n- [x] second';
  const source: CanvasNodeState = {
    id: 'tasks',
    type: 'markdown',
    position: { x: 0, y: 0 },
    size: { width: 360, height: 240 },
    zIndex: 1,
    collapsed: false,
    pinned: false,
    contentRevision: 40,
    lastEditedBy: { actor: 'agent', source: 'mcp' },
    data: { content: unchecked },
  };
  const saves: Array<{ body: { content: string; expectedBoardId: string }; resolve: (response: Response) => void }> =
    [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) === '/api/render') {
      const body = JSON.parse(String(init?.body)) as { markdown: string };
      return Response.json({ html: await marked.parse(body.markdown) });
    }
    if (init?.method === 'PATCH') {
      return new Promise<Response>((resolve) => {
        saves.push({ body: JSON.parse(String(init.body)), resolve });
      });
    }
    return Response.json({});
  }) as typeof fetch;
  activeBoardId.value = null;
  hasInitialServerLayout.value = false;
  const replay = (node: CanvasNodeState) =>
    EVENT_HANDLERS['canvas-layout-update']({ layout: { nodes: [node], edges: [] } });
  replay(source);
  function Card({ expanded = false }: { expanded?: boolean }) {
    return <MarkdownNode node={nodes.value.get('tasks')!} expanded={expanded} />;
  }
  const card = render(<Card />);
  await waitFor(() => expect(card.container.querySelectorAll('input[type="checkbox"]')).toHaveLength(2));
  // Startup may deliver the layout before the board catalog. Saving must
  // capture the now-known owner rather than the mount-time null board.
  await act(async () => {
    activeBoardId.value = 'A';
  });
  fireEvent.click(card.container.querySelectorAll('input')[1]!);
  await waitFor(() => expect(saves).toHaveLength(1));
  expect(saves[0]!.body.content).toBe(checked);
  expect(saves[0]!.body.expectedBoardId).toBe('A');
  if (timing === 'before') {
    await act(async () => replay(source));
    await Bun.sleep(20); // Let the older Markdown render finish before the acknowledgement.
  }
  await act(async () => saves[0]!.resolve(Response.json({ ok: true, contentRevision: 41 })));
  await waitFor(() => expect(nodes.value.get('tasks')?.contentRevision).toBe(41));
  await act(async () => replay({ ...source, position: { x: 80, y: 90 } }));
  await Bun.sleep(20);
  expect(nodes.value.get('tasks')?.data.content).toBe(checked);
  expect(nodes.value.get('tasks')?.position).toEqual({ x: 80, y: 90 });
  expect((card.container.querySelectorAll('input')[1] as HTMLInputElement).checked).toBe(true);
  card.unmount();
  const expanded = render(<Card expanded />);
  await waitFor(() => expect(expanded.container.querySelectorAll('input')).toHaveLength(2));
  expect((expanded.container.querySelectorAll('input')[1] as HTMLInputElement).checked).toBe(true);
  fireEvent.click(expanded.container.querySelectorAll('input')[1]!);
  await waitFor(() => expect(saves).toHaveLength(2));
  expect(saves[1]!.body.content).toContain('[ ]  second');
  await act(async () => saves[1]!.resolve(Response.json({ ok: true, contentRevision: 42 })));
  await waitFor(() => expect(nodes.value.get('tasks')?.contentRevision).toBe(42));
  expect(nodes.value.get('tasks')?.data.content).toContain('[ ]  second');
  // A genuinely newer agent edit must still arrive, and switching boards must
  // not preserve another board's same-ID card just because its revision is lower.
  const newer = { ...source, contentRevision: 43, data: { content: '- [ ] Agent follow-up' } };
  await act(async () => replay(newer));
  expect(nodes.value.get('tasks')?.data.content).toBe('- [ ] Agent follow-up');
  activeBoardId.value = 'B';
  hasInitialServerLayout.value = false;
  await act(async () => replay(source));
  expect(nodes.value.get('tasks')?.data.content).toBe(unchecked);
});
