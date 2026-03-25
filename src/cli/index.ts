#!/usr/bin/env bun

const args = process.argv.slice(2);

if (args.includes('--mcp')) {
  // MCP server mode: stdio transport, auto-starts canvas on first tool call
  const { startMcpServer } = await import('../mcp/server.js');
  await startMcpServer();
} else {
  const { createCanvas } = await import('../server/index.js');

  const port = parseInt(args.find(a => a.startsWith('--port='))?.split('=')[1] ?? '4313');
  const demo = args.includes('--demo');
  const noOpen = args.includes('--no-open');
  const themeArg = args.find(a => a.startsWith('--theme='))?.split('=')[1];
  if (themeArg && ['dark', 'light', 'high-contrast'].includes(themeArg)) {
    process.env.PMX_CANVAS_THEME = themeArg;
  }
  const help = args.includes('--help') || args.includes('-h');

  if (help) {
    console.log(`
pmx-canvas — Spatial canvas workbench for coding agents

Usage:
  pmx-canvas [options]

Options:
  --port=PORT    Server port (default: 4313)
  --demo         Start with sample nodes
  --no-open      Don't open browser automatically
  --theme=THEME  Theme: dark (default), light, high-contrast
  --mcp          Run as MCP server (stdio transport)
  --help, -h     Show this help

MCP Integration:
  Add to your agent's MCP config:
  {
    "mcpServers": {
      "canvas": {
        "command": "bunx",
        "args": ["pmx-canvas", "--mcp"]
      }
    }
  }

HTTP API:
  GET  /api/canvas/state          Full canvas layout
  POST /api/canvas/update         Batch update node positions
  POST /api/canvas/edge           Add an edge
  DELETE /api/canvas/edge         Remove an edge
  GET  /api/workbench/events      SSE event stream

Examples:
  pmx-canvas                      Start canvas, open browser
  pmx-canvas --demo               Start with sample content
  pmx-canvas --port=8080          Custom port
  pmx-canvas --no-open            Start server only (for agents)
  pmx-canvas --mcp                Run as MCP server
`);
    process.exit(0);
  }

  const canvas = createCanvas({ port });
  await canvas.start({ open: !noOpen });

  if (demo && canvas.getLayout().nodes.length === 0) {
    const n1 = canvas.addNode({
      type: 'markdown',
      title: 'Welcome to PMX Canvas',
      content: '# PMX Canvas Workbench\n\nA spatial canvas for coding agents.\n\n## Features\n- Infinite 2D canvas with pan/zoom\n- Multiple node types\n- Edges between nodes\n- Real-time SSE updates\n- HTTP API for agent control',
    });

    const n2 = canvas.addNode({
      type: 'markdown',
      title: 'Getting Started',
      content: `# Quick Start\n\n\`\`\`bash\n# Add a node via HTTP\ncurl -X POST http://localhost:${port}/api/canvas/node \\\\\n  -H "Content-Type: application/json" \\\\\n  -d '{"type":"markdown","title":"Hello","content":"# World"}'\n\n# Get canvas state\ncurl http://localhost:${port}/api/canvas/state\n\`\`\``,
    });

    const n3 = canvas.addNode({
      type: 'status',
      title: 'Agent Status',
      content: 'Ready',
    });

    canvas.addEdge({ from: n1, to: n2, type: 'flow', label: 'next' });
    canvas.addEdge({ from: n2, to: n3, type: 'flow' });
    canvas.arrange('grid');
  }

  console.log(`\n  PMX Canvas running at http://localhost:${canvas.port}\n`);
  console.log('  HTTP API:');
  console.log('    GET  /api/canvas/state     — Full canvas layout');
  console.log('    POST /api/canvas/node      — Add a node');
  console.log('    POST /api/canvas/update    — Update node positions');
  console.log('    GET  /api/workbench/events — SSE event stream');
  console.log('\n  Press Ctrl+C to stop\n');

  process.on('SIGINT', () => {
    console.log('\nShutting down...');
    canvas.stop();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    canvas.stop();
    process.exit(0);
  });
}
