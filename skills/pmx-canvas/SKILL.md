---
name: pmx-canvas
description: Open and control a spatial canvas workbench for visual node-based layouts. Use for plans, investigation boards, architecture diagrams, status dashboards, and any spatial information display.
---

# PMX Canvas — Agent Skill

PMX Canvas is a standalone spatial canvas workbench. It runs a local HTTP server that renders an infinite 2D canvas with nodes, edges, pan/zoom, and a minimap in the browser. You control it entirely through HTTP requests.

## When to Use

- **Investigation boards** — lay out files, logs, stack traces, and findings spatially while debugging
- **Architecture diagrams** — show system components and their relationships
- **Plans & task tracking** — create plan nodes with dependencies and status
- **Status dashboards** — display build results, test output, deployment state
- **Context maps** — show how code, configs, and data flow connect
- **Any time spatial layout helps** — when a flat list or text wall is not enough

## Starting the Canvas

```bash
# Start and open browser (default port 4313)
pmx-canvas

# Start on a custom port, no browser
pmx-canvas --port=8080 --no-open

# Start with demo content
pmx-canvas --demo

# Or run directly with bun
bun run src/cli/index.ts --no-open
```

The server runs until you stop it with Ctrl+C or send SIGTERM.

**Base URL:** `http://localhost:4313` (or your chosen port)

## HTTP API Reference

All POST/PATCH endpoints accept `Content-Type: application/json`.

### Get Canvas State

```bash
curl http://localhost:4313/api/canvas/state
```

Returns the full canvas: all nodes, edges, and viewport settings.

### Add a Node

```bash
curl -X POST http://localhost:4313/api/canvas/node \
  -H "Content-Type: application/json" \
  -d '{
    "type": "markdown",
    "title": "My Node",
    "content": "# Hello\n\nSome **markdown** content."
  }'
```

Returns `{ "id": "<node-id>" }`.

**Node types:** `markdown`, `code`, `status`, `image`, `embed`, `group`

**Optional fields:**
- `x`, `y` — position (default: auto-placed)
- `width`, `height` — dimensions
- `color` — node color
- `metadata` — arbitrary JSON object

### Update a Node

```bash
curl -X PATCH http://localhost:4313/api/canvas/node/<id> \
  -H "Content-Type: application/json" \
  -d '{
    "content": "Updated content",
    "title": "New Title"
  }'
```

### Delete a Node

```bash
curl -X DELETE http://localhost:4313/api/canvas/node/<id>
```

### Add an Edge

```bash
curl -X POST http://localhost:4313/api/canvas/edge \
  -H "Content-Type: application/json" \
  -d '{
    "from": "<source-node-id>",
    "to": "<target-node-id>",
    "type": "flow",
    "label": "depends on"
  }'
```

**Edge types:** `flow`, `dependency`, `reference`, `data`

### Delete an Edge

```bash
curl -X DELETE http://localhost:4313/api/canvas/edge/<id>
```

### Batch Update Positions

```bash
curl -X POST http://localhost:4313/api/canvas/update \
  -H "Content-Type: application/json" \
  -d '{
    "nodes": [
      { "id": "<id>", "x": 100, "y": 200 },
      { "id": "<id>", "x": 400, "y": 200 }
    ]
  }'
```

### Auto-Arrange Nodes

```bash
curl -X POST http://localhost:4313/api/canvas/arrange \
  -H "Content-Type: application/json" \
  -d '{ "layout": "grid" }'
```

**Layouts:** `grid`, `tree`, `force`

### SSE Event Stream

```bash
curl -N http://localhost:4313/api/workbench/events
```

Streams real-time events: `node:added`, `node:updated`, `node:removed`, `edge:added`, `edge:removed`, `layout:changed`.

## Common Patterns

### Investigation Board

When debugging an issue, lay out relevant context spatially:

```bash
PORT=4313

# Create a root node for the issue
ROOT=$(curl -s -X POST http://localhost:$PORT/api/canvas/node \
  -H "Content-Type: application/json" \
  -d '{"type":"markdown","title":"Bug: Login fails on Safari","content":"Users report 403 after OAuth redirect on Safari 17.x"}' | jq -r .id)

# Add evidence nodes
LOGS=$(curl -s -X POST http://localhost:$PORT/api/canvas/node \
  -H "Content-Type: application/json" \
  -d '{"type":"code","title":"Error Logs","content":"[ERROR] session cookie missing SameSite attribute\n[WARN] Safari rejecting cross-site cookie"}' | jq -r .id)

CODE=$(curl -s -X POST http://localhost:$PORT/api/canvas/node \
  -H "Content-Type: application/json" \
  -d '{"type":"code","title":"auth/session.ts:42","content":"res.cookie(\"session\", token, { httpOnly: true })  // missing SameSite!"}' | jq -r .id)

FIX=$(curl -s -X POST http://localhost:$PORT/api/canvas/node \
  -H "Content-Type: application/json" \
  -d '{"type":"markdown","title":"Fix","content":"Add `SameSite: None; Secure` to session cookie options"}' | jq -r .id)

# Connect them
curl -s -X POST http://localhost:$PORT/api/canvas/edge \
  -H "Content-Type: application/json" \
  -d "{\"from\":\"$ROOT\",\"to\":\"$LOGS\",\"type\":\"reference\",\"label\":\"evidence\"}"

curl -s -X POST http://localhost:$PORT/api/canvas/edge \
  -H "Content-Type: application/json" \
  -d "{\"from\":\"$LOGS\",\"to\":\"$CODE\",\"type\":\"reference\",\"label\":\"source\"}"

curl -s -X POST http://localhost:$PORT/api/canvas/edge \
  -H "Content-Type: application/json" \
  -d "{\"from\":\"$CODE\",\"to\":\"$FIX\",\"type\":\"flow\",\"label\":\"fix\"}"

# Auto-arrange
curl -s -X POST http://localhost:$PORT/api/canvas/arrange \
  -H "Content-Type: application/json" \
  -d '{"layout":"tree"}'
```

