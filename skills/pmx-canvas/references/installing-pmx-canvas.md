# Installing PMX Canvas

Use this reference when the `pmx-canvas` skill is installed but the `pmx-canvas` command is not available yet.

## From npm

```bash
npm install -g pmx-canvas
pmx-canvas serve --daemon --no-open --wait-ms=20000
pmx-canvas open
```

## From a local checkout

```bash
git clone https://github.com/pskoett/pmx-canvas.git
cd pmx-canvas
bun install
bun run build
bun run src/cli/index.ts serve --daemon --no-open --wait-ms=20000
```

For development, run commands through Bun from the checkout:

```bash
bun run src/cli/index.ts status
bun run src/cli/index.ts node add --type markdown --title "Hello" --content "# PMX"
```

## MCP Config

For agents that support MCP, configure PMX Canvas as a stdio MCP server:

```json
{
  "mcpServers": {
    "canvas": {
      "command": "bunx",
      "args": ["pmx-canvas", "--mcp"]
    }
  }
}
```

If you are using a local checkout instead of the published package, point the command at the CLI entry:

```json
{
  "mcpServers": {
    "canvas": {
      "command": "bun",
      "args": ["run", "/path/to/pmx-canvas/src/cli/index.ts", "--mcp"]
    }
  }
}
```

## Verify

```bash
pmx-canvas --version
pmx-canvas serve status
pmx-canvas layout
```

The CLI defaults to `http://localhost:4313`. Override with `PMX_CANVAS_URL` or `PMX_CANVAS_PORT` if the server runs elsewhere.
