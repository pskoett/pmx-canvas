import { afterEach, describe, expect, test } from 'bun:test';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/preact';
import { MarkdownNode, toggleTaskMarker } from '../../src/client/nodes/MarkdownNode.tsx';
import { InlineMarkdownEditor } from '../../src/client/nodes/InlineMarkdownEditor.tsx';
import { renderWikiMarkdown } from '../../src/server/wiki-links.ts';
import { activeBoardId, applyBoards, connectBoardCatalog } from '../../src/client/state/boards-store.ts';
import { hasInitialServerLayout, nodes } from '../../src/client/state/canvas-store.ts';
import { EVENT_HANDLERS } from '../../src/client/state/sse-bridge.ts';
import type { CanvasNodeState } from '../../src/client/types.ts';
import { wikiLinksFromData, type WikiLink } from '../../src/shared/memory-graph.ts';
import { installWorkbenchTransport } from '../../src/client/state/workbench-transport.ts';

const originalFetch = globalThis.fetch;
afterEach(() => {
  cleanup();
  installWorkbenchTransport(undefined);
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

test.each([
  false,
  true,
])('a delayed save acknowledgement preserves resolved wiki HTML (file-backed=%s)', async (fileBacked) => {
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
    data: { content: 'See [[B]]', wikiLinks: [{ ref: 'B' }], ...(fileBacked ? { path: 'decision.md' } : {}) },
  };
  const acknowledgements: Array<(response: Response) => void> = [];
  let savedContent = '';
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) === '/api/render') {
      const { markdown } = JSON.parse(String(init?.body)) as { markdown: string };
      return Response.json({
        html: renderWikiMarkdown(markdown, wikiLinksFromData(nodes.value.get(source.id)!.data), () => true),
      });
    }
    if (init?.method === 'PATCH') {
      savedContent = (JSON.parse(String(init.body)) as { content: string }).content;
      return new Promise<Response>((resolve) => acknowledgements.push(resolve));
    }
    if (String(input) === '/api/file/save') return Response.json({ ok: true, updatedAt: '2026-10-11T10:00:00Z' });
    if (String(input).startsWith('/api/file?')) return Response.json({ content: 'See [[B]]' });
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
  const editor = view.container.querySelector('[contenteditable]')!;
  editor.append(document.createTextNode(' Updated.'));
  fireEvent.input(editor);
  fireEvent.blur(editor);
  await waitFor(() => expect(acknowledgements).toHaveLength(1));
  await act(async () =>
    replay({
      ...source,
      contentRevision: 41,
      linksRevision: 11,
      data: { ...source.data, content: savedContent, wikiLinks: [{ ref: 'B', target: { boardId: 'b' } }] },
    }),
  );
  await waitFor(() => expect(nodes.value.get(source.id)?.data.rendered).toContain('data-wiki-board="b"'));
  await act(async () => acknowledgements[0]!(Response.json({ ok: true, contentRevision: 41 })));
  await Bun.sleep(20);
  expect(nodes.value.get(source.id)?.data.rendered).toContain('data-wiki-board="b"');
  expect(view.container.querySelector('a')?.getAttribute('data-wiki-board')).toBe('b');
});

