# HTTP API reference

REST endpoints for all canvas operations + an SSE event stream. Works from
any language. Default base URL: `http://localhost:4313`.

## Canvas state

```bash
# Get canvas state
curl http://localhost:4313/api/canvas/state

# Search nodes
curl "http://localhost:4313/api/canvas/search?q=auth"

# Validate the current layout
curl http://localhost:4313/api/canvas/validate

# Inspect running-server schemas
curl http://localhost:4313/api/canvas/schema

# Validate a json-render spec without creating a node
curl -X POST http://localhost:4313/api/canvas/schema/validate \
  -H "Content-Type: application/json" \
  -d '{"type":"json-render","spec":{"root":"card","elements":{"card":{"type":"Card","props":{"title":"Preview"},"children":[]}}}}'

# Validate an HTML primitive without creating a node
curl -X POST http://localhost:4313/api/canvas/schema/validate \
  -H "Content-Type: application/json" \
  -d '{"type":"html-primitive","kind":"choice-grid","data":{"items":[{"title":"A"}]}}'
```

## Nodes

```bash
# Add a node
curl -X POST http://localhost:4313/api/canvas/node \
  -H "Content-Type: application/json" \
  -d '{"type":"markdown","title":"Hello","content":"# World"}'

# Add an html node (sandboxed iframe)
curl -X POST http://localhost:4313/api/canvas/node \
  -H "Content-Type: application/json" \
  -d '{"type":"html","title":"Chart","summary":"Cost projection chart for the Q2 plan.","html":"<canvas id=\"c\"></canvas><script src=\"https://cdn.jsdelivr.net/npm/chart.js\"></script><script>/* ... */</script>"}'

# Add a generated HTML primitive as a sandboxed html node
curl -X POST http://localhost:4313/api/canvas/node \
  -H "Content-Type: application/json" \
  -d '{"type":"html-primitive","kind":"choice-grid","title":"Options","data":{"items":[{"title":"Small patch","summary":"Least disruption."}]}}'

# Opt an html node into AX. Top-level `html` AND `axCapabilities` are accepted on
# POST add and PATCH update (and may also be nested under `data`).
curl -X POST http://localhost:4313/api/canvas/node \
  -H "Content-Type: application/json" \
  -d '{"type":"html","title":"AX board","html":"<p>steering board</p>","axCapabilities":{"enabled":true,"allowed":["ax.steer"]}}'
```

A node creation request must resolve a `type` — pass it in the body (`{ "type":
... }`) or as a `?type=` query param. An empty / type-less body returns `400`
rather than silently creating a markdown node.

## Edges

```bash
# Add an edge
curl -X POST http://localhost:4313/api/canvas/edge \
  -H "Content-Type: application/json" \
  -d '{"from":"node-1","to":"node-2","type":"flow","label":"next"}'

# Add an edge by unique search match instead of explicit IDs
curl -X POST http://localhost:4313/api/canvas/edge \
  -H "Content-Type: application/json" \
  -d '{"fromSearch":"DVT O3 — GitOps","toSearch":"deep work trend","type":"relation"}'
```

Search-based edge creation is intentionally strict: `fromSearch` and
`toSearch` must each resolve to exactly one node. Broad queries that match
multiple nodes fail; use the full visible title.

## Annotations

```bash
# Add a freehand annotation. The default/currentColor stroke follows the active theme.
curl -X POST http://localhost:4313/api/canvas/annotation \
  -H "Content-Type: application/json" \
  -d '{"points":[{"x":100,"y":120},{"x":220,"y":120}],"color":"currentColor","width":4}'

# Remove an annotation
curl -X DELETE http://localhost:4313/api/canvas/annotation/ann-123
```

Agent-readable context reports annotation IDs, targets, and bounds. Use WebView
inspection or screenshots when the drawn shape matters.

## Pins

```bash
# Pin nodes for agent context
curl -X POST http://localhost:4313/api/canvas/context-pins \
  -H "Content-Type: application/json" \
  -d '{"nodeIds":["node-1","node-2"]}'

# Get pinned context
curl http://localhost:4313/api/canvas/pinned-context
```