### Architecture Diagram

```bash
PORT=4313

# Create service nodes
API=$(curl -s -X POST http://localhost:$PORT/api/canvas/node \
  -H "Content-Type: application/json" \
  -d '{"type":"markdown","title":"API Gateway","content":"Express + rate limiting\nPort 3000"}' | jq -r .id)

AUTH=$(curl -s -X POST http://localhost:$PORT/api/canvas/node \
  -H "Content-Type: application/json" \
  -d '{"type":"markdown","title":"Auth Service","content":"JWT + OAuth2\nPort 3001"}' | jq -r .id)

DB=$(curl -s -X POST http://localhost:$PORT/api/canvas/node \
  -H "Content-Type: application/json" \
  -d '{"type":"markdown","title":"PostgreSQL","content":"Primary database\nPort 5432"}' | jq -r .id)

# Connect
curl -s -X POST http://localhost:$PORT/api/canvas/edge \
  -H "Content-Type: application/json" \
  -d "{\"from\":\"$API\",\"to\":\"$AUTH\",\"type\":\"flow\",\"label\":\"validates\"}"

curl -s -X POST http://localhost:$PORT/api/canvas/edge \
  -H "Content-Type: application/json" \
  -d "{\"from\":\"$AUTH\",\"to\":\"$DB\",\"type\":\"data\",\"label\":\"reads/writes\"}"

curl -s -X POST http://localhost:$PORT/api/canvas/arrange \
  -H "Content-Type: application/json" \
  -d '{"layout":"tree"}'
```

### Build/Test Status Dashboard

```bash
PORT=4313

# Show test results as status nodes
curl -X POST http://localhost:$PORT/api/canvas/node \
  -H "Content-Type: application/json" \
  -d '{"type":"status","title":"Unit Tests","content":"142 passed, 0 failed","color":"green"}'

curl -X POST http://localhost:$PORT/api/canvas/node \
  -H "Content-Type: application/json" \
  -d '{"type":"status","title":"Integration Tests","content":"Running...","color":"yellow"}'

curl -X POST http://localhost:$PORT/api/canvas/node \
  -H "Content-Type: application/json" \
  -d '{"type":"status","title":"Lint","content":"3 warnings","color":"yellow"}'

curl -X POST http://localhost:$PORT/api/canvas/arrange \
  -H "Content-Type: application/json" \
  -d '{"layout":"grid"}'
```

### Plan with Dependencies

```bash
PORT=4313

T1=$(curl -s -X POST http://localhost:$PORT/api/canvas/node \
  -H "Content-Type: application/json" \
  -d '{"type":"status","title":"1. Define schema","content":"completed","color":"green"}' | jq -r .id)

T2=$(curl -s -X POST http://localhost:$PORT/api/canvas/node \
  -H "Content-Type: application/json" \
  -d '{"type":"status","title":"2. Build API routes","content":"in progress","color":"yellow"}' | jq -r .id)

T3=$(curl -s -X POST http://localhost:$PORT/api/canvas/node \
  -H "Content-Type: application/json" \
  -d '{"type":"status","title":"3. Write tests","content":"blocked","color":"red"}' | jq -r .id)

curl -s -X POST http://localhost:$PORT/api/canvas/edge \
  -H "Content-Type: application/json" \
  -d "{\"from\":\"$T1\",\"to\":\"$T2\",\"type\":\"dependency\"}"

curl -s -X POST http://localhost:$PORT/api/canvas/edge \
  -H "Content-Type: application/json" \
  -d "{\"from\":\"$T2\",\"to\":\"$T3\",\"type\":\"dependency\"}"

curl -s -X POST http://localhost:$PORT/api/canvas/arrange \
  -H "Content-Type: application/json" \
  -d '{"layout":"tree"}'
```

## Best Practices

1. **Start the canvas once** at the beginning of a session, then reuse it. Don't restart for each task.
2. **Use `--no-open`** when running as an agent — the human can open the browser URL themselves.
3. **Auto-arrange after adding multiple nodes** — call `/api/canvas/arrange` with an appropriate layout.
4. **Use meaningful titles** — keep titles short and scannable; put details in content.
5. **Use edge labels** — labels like "depends on", "calls", "reads from" make relationships clear.
6. **Use status nodes for live state** — update them with PATCH as work progresses.
7. **Use color semantically** — green for success/done, yellow for in-progress/warning, red for error/blocked.
8. **Clean up** — delete nodes that are no longer relevant to keep the canvas readable.
9. **Use the SSE stream** to react to user interactions (e.g., if they move or delete nodes in the browser).
10. **Prefer `tree` layout** for dependency graphs and `grid` for dashboards.