test.each([
  ['held', ''],
  ['held', 'Replacement decision.'],
  ['refused', ''],
  ['refused', 'Replacement decision.'],
  ['render-held', ''],
  ['render-held', 'Replacement decision.'],
])('an inline draft survives Source and back with a %s save (draft=%s)', async (acknowledgement, draft) => {
  const source: CanvasNodeState = {
    id: 'empty-save',
    type: 'markdown',
    position: { x: 0, y: 0 },
    size: { width: 360, height: 240 },
    zIndex: 1,
    collapsed: false,
    pinned: false,
    contentRevision: 40,
    data: { content: 'Text the human deleted.' },
  };
  let acknowledged = false;
  let releaseRender!: () => void;
  const postSaveRender = new Promise<void>((resolve) => {
    releaseRender = resolve;
  });
  let candidateRequested = false;
  let releaseCandidate!: () => void;
  const candidateRender = new Promise<void>((resolve) => {
    releaseCandidate = resolve;
  });
  const acknowledgements: Array<(response: Response) => void> = [];
  const savedDrafts: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) === '/api/render') {
      const { markdown } = JSON.parse(String(init?.body)) as { markdown: string };
      if (acknowledgement === 'render-held' && markdown === draft) {
        candidateRequested = true;
        await candidateRender;
      }
      if (acknowledged && markdown === draft) await postSaveRender;
      return Response.json({ html: renderWikiMarkdown(markdown, [], () => false) });
    }
    if (init?.method === 'PATCH') {
      savedDrafts.push((JSON.parse(String(init.body)) as { content: string }).content);
      return new Promise<Response>((resolve) => acknowledgements.push(resolve));
    }
    return Response.json({});
  }) as typeof fetch;
  activeBoardId.value = null;
  hasInitialServerLayout.value = false;
  EVENT_HANDLERS['canvas-layout-update']({ layout: { nodes: [source], edges: [] } });
  function Card() {
    return <MarkdownNode node={nodes.value.get(source.id)!} expanded />;
  }
  const view = render(<Card />);
  await waitFor(() =>
    expect(view.container.querySelector('[contenteditable]')?.textContent).toContain('Text the human deleted.'),
  );
  const editor = view.container.querySelector<HTMLElement>('[contenteditable]')!;
  editor.innerHTML = draft ? `<p>${draft}</p>` : '';
  fireEvent.input(editor);
  fireEvent.keyDown(editor, { key: 's', ctrlKey: true });
  if (acknowledgement === 'render-held') await waitFor(() => expect(candidateRequested).toBe(true));
  else await waitFor(() => expect(acknowledgements).toHaveLength(1));
  try {
    if (acknowledgement === 'refused') {
      await act(async () =>
        acknowledgements[0]!(Response.json({ ok: false, error: 'Reconnect before saving' }, { status: 409 })),
      );
    }
    // A local draft is not a server acknowledgement: switching modes must
    // preserve it even when the card PATCH is held or refused.
    fireEvent.click(view.getByRole('button', { name: '</> Source', exact: true }));
    expect(view.container.querySelector('textarea')?.value).toBe(draft);
    expect(view.getByRole('button', { name: 'Save', exact: true }).hasAttribute('disabled')).toBe(false);
    fireEvent.click(view.getByRole('button', { name: 'Back to document', exact: true }));
    if (acknowledgement === 'render-held') {
      expect(view.container.querySelector('textarea')?.value).toBe(draft);
      expect(view.container.querySelector('[contenteditable]')).toBeNull();
      await act(async () => releaseCandidate());
    }
    await waitFor(() => expect(view.container.querySelector('[contenteditable]')?.textContent?.trim()).toBe(draft));
    // An empty text assertion also matches before the new editor's mount effect.
    await waitFor(() => expect(view.container.querySelector('[contenteditable]')?.hasChildNodes()).toBe(true));
    fireEvent.blur(view.container.querySelector('[contenteditable]')!);
    acknowledged = true;
    if (acknowledgement !== 'refused') {
      await act(async () => acknowledgements[0]!(Response.json({ ok: true, contentRevision: 41 })));
      await waitFor(() => expect(nodes.value.get(source.id)?.data.content).toBe(draft));
    }
    fireEvent.click(view.getByRole('button', { name: '</> Source', exact: true }));
    expect(view.container.querySelector('textarea')?.value).toBe(draft);
    fireEvent.click(view.getByRole('button', { name: 'Back to document', exact: true }));
    await waitFor(() => expect(view.container.querySelector('[contenteditable]')?.textContent?.trim()).toBe(draft));
    await act(async () => releaseRender());
    // The blur save waits for the first complete save, rather than racing it.
    await waitFor(() => expect(acknowledgements).toHaveLength(2));
    expect(savedDrafts).toEqual([draft, draft]);
    await act(async () => acknowledgements[1]!(Response.json({ ok: true, contentRevision: 41 })));
    await waitFor(() => expect(nodes.value.get(source.id)?.data.content).toBe(draft));
    expect(view.container.querySelector('[contenteditable]')?.textContent?.trim()).toBe(draft);
  } finally {
    releaseCandidate();
    releaseRender();
  }
});