## AX context and focus

AX context is the host-agnostic agent-experience layer. It combines existing
context pins with a persisted focus node set that adapters can inject into
their native prompt/context hooks.

```bash
# Get persisted AX state
curl http://localhost:4313/api/canvas/ax

# Get agent-readable pinned + focused context
curl http://localhost:4313/api/canvas/ax/context

# Set AX focus
curl -X POST http://localhost:4313/api/canvas/ax/focus \
  -H "Content-Type: application/json" \
  -d '{"nodeIds":["node-1"],"source":"api"}'

# Patch AX focus through the state endpoint
curl -X PATCH http://localhost:4313/api/canvas/ax \
  -H "Content-Type: application/json" \
  -d '{"focus":{"nodeIds":["node-1"],"source":"api"}}'
```

## AX primitives (timeline, work, host)

Host-agnostic agent-experience primitives across three state partitions.
Canvas-bound state (work items, approval gates, review annotations) rides
canvas snapshots; timeline state (events, evidence, steering) persists for
diagnostics but is retention-bounded and not restored by snapshots; the host
capability is reported by adapters and survives `canvas_clear`.

```bash
# Timeline — record a normalized agent-event
curl -X POST http://localhost:4313/api/canvas/ax/event \
  -H "Content-Type: application/json" \
  -d '{"kind":"tool-start","summary":"ran tests","source":"api"}'

# Timeline — send a steering message to the active agent session
curl -X POST http://localhost:4313/api/canvas/ax/steer \
  -H "Content-Type: application/json" \
  -d '{"message":"focus on the failing test first","source":"api"}'

# Timeline — record an evidence item (logs/tool-result/screenshot/file/diff/test-output)
curl -X POST http://localhost:4313/api/canvas/ax/evidence \
  -H "Content-Type: application/json" \
  -d '{"kind":"test-output","title":"unit pass","source":"api"}'

# Timeline — read the bounded timeline (default limit 50, max 200)
curl "http://localhost:4313/api/canvas/ax/timeline?limit=50"

# Canvas-bound — add / update a work item
curl -X POST http://localhost:4313/api/canvas/ax/work \
  -H "Content-Type: application/json" \
  -d '{"title":"Wire up auth","status":"in-progress","nodeIds":["node-1"],"source":"api"}'
curl -X PATCH http://localhost:4313/api/canvas/ax/work/<id> \
  -H "Content-Type: application/json" \
  -d '{"status":"done"}'
curl http://localhost:4313/api/canvas/ax/work

# Canvas-bound — request / resolve an approval gate (pending → approved/rejected)
curl -X POST http://localhost:4313/api/canvas/ax/approval \
  -H "Content-Type: application/json" \
  -d '{"title":"Deploy to prod","action":"deploy.prod","source":"api"}'
curl -X POST http://localhost:4313/api/canvas/ax/approval/<id>/resolve \
  -H "Content-Type: application/json" \
  -d '{"decision":"approved","source":"api"}'
curl http://localhost:4313/api/canvas/ax/approval

# Canvas-bound — add a review annotation (comment/finding) anchored to node/file/region
curl -X POST http://localhost:4313/api/canvas/ax/review \
  -H "Content-Type: application/json" \
  -d '{"body":"off-by-one","kind":"finding","severity":"error","anchorType":"file","file":"src/x.ts","source":"api"}'
curl http://localhost:4313/api/canvas/ax/review

# Host/session — report and read host capability
curl -X PUT http://localhost:4313/api/canvas/ax/host-capability \
  -H "Content-Type: application/json" \
  -d '{"host":"copilot","canvas":true,"sessionMessaging":true,"source":"api"}'
curl http://localhost:4313/api/canvas/ax/host-capability
```

Validation: `/ax/event` requires a valid `kind` + `summary` (400 otherwise);
`/ax/evidence` requires `kind` + `title`; `/ax/steer`, `/ax/work`,
`/ax/approval`, `/ax/review` require their primary field; `POST`/`PATCH /ax/work`
reject an unknown `status` with 400 (the tokens are `todo`, `in-progress`,
`blocked`, `done`, `cancelled` — hyphens, not underscores); `PATCH /ax/work/:id`
and `PATCH /ax/review/:id` return 404 for unknown IDs; approval resolve returns
404 if the gate is missing or already resolved.

