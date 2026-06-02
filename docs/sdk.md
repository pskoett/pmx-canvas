# JavaScript/TypeScript SDK (Bun runtime)

The published SDK entrypoint is Bun-first. Node.js consumers should use the
[CLI](cli.md), [MCP server](mcp.md), or [HTTP API](http-api.md) instead.

```bash
bun add pmx-canvas
```

## Quick example

```ts
import { createCanvas } from 'pmx-canvas';

const canvas = createCanvas({ port: 4313 });
await canvas.start({ open: true });

// Add nodes
const n1 = canvas.addNode({ type: 'markdown', title: 'Plan', content: '# Step 1\nDo the thing.' });
const n2 = canvas.addNode({ type: 'status', title: 'Build', content: 'passing' });
const n3 = canvas.addNode({ type: 'file', content: 'src/index.ts' });

// Connect them
canvas.addEdge({ from: n1, to: n2, type: 'flow' });

// Group related nodes
canvas.createGroup({ title: 'Build Pipeline', childIds: [n1, n2] });

// Self-contained HTML in a sandboxed iframe
canvas.addHtmlNode({
  title: 'Cost projection',
  summary: 'Cost projection chart for the Q2 plan.',
  html: '<canvas id="c"></canvas><script src="https://cdn.jsdelivr.net/npm/chart.js"></script><script>/* ... */</script>',
});

// Generated HTML communication primitive, stored as a sandboxed html node
canvas.addHtmlPrimitive({
  kind: 'choice-grid',
  title: 'Implementation options',
  data: {
    items: [
      { title: 'Small patch', summary: 'Least disruption.', pros: ['Fast'], cons: ['Less flexible'] },
    ],
  },
});

// Hand-drawn diagram via the Excalidraw MCP-app preset
await canvas.addDiagram({
  elements: [
    { type: 'rectangle', id: 'r1', x: 80, y: 80, width: 160, height: 60,
      roundness: { type: 3 }, backgroundColor: '#a5d8ff', fillStyle: 'solid',
      label: { text: 'Agent' } },
  ],
  title: 'Quick sketch',
});

// Batch-build a graph and group around it
await canvas.runBatch([
  {
    op: 'graph.add',
    assign: 'graph',
    args: {
      title: 'Major wins',
      graphType: 'bar',
      data: [
        { label: 'Docs', value: 5 },
        { label: 'Tests', value: 8 },
      ],
      xKey: 'label',
      yKey: 'value',
    },
  },
  {
    op: 'group.create',
    args: {
      title: 'Quarterly graphs',
      childIds: ['$graph.id'],
    },
  },
]);

// Arrange and inspect
canvas.arrange('grid');
console.log(canvas.validate());
console.log(canvas.getLayout());

// AX context for host adapters
canvas.setAxFocus({ nodeIds: [n1], source: 'sdk' });
console.log(canvas.getAxState());
console.log(canvas.getAxContext());
```

## WebView automation

```ts
const webview = await canvas.startAutomationWebView({ backend: 'chrome', width: 1280, height: 800 });
console.log(webview.active);
console.log(await canvas.evaluateAutomationWebView('document.title'));
await canvas.resizeAutomationWebView(1440, 900);
const screenshot = await canvas.screenshotAutomationWebView({ format: 'png' });
console.log(screenshot.byteLength);
await canvas.stopAutomationWebView();
```

## See also

- [Node types](node-types.md) — what each node type is for
- [HTTP API](http-api.md) — the same operations from any language
- [MCP reference](mcp.md) — the agent-facing surface