test('the rich editor preserves wiki references and aliases while editing their visible labels', async () => {
  const content = 'See [[Old research#Evidence|Read this]] and [[Pending]] and [Ordinary](https://example.com).\n';
  const html = renderWikiMarkdown(
    content,
    [{ ref: 'Old research#Evidence', target: { boardId: 'r1', cardId: 'e1' } }, { ref: 'Pending' }],
    () => true,
  );
  let saved = '';
  const view = render(
    <InlineMarkdownEditor
      markdown={content}
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
  fireEvent.keyDown(editor, { key: 's', ctrlKey: true });
  expect(saved).toBe(content);
  editor.querySelector('a')!.textContent = 'Read fresh';
  fireEvent.input(editor);
  expect(saved).toContain('[[Old research#Evidence|Read fresh]]');
  expect(saved).toContain('[[Pending]]');
  expect(saved).toContain('[Ordinary](https://example.com)');
  const draftText = editor.querySelector('a')!.firstChild!;
  const range = document.createRange();
  range.setStart(draftText, 4);
  range.collapse(true);
  document.getSelection()!.removeAllRanges();
  document.getSelection()!.addRange(range);
  view.rerender(
    <InlineMarkdownEditor
      markdown={content}
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
  ['```text\n- [ ] code\n```\n\n> - [ ] quoted\n\n- [ ] real', 0, '> - [x] quoted'],
  ['    - [ ] indented code\n\n- [ ] real', 0, '- [x] real'],
  ['> ~~~~\n> - [ ] code\n> ~~~\n> - [ ] still code\n> ~~~~\n\n>> - [ ] quoted', 0, '>> - [x] quoted'],
  ['- parent\n  > - [ ] quoted\n\n- [ ] real', 1, '- [x] real'],
  ['> 1. [X] repeated\r\n> 2. [ ] repeated\r\n', 0, '> 1. [ ] repeated'],
  ['- [ ] loose\n\n  paragraph\n\n- [ ] last', 0, '- [x] loose'],
  ['<input type="checkbox">\n\n- [ ] real', 0, '- [x] real'],
  ['[x]: /url "\n- [x] hidden\n"\n\n- [x] visible', 0, '- [ ] visible'],
  ['<span><input data-pmx-task type="checkbox" disabled></span>\n\n- [ ] first\n- [ ] second', 0, '- [x] first'],
  ['Intro\n\n<template>\n\n> - [ ] hidden\n\n</template>\n\n- [ ] visible', 0, '- [x] visible'],
] as const)('card checkbox %s maps to its exact source marker', async (markdown, index, changedLine) => {
  const node: CanvasNodeState = {
    id: 'source-mapped-task',
    type: 'markdown',
    position: { x: 0, y: 0 },
    size: { width: 360, height: 240 },
    zIndex: 1,
    collapsed: false,
    pinned: false,
    contentRevision: 1,
    data: { content: markdown },
  };
  let saved: string | undefined;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) === '/api/render') {
      const { markdown } = JSON.parse(String(init?.body)) as { markdown: string };
      return Response.json({ html: renderWikiMarkdown(markdown, [], () => false) });
    }
    if (init?.method === 'PATCH') {
      saved = (JSON.parse(String(init.body)) as { content: string }).content;
      return Response.json({ ok: true, contentRevision: 2 });
    }
    return Response.json({});
  }) as typeof fetch;
  activeBoardId.value = null;
  nodes.value = new Map([[node.id, node]]);
  const card = render(<MarkdownNode node={node} />);
  await waitFor(() => expect(card.container.querySelector('input')).not.toBeNull());
  const boxes = [...card.container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].filter((box) =>
    box.closest('li'),
  );
  fireEvent.click(boxes[index]!);
  const originalLine = changedLine.replace(/\[([ x])\]/, (_, state: string) => (state === ' ' ? '[X]' : '[ ]'));
  const sourceLine = markdown.includes(originalLine) ? originalLine : originalLine.replace('[X]', '[x]');
  const expected = markdown.replace(sourceLine, changedLine);
  await waitFor(() => expect(saved).toBe(expected));
});