## AX interactions, delivery, elicitation, mode, commands & policy

Node interactions are one normalized, capability-gated envelope that maps onto an
AX operation. The server re-validates every interaction against the source node's
effective capabilities and clamps sandboxed surfaces (`html-node`, `mcp-app`,
`json-render`) to their own node.

```bash
# Node interaction — one envelope, validated + mapped to the matching AX op
curl -X POST http://localhost:4313/api/canvas/ax/interaction \
  -H "Content-Type: application/json" \
  -d '{"type":"ax.work.create","sourceNodeId":"node-1","payload":{"title":"Wire auth"}}'

# Delivery — claim pending steering for a consumer (loop-safe), then mark delivered
curl "http://localhost:4313/api/canvas/ax/delivery/pending?consumer=copilot&limit=20"
curl -X POST http://localhost:4313/api/canvas/ax/delivery/<steering-id>/mark \
  -H "Content-Type: application/json" \
  -d '{"consumer":"copilot"}'

# Elicitation — request structured human input, then respond
curl -X POST http://localhost:4313/api/canvas/ax/elicitation \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Who owns this migration?","fields":["owner"],"source":"api"}'
curl -X POST http://localhost:4313/api/canvas/ax/elicitation/<id>/respond \
  -H "Content-Type: application/json" \
  -d '{"response":{"owner":"alice"}}'
curl http://localhost:4313/api/canvas/ax/elicitation

# Mode — request a plan/execute/autonomous transition, then resolve
curl -X POST http://localhost:4313/api/canvas/ax/mode \
  -H "Content-Type: application/json" \
  -d '{"mode":"plan","reason":"scope the change first","source":"api"}'
curl -X POST http://localhost:4313/api/canvas/ax/mode/<id>/resolve \
  -H "Content-Type: application/json" \
  -d '{"decision":"approved"}'
curl http://localhost:4313/api/canvas/ax/mode

# Activity ingestion — forward an agent tool/session event; the board auto-reacts
# (kind-driven, overridable: failure → work item + review + evidence; tool-result
# + outcome:"success" → evidence). Set a reaction to false to suppress it.
curl -X POST http://localhost:4313/api/canvas/ax/activity \
  -H "Content-Type: application/json" \
  -d '{"kind":"failure","title":"tsc failed","summary":"type error in x.ts","nodeIds":["node-1"],"source":"api"}'

# Blocking gate read — read one gate, or long-poll with ?waitMs until the human
# resolves it in the browser (gates that actually gate). Returns { <primitive>, pending }.
curl "http://localhost:4313/api/canvas/ax/approval/<id>"                 # immediate read
curl "http://localhost:4313/api/canvas/ax/approval/<id>?waitMs=30000"    # blocks ≤30s / until resolved
curl "http://localhost:4313/api/canvas/ax/elicitation/<id>?waitMs=30000"
curl "http://localhost:4313/api/canvas/ax/mode/<id>?waitMs=30000"

# Context — optional ?consumer= filters the compact, loop-safe `delivery` lead block
# (undelivered steering + open work/approvals it can act on) for per-turn injection.
# `delivery.pendingSteering` is NEWEST-first (most recent first), capped at 10, so a
# fresh steer is visible even behind a backlog; `delivery.totalPending` /
# `delivery.omittedPending` report how many more are queued. Drain the full FIFO
# (oldest-first) backlog via /api/canvas/ax/delivery/pending when omittedPending > 0.
curl "http://localhost:4313/api/canvas/ax/context?consumer=copilot"

# Commands — list the registry, invoke a command (records a `command` agent-event)
curl http://localhost:4313/api/canvas/ax/command
curl -X POST http://localhost:4313/api/canvas/ax/command \
  -H "Content-Type: application/json" \
  -d '{"name":"pmx.plan","args":{"note":"draft a plan"},"source":"api"}'

# Policy — read / patch the canvas-bound tool/prompt policy (patches merge)
curl http://localhost:4313/api/canvas/ax/policy
curl -X POST http://localhost:4313/api/canvas/ax/policy \
  -H "Content-Type: application/json" \
  -d '{"tools":{"excluded":["shell"]},"prompt":{"mode":"concise"},"source":"api"}'
```

