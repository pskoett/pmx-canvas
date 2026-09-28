import { describe, expect, test } from 'bun:test';
import { serializeNodeForAgentContext, summarizeNodeForAgentContext } from '../../src/server/agent-context.ts';
import type { CanvasNodeState } from '../../src/server/canvas-state.ts';
import { searchNodes } from '../../src/server/spatial-analysis.ts';

function makeNode(data: Record<string, unknown>): CanvasNodeState {
  return {
    id: 'node-1',
    type: 'mcp-app',
    position: { x: 120, y: 80 },
    size: { width: 720, height: 500 },
    zIndex: 1,
    collapsed: false,
    pinned: false,
    data,
  };
}

function makeTypedNode(type: CanvasNodeState['type'], data: Record<string, unknown>): CanvasNodeState {
  return {
    ...makeNode(data),
    type,
  };
}

describe('meaningful card text', () => {
  const samples: Record<CanvasNodeState['type'], { data: Record<string, unknown>; meaning: string }> = {
    markdown: { data: { content: 'Keep the source', rendered: '<p>Keep the source</p>' }, meaning: 'Keep the source' },
    board: { data: { boardId: 'board-1', title: 'Roadmap' }, meaning: 'Roadmap' },
    status: { data: { phase: 'blocked', detail: 'Waiting for budget' }, meaning: 'Waiting for budget' },
    context: {
      data: { cards: [{ title: 'Policy', summary: 'Retain for seven years' }] },
      meaning: 'Retain for seven years',
    },
    ledger: { data: { approvedBudget: 420, spent: 37 }, meaning: 'approvedBudget: 420' },
    trace: { data: { toolName: 'fetch', status: 'failed', error: 'Permission denied' }, meaning: 'Permission denied' },
    file: { data: { path: '/report.md', fileContent: 'Revenue rose 12 percent' }, meaning: 'Revenue rose 12 percent' },
    diff: { data: { content: '-old budget\n+new budget' }, meaning: '+new budget' },
    mermaid: { data: { content: 'graph TD; Review-->Approve' }, meaning: 'Review-->Approve' },
    image: {
      data: { alt: 'Workshop with three teams', src: 'data:image/png;base64,NOT_CONTEXT' },
      meaning: 'Workshop with three teams',
    },
    html: {
      data: { summary: 'Three options for delivery', html: '<script>NOT_CONTEXT</script>' },
      meaning: 'Three options for delivery',
    },
    group: { data: { title: 'Research', children: ['a', 'b', 'c'] }, meaning: '3 cards' },
    graph: {
      data: {
        graphConfig: {
          graphType: 'bar',
          data: [
            { quarter: 'Q1', revenue: 17 },
            { quarter: 'Q2', revenue: 42 },
          ],
          color: 'NOT_CONTEXT',
        },
      },
      meaning: 'revenue: 42',
    },
    'json-render': {
      data: {
        spec: {
          root: 'note',
          elements: { note: { type: 'Text', props: { text: 'Renewal is at risk', className: 'NOT_CONTEXT' } } },
        },
      },
      meaning: 'Renewal is at risk',
    },
    'mcp-app': {
      data: { toolInput: { elements: [{ type: 'text', text: 'Check access before launch' }] } },
      meaning: 'Check access before launch',
    },
    webpage: { data: { content: 'Published delivery research' }, meaning: 'Published delivery research' },
    prompt: { data: { text: 'Compare the alternatives' }, meaning: 'Compare the alternatives' },
    response: { data: { text: 'Option B costs less' }, meaning: 'Option B costs less' },
  };

  for (const [type, { data, meaning }] of Object.entries(samples)) {
    test(`${type} carries content rather than raw configuration`, () => {
      const text = summarizeNodeForAgentContext(makeTypedNode(type as CanvasNodeState['type'], data));
      expect(text).toContain(meaning);
      expect(text).not.toMatch(/^\s*[[{]/);
      expect(text).not.toContain('NOT_CONTEXT');
      expect(text).not.toContain('<p>');
    });
  }

  test('missing image meaning is explicit, not an image URL masquerading as content', () => {
    const text = summarizeNodeForAgentContext(makeTypedNode('image', { src: 'data:image/png;base64,SECRET' }));
    expect(text).toContain('No image description');
    expect(text).not.toContain('SECRET');
  });

  test('surface text follows reachable children, keeps zero values, and excludes actions and detached content', () => {
    const node = makeTypedNode('json-render', {
      spec: {
        root: 'root',
        elements: {
          detached: { props: { text: 'DETACHED' } },
          second: { props: { label: 'Remaining budget', value: 0 }, children: ['root'] },
          root: { props: { title: 'Budget', on: { press: 'INTERNAL_ACTION' } }, children: ['first', 'second'] },
          first: { props: { text: 'Approved: 42' } },
        },
      },
    });
    const text = summarizeNodeForAgentContext(node);
    expect(text).toContain('Budget\nApproved: 42\nRemaining budget\n0');
    expect(text).toContain('dynamic visibility not evaluated');
    expect(text).not.toContain('DETACHED');
    expect(text).not.toContain('INTERNAL_ACTION');
  });

  test('search uses full semantic text, not the truncated brief or renderer configuration', () => {
    const node = makeTypedNode('graph', {
      graphConfig: {
        graphType: 'bar',
        data: Array.from({ length: 100 }, (_, i) => ({
          account: i === 99 ? 'RareCustomer' : `Account ${i}`,
          value: i,
        })),
        color: 'hidden-config-needle',
      },
    });
    expect(summarizeNodeForAgentContext(node)).not.toContain('RareCustomer');
    expect(searchNodes([node], 'missing RareCustomer')[0]?.snippet).toContain('RareCustomer');
    expect(searchNodes([node], 'hidden-config-needle')).toEqual([]);
  });

  test('the entire file summary obeys the delivery budget, including its path', () => {
    const node = makeTypedNode('file', { path: '/very/long/path/to/a/report.md', fileContent: 'A report' });
    expect(summarizeNodeForAgentContext(node, { defaultTextLength: 12 }).length).toBeLessThanOrEqual(12);
    expect(summarizeNodeForAgentContext(node, { defaultTextLength: 0 })).toBe('');
  });
});

describe('agent-context mcp-app summaries', () => {
  test('summarizes ext-app nodes with source and diagram hints', () => {
    const node = makeNode({
      title: 'Excalidraw - collaboration flow',
      mode: 'ext-app',
      hostMode: 'hosted',
      serverName: 'excalidraw',
      toolName: 'open_diagram',
      resourceUri: 'ui://excalidraw/app.html',
      sessionStatus: 'ready',
      toolInput: {
        elements: [{ type: 'rectangle' }, { type: 'arrow' }, { type: 'text' }],
      },
    });

    const summary = summarizeNodeForAgentContext(node);
    expect(summary).toContain('App: Excalidraw - collaboration flow');
    expect(summary).toContain('Source: excalidraw / open_diagram');
    expect(summary).toContain('Diagram elements: 3');
    expect(summary).toContain('Session: ready');
  });

  test('serializes web artifact metadata for pinned context consumers', () => {
    const node = makeNode({
      title: 'Canvas comparison artifact',
      viewerType: 'web-artifact',
      hostMode: 'hosted',
      content:
        'Web artifact: Canvas comparison artifact\nApp source preview:\nexport default function App() { return <main>Compare old and new canvas states</main>; }',
      sourceFiles: ['src/App.tsx', 'src/index.css'],
      sourceFileCount: 2,
      artifactBytes: 12345,
      path: '/tmp/canvas-comparison.html',
      url: '/artifact?path=%2Ftmp%2Fcanvas-comparison.html',
    });

    const serialized = serializeNodeForAgentContext(node, { includePosition: true });
    expect(serialized.type).toBe('mcp-app');
    expect(serialized.kind).toBe('web-artifact');
    expect(serialized.title).toBe('Canvas comparison artifact');
    expect(serialized.content).toContain('Web artifact: Canvas comparison artifact');
    expect(serialized.content).toContain('Compare old and new canvas states');
    expect(serialized.content).toContain('Path: /tmp/canvas-comparison.html');
    expect(serialized.content).not.toContain('<!DOCTYPE html>');
    expect(serialized.metadata).toEqual(
      expect.objectContaining({
        path: '/tmp/canvas-comparison.html',
        url: '/artifact?path=%2Ftmp%2Fcanvas-comparison.html',
        hostMode: 'hosted',
        viewerType: 'web-artifact',
        sourceFiles: ['src/App.tsx', 'src/index.css'],
        sourceFileCount: 2,
        artifactBytes: 12345,
      }),
    );
    expect(serialized.position).toEqual({ x: 120, y: 80 });
  });

  test('serializes external app kind for pinned context consumers', () => {
    const node = makeNode({
      title: 'Excalidraw app',
      mode: 'ext-app',
      serverName: 'Excalidraw',
      toolName: 'create_view',
      resourceUri: 'ui://excalidraw/app.html',
    });

    const serialized = serializeNodeForAgentContext(node);
    expect(serialized.type).toBe('mcp-app');
    expect(serialized.kind).toBe('external-app');
  });

  test('serializes html semantic sidecars for pinned context consumers', () => {
    const node = makeTypedNode('html', {
      title: 'HTML report',
      html: '<main><h1>Visible HTML report</h1><p>Semantic sidecar text.</p></main>',
      agentSummary: 'Explicit agent summary for the HTML report.',
      contentSummary: 'Visible HTML report Semantic sidecar text.',
      embeddedNodeIds: ['graph-node-1'],
    });

    const serialized = serializeNodeForAgentContext(node);
    expect(serialized.type).toBe('html');
    expect(serialized.content).toBe('Explicit agent summary for the HTML report.');
    expect(serialized.metadata).toEqual(
      expect.objectContaining({
        agentSummary: 'Explicit agent summary for the HTML report.',
        contentSummary: 'Visible HTML report Semantic sidecar text.',
        embeddedNodeIds: ['graph-node-1'],
      }),
    );
  });

  test('serializes html presentation metadata for pinned context consumers', () => {
    const node = makeTypedNode('html', {
      title: 'Planning Deck',
      html: '<main><h1>Planning Deck</h1></main>',
      agentSummary: 'Presentation covering planning tradeoffs.',
      presentation: true,
      slideCount: 2,
      slideTitles: ['Context', 'Decision'],
      speakerNotes: ['Pause for questions.'],
    });

    const serialized = serializeNodeForAgentContext(node);
    expect(serialized.type).toBe('html');
    expect(serialized.content).toBe('Presentation covering planning tradeoffs.');
    expect(serialized.metadata).toEqual(
      expect.objectContaining({
        presentation: true,
        slideCount: 2,
        slideTitles: ['Context', 'Decision'],
        speakerNotes: ['Pause for questions.'],
      }),
    );
  });
});