test.each([
  'before',
  'after',
])('an older poll %s the save acknowledgement cannot untick a saved task', async (timing) => {
  const unchecked = '- [x] first\n- [ ] second';
  const checked = '- [x] first\n- [x] second';
  const sourceBoard = `A-${timing}`;
  const otherBoard = `B-${timing}`;
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
      return Response.json({ html: renderWikiMarkdown(body.markdown, [], () => false) });
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
    activeBoardId.value = sourceBoard;
  });
  await waitFor(() => expect(card.container.querySelectorAll('input[type="checkbox"]')).toHaveLength(2));
  fireEvent.click(card.container.querySelectorAll('input')[1]!);
  await waitFor(() => expect(saves).toHaveLength(1));
  expect(saves[0]!.body.content).toBe(checked);
  expect(saves[0]!.body.expectedBoardId).toBe(sourceBoard);
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
  fireEvent.click(expanded.getByRole('button', { name: '</> Source', exact: true }));
  const draft = 'Human draft retained after refusal.';
  fireEvent.input(expanded.container.querySelector('textarea')!, { target: { value: draft } });
  fireEvent.click(expanded.getByRole('button', { name: 'Save', exact: true }));
  await waitFor(() => expect(saves).toHaveLength(3));
  await act(async () => saves[2]!.resolve(Response.json({ ok: false, error: 'Reconnect' }, { status: 409 })));
  activeBoardId.value = otherBoard;
  hasInitialServerLayout.value = false;
  await act(async () => replay(source));
  expect(nodes.value.get('tasks')?.data.content).toBe(unchecked);
  await waitFor(() => expect(expanded.container.querySelector('textarea')?.value).toBe(unchecked));
  activeBoardId.value = sourceBoard;
  hasInitialServerLayout.value = false;
  await act(async () => replay(newer));
  await waitFor(() => expect(expanded.container.querySelector('textarea')?.value).toBe(draft));
  expect(expanded.getByRole('button', { name: 'Save', exact: true }).hasAttribute('disabled')).toBe(false);
  fireEvent.click(expanded.getByRole('button', { name: 'Save', exact: true }));
  await waitFor(() => expect(saves).toHaveLength(4));
  expect(saves[3]!.body.expectedBoardId).toBe(sourceBoard);
  await act(async () => saves[3]!.resolve(Response.json({ ok: true, contentRevision: 44 })));
  await waitFor(() => expect(nodes.value.get('tasks')?.data.content).toBe(draft));
  activeBoardId.value = otherBoard;
  hasInitialServerLayout.value = false;
  await act(async () => replay(source));
  await waitFor(() => expect(expanded.container.querySelector('textarea')?.value).toBe(unchecked));
  fireEvent.click(expanded.getByRole('button', { name: 'Back to document', exact: true }));
  await waitFor(() => expect(expanded.container.querySelector('[contenteditable]')).not.toBeNull());
  const trailing = expanded.container.querySelector<HTMLElement>('[contenteditable]')!;
  trailing.innerHTML = '<p>Trailing edit on the other board.</p>';
  fireEvent.input(trailing);
  expanded.unmount();
  await waitFor(() => expect(saves).toHaveLength(5));
  expect(saves[4]!.body).toMatchObject({ content: 'Trailing edit on the other board.', expectedBoardId: otherBoard });
  await act(async () => saves[4]!.resolve(Response.json({ ok: true, contentRevision: 41 })));
});

test('a remounted Document uses the matching shared preview, not another draft HTML', async () => {
  const source: CanvasNodeState = {
    id: 'preview-remount',
    type: 'markdown',
    position: { x: 0, y: 0 },
    size: { width: 360, height: 240 },
    zIndex: 1,
    collapsed: false,
    pinned: false,
    contentRevision: 40,
    data: { content: 'Original.' },
  };
  const a = 'First draft A.';
  const b = 'Different draft B.';
  const renders: Array<() => void> = [];
  let saved = '';
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) === '/api/render') {
      const { markdown } = JSON.parse(String(init?.body)) as { markdown: string };
      if (markdown === a && renders.length < 2) await new Promise<void>((resolve) => renders.push(resolve));
      return Response.json({ html: renderWikiMarkdown(markdown, [], () => false) });
    }
    if (init?.method === 'PATCH') {
      saved = (JSON.parse(String(init.body)) as { content: string }).content;
      return Response.json({ ok: true, contentRevision: 41 });
    }
    return Response.json({});
  }) as typeof fetch;
  activeBoardId.value = null;
  hasInitialServerLayout.value = false;
  EVENT_HANDLERS['canvas-layout-update']({ layout: { nodes: [source], edges: [] } });
  function Card() {
    return <MarkdownNode node={nodes.value.get(source.id)!} expanded />;
  }
  const first = render(<Card />);
  try {
    await waitFor(() => expect(first.container.querySelector('[contenteditable]')?.textContent).toContain('Original.'));
    fireEvent.click(first.getByRole('button', { name: '</> Source', exact: true }));
    fireEvent.input(first.container.querySelector('textarea')!, { target: { value: a } });
    await waitFor(() => expect(renders).toHaveLength(1));
    fireEvent.input(first.container.querySelector('textarea')!, { target: { value: b } });
    await waitFor(() => expect(first.container.querySelector('.md-preview')?.textContent).toContain(b));
    first.unmount();
    const second = render(<Card />);
    await waitFor(() => expect(second.container.querySelector('[contenteditable]')?.textContent).toContain(b));
    fireEvent.click(second.getByRole('button', { name: '</> Source', exact: true }));
    fireEvent.input(second.container.querySelector('textarea')!, { target: { value: a } });
    await waitFor(() => expect(renders).toHaveLength(2));
    await act(async () => renders[0]!());
    fireEvent.click(second.getByRole('button', { name: 'Back to document', exact: true }));
    await waitFor(() => expect(second.container.querySelector('[contenteditable]')?.textContent?.trim()).toBe(a));
    fireEvent.blur(second.container.querySelector('[contenteditable]')!);
    await waitFor(() => expect(saved).toBe(a));
    await act(async () => renders[1]!());
    expect(second.container.querySelector('[contenteditable]')?.textContent?.trim()).toBe(a);
  } finally {
    for (const release of renders) release();
  }
});