Validation: `/ax/interaction` returns `{ ok: false, code }` (403 `ax-disabled` /
`not-allowed`, 400 `invalid-payload` / `unknown-command`, 404 `unknown-node`);
`/ax/command` rejects an unknown command name with 400; `/ax/elicitation/:id/respond`
and `/ax/mode/:id/resolve` return 404 for unknown IDs; `/ax/activity` requires a
valid `kind` + `title` (400 otherwise); the single-item gate GETs return 404 for
unknown IDs and clamp `?waitMs` to ≤120000.

## Diagrams (Excalidraw preset)

```bash
curl -X POST http://localhost:4313/api/canvas/diagram \
  -H "Content-Type: application/json" \
  -d '{"elements":[{"type":"rectangle","id":"r1","x":60,"y":60,"width":180,"height":80,"roundness":{"type":3},"backgroundColor":"#a5d8ff","fillStyle":"solid","label":{"text":"Hello","fontSize":18}}],"title":"Diagram"}'
```

## SSE event stream

```bash
curl -N http://localhost:4313/api/workbench/events
```

The browser, the CLI `watch` command, and the MCP resource notifications
all consume this stream. Auto-reconnect with exponential backoff.

## Time travel

```bash
curl -X POST http://localhost:4313/api/canvas/undo
curl -X POST http://localhost:4313/api/canvas/redo
curl http://localhost:4313/api/canvas/history
```

## WebView automation

```bash
# Start WebView automation
curl -X POST http://localhost:4313/api/workbench/webview/start \
  -H "Content-Type: application/json" \
  -d '{"backend":"chrome","width":1280,"height":800}'

# Evaluate JS in the active WebView session
curl -X POST http://localhost:4313/api/workbench/webview/evaluate \
  -H "Content-Type: application/json" \
  -d '{"expression":"document.title"}'

# Resize the active WebView session
curl -X POST http://localhost:4313/api/workbench/webview/resize \
  -H "Content-Type: application/json" \
  -d '{"width":1440,"height":900}'

# Capture a screenshot
curl -X POST http://localhost:4313/api/workbench/webview/screenshot \
  -H "Content-Type: application/json" \
  -d '{"format":"png"}' \
  --output canvas.png
```

## Batch operations

Build a canvas in one shot. Earlier results can be referenced from later
operations via `$assigned-name.field`.

```bash
curl -X POST http://localhost:4313/api/canvas/batch \
  -H "Content-Type: application/json" \
  -d '{"operations":[{"op":"node.add","assign":"a","args":{"type":"markdown","title":"A"}},{"op":"group.create","args":{"title":"Frame","childIds":["$a.id"]}}]}'
```

Supported operations:

- `node.add`, `node.update`
- `graph.add`
- `edge.add`
- `group.create`, `group.add`, `group.remove`
- `pin.set`, `pin.add`, `pin.remove`
- `snapshot.save`
- `arrange`

`node.add` supports `type: "webpage"` inside batch. The batch itself still
succeeds when the webpage node is created but the fetch fails; the
per-operation result includes `fetch: { ok, error? }` plus a top-level
`error` field for the fetch problem.

Example with assignments:

```json
{
  "operations": [
    {
      "op": "graph.add",
      "assign": "wins",
      "args": {
        "title": "Major wins",
        "graphType": "bar",
        "data": [
          { "label": "Docs", "value": 5 },
          { "label": "Tests", "value": 8 }
        ],
        "xKey": "label",
        "yKey": "value"
      }
    },
    {
      "op": "group.create",
      "assign": "frame",
      "args": {
        "title": "Quarterly graphs",
        "childIds": ["$wins.id"]
      }
    }
  ]
}
```