test.each([
  [false, false, false, false],
  [false, true, false, false],
  [true, false, false, false],
  [true, true, false, false],
  [true, false, true, false],
  [true, true, true, false],
  [false, false, false, true],
  [true, false, false, true],
])('a delayed save cannot replace a foreign/newer/restored card (hosted=%s, newer=%s, duringRender=%s, restored=%s)', async (hosted, newer, duringRender, restored) => {
  const source: CanvasNodeState = {
    id: `ack-owner-${hosted}-${newer}-${duringRender}-${restored}`,
    type: 'markdown',
    position: { x: 0, y: 0 },
    size: { width: 360, height: 240 },
    zIndex: 1,
    collapsed: false,
    pinned: false,
    contentRevision: 40,
    data: { content: 'Original A.' },
  };
  const incoming = {
    ...source,
    contentRevision: newer ? 42 : 7,
    data: { content: newer ? 'Newer agent A.' : restored ? 'Restored A.' : 'Different B.' },
  };
  const catalog = {
    catalogEpoch: source.id,
    catalogRevision: 1,
    reloadRevision: 0,
    activeBoardId: 'ack-A',
    boards: [],
  };
  connectBoardCatalog(catalog.catalogEpoch);
  applyBoards(catalog);
  let acknowledge: ((response: Response) => void) | undefined;
  let releaseRender: (() => void) | undefined;
  const renderGate = new Promise<void>((resolve) => {
    releaseRender = resolve;
  });
  let rendering = false;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) === '/api/render') {
      const { markdown } = JSON.parse(String(init?.body)) as { markdown: string };
      if (duringRender && acknowledge && markdown === 'Saved A.') {
        rendering = true;
        await renderGate;
      }
      return Response.json({ html: renderWikiMarkdown(markdown, [], () => false) });
    }
    if (init?.method === 'PATCH')
      return new Promise<Response>((resolve) => {
        acknowledge = resolve;
      });
    return Response.json({});
  }) as typeof fetch;
  if (hosted) installWorkbenchTransport(globalThis.fetch);
  const replay = (boardId: string, node: CanvasNodeState) => {
    activeBoardId.value = boardId;
    hasInitialServerLayout.value = false;
    EVENT_HANDLERS['canvas-layout-update']({ layout: { nodes: [node], edges: [] } });
  };
  replay('ack-A', source);
  function Card() {
    return <MarkdownNode node={nodes.value.get(source.id)!} expanded />;
  }
  const view = render(<Card />);
  await waitFor(() => expect(view.container.querySelector('[contenteditable]')?.textContent).toContain('Original A.'));
  fireEvent.click(view.getByRole('button', { name: '</> Source', exact: true }));
  fireEvent.input(view.container.querySelector('textarea')!, { target: { value: 'Saved A.' } });
  fireEvent.click(view.getByRole('button', { name: 'Save', exact: true }));
  await waitFor(() => expect(acknowledge).toBeDefined());
  if (duringRender) {
    await act(async () => acknowledge!(Response.json({ ok: true, contentRevision: 41 })));
    await waitFor(() => expect(rendering).toBe(true));
  }
  await act(async () => {
    if (restored) applyBoards({ ...catalog, catalogRevision: 2, reloadRevision: 2 });
    replay(newer || restored ? 'ack-A' : 'ack-B', incoming);
  });
  const draft = newer || restored ? 'Saved A.' : 'Different B.';
  await waitFor(() => expect(view.container.querySelector('textarea')?.value).toBe(draft));
  await act(async () => {
    if (!duringRender) acknowledge!(Response.json({ ok: true, contentRevision: 41 }));
    releaseRender!();
    await Bun.sleep(20);
  });
  expect(nodes.value.get(source.id)?.contentRevision).toBe(incoming.contentRevision);
  expect(nodes.value.get(source.id)?.data.content).toBe(incoming.data.content);
  expect(view.container.querySelector('textarea')?.value).toBe(draft);
  if (restored)
    expect((view.getByRole('button', { name: 'Save', exact: true }) as HTMLButtonElement).disabled).toBe(false);
});
