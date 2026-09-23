---
name: json-render-mcp
description: Builds interactive json-render panels with PMX Canvas native tools or standalone MCP Apps. Use for stateful forms, repeated content, and AX actions in PMX Canvas, or MCP-hosted UIs in Claude, ChatGPT, Cursor, and VS Code.
---

# @json-render/mcp

MCP Apps integration that serves json-render UIs as interactive MCP Apps inside Claude, ChatGPT, Cursor, VS Code, and other MCP-capable clients.

In `pmx-canvas`, prefer the native `canvas_render { action: "add-json-render" }` and
`canvas_render { action: "add-graph" }` composite actions first. They store validated specs
directly in canvas node state and render them through the local `pmx-canvas` viewer route without
needing a separate sidecar server.

## PMX Canvas workflow (json-render 0.21)

1. Read `canvas://schema` (or use `canvas_render { action: "describe-schema" }`) for
   the installed component catalog. PMX includes shadcn components and its own charts;
   do not assume every component or action from an upstream example is registered.
2. Build a complete `{ root, elements, state }` spec. Validate with
   `canvas_render { action: "validate", type: "json-render", spec }`.
3. Create it with `canvas_render { action: "add-json-render", title, spec }`.
   For incremental generation, use `action: "stream-json-render"`, reuse the returned
   `nodeId` for subsequent patches, and set `done: true` on the final call.
4. Inspect the panel and exercise its inputs. Schema acceptance does not prove that
   an action reached the server or that a form edit was persisted.

### State, forms, and repeated content

- Put initial values in spec-level `state`, alongside `root` and `elements`. PMX seeds
  its viewer from this object; do not put `initialState` on a component.
- Use JSON Pointer paths: `value: { "$bindState": "/form/title" }` for `Input`,
  `Textarea`, or `Select`; `checked: { "$bindState": "/form/urgent" }` for `Checkbox`
  or `Switch`. Supply the catalog's required `label` and `name` props. `$state` reads
  a value only; `$bindState` also writes edits. `props.statePath` is not input binding.
- `repeat`, `watch`, `visible`, `on`, and `slots` are element fields, not props.
  `repeat: { "statePath": "/projects", "key": "id" }` repeats the container's children.
  Within those children, a nested container can use
  `repeat: { "statePath": { "$item": "tasks" }, "key": "id" }` to iterate the current
  project's tasks. Do not use `"/tasks"` (a root path) for that nested array.
  `$item` and `$index` refer to the innermost repeat; use
  `checked: { "$bindItem": "done" }` to edit that task's `done` field.
- Card body content uses `children: ["bodyId"]`. Named regions use
  `slots: { "header": ["headingId"], "footer": ["actionsId"] }`. Every referenced ID
  must exist in `elements`; do not put body content in `slots.default`. A header slot
  replaces the Card's title and description props; without it, those props work as before.
- Watchers skip mount: `watch: { "/form/title": { "action": "setState", "params":
  { "statePath": "/dirty", "value": true } } }` runs after the value changes, not to
  initialize `/dirty`. Seed initial and derived defaults explicitly. Avoid watchers
  that write back to their own watched paths and create loops.

### Actions and persistence boundaries

- Bind buttons with `on.press`, for example an action named `ax.work.create` or
  `ax.steer`, with its AX payload in `params`. PMX forwards only registered handlers;
  invented action names cannot execute arbitrary tools, shell commands, or requests.
  The server still validates the payload and the node's AX capabilities.
- AX handlers are **fire-and-forget** postMessages. Their `onSuccess` callbacks mean
  local dispatch completed, **not server acknowledgment**. Do not clear a draft or
  show “Saved” on that basis. Confirm via reflected AX state under reserved `/ax`
  (where applicable), or query the server's AX state/timeline. Do not use `/ax` for drafts.
- Built-in `validateForm` writes `{ valid, errors }` to `/formValidation` (or
  `params.statePath`) and returns without running `onSuccess`. Do not chain submission
  through that callback, or assume a following action in an array is validation-gated.
  Use an explicit validation step and state-based gating; server-side validation is
  still required for any submitted data.
- Form edits, `setState`, and `$bindItem` mutate **viewer-local state**, not the stored
  spec. Iframe reloads, including spec/stream updates, reset it from the latest spec's
  initial state. Finish streaming before collecting input; persist important changes
  through an explicit supported server interaction. Stored canvas nodes survive
  reloads, but unsent local drafts do not.

### Example: editable task draft

Pass this object to `canvas_render`. Editing either field sets a local dirty flag;
the button requests a real AX work item without pretending the request was saved.

```json
{
  "action": "add-json-render",
  "title": "Task draft",
  "spec": {
    "root": "card",
    "state": { "form": { "title": "Review release notes", "detail": "Check the upgrade caveats." }, "dirty": false },
    "elements": {
      "card": {
        "type": "Card",
        "props": { "title": "Task draft" },
        "children": ["fields"],
        "slots": { "footer": ["request"] }
      },
      "fields": {
        "type": "Stack",
        "props": { "direction": "vertical", "gap": "md" },
        "children": ["title", "detail"],
        "watch": {
          "/form/title": { "action": "setState", "params": { "statePath": "/dirty", "value": true } },
          "/form/detail": { "action": "setState", "params": { "statePath": "/dirty", "value": true } }
        }
      },
      "title": {
        "type": "Input",
        "props": { "label": "Title", "name": "title", "value": { "$bindState": "/form/title" } }
      },
      "detail": {
        "type": "Textarea",
        "props": { "label": "Details", "name": "detail", "value": { "$bindState": "/form/detail" } }
      },
      "request": {
        "type": "Button",
        "props": { "label": "Request task", "variant": "primary" },
        "on": {
          "press": {
            "action": "ax.work.create",
            "params": { "title": { "$state": "/form/title" }, "detail": { "$state": "/form/detail" } }
          }
        }
      }
    }
  }
}
```

The draft remains visible after dispatch. Verify that the work item appears in AX
state before reporting success. Repeated clicks can create duplicate work items.

## Standalone MCP App quick start

Use this path only when building a separate MCP Apps server rather than a native
PMX panel. PMX's `canvas_render` path needs none of the server, bundler, or client
configuration below.

### Server (Node.js)

```typescript
import { createMcpApp } from "@json-render/mcp";
import { defineCatalog } from "@json-render/core";
import { schema } from "@json-render/react/schema";
import { shadcnComponentDefinitions } from "@json-render/shadcn/catalog";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import fs from "node:fs";

const catalog = defineCatalog(schema, {
  components: { ...shadcnComponentDefinitions },
  actions: {},
});

const server = createMcpApp({
  name: "My App",
  version: "1.0.0",
  catalog,
  html: fs.readFileSync("dist/index.html", "utf-8"),
});

await server.connect(new StdioServerTransport());
```

### Client (React, inside iframe)

```tsx
import { useJsonRenderApp } from "@json-render/mcp/app";
import { JSONUIProvider, Renderer } from "@json-render/react";

function McpAppView({ registry }) {
  const { spec, loading, error } = useJsonRenderApp();
  if (error) return <div>Error: {error.message}</div>;
  if (!spec) return <div>Waiting...</div>;
  return (
    <JSONUIProvider registry={registry} initialState={spec.state ?? {}}>
      <Renderer spec={spec} registry={registry} loading={loading} />
    </JSONUIProvider>
  );
}
```

## Architecture

1. `createMcpApp()` creates an `McpServer` that registers a `render-ui` tool and a `ui://` HTML resource
2. The tool description includes the catalog prompt so the LLM knows how to generate valid specs
3. The HTML resource is a Vite-bundled single-file React app with json-render renderers
4. Inside the iframe, `useJsonRenderApp()` connects to the host via `postMessage` and renders specs

## Server API

- `createMcpApp(options)` - main entry, creates a full MCP server
- `registerJsonRenderTool(server, options)` - register a json-render tool on an existing server
- `registerJsonRenderResource(server, options)` - register the UI resource

## Client API (`@json-render/mcp/app`)

- `useJsonRenderApp(options?)` - React hook, returns `{ spec, loading, connected, error, callServerTool }`
- `buildAppHtml(options)` - generate HTML from bundled JS/CSS

## Building the iframe HTML

Bundle the React app into a single self-contained HTML file using Vite + `vite-plugin-singlefile`:

```typescript
// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig({
  plugins: [react(), viteSingleFile()],
  build: { outDir: "dist" },
});
```

## Client Configuration

### Cursor (`.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "my-app": {
      "command": "npx",
      "args": ["tsx", "server.ts", "--stdio"]
    }
  }
}
```

### Claude Desktop

```json
{
  "mcpServers": {
    "my-app": {
      "command": "npx",
      "args": ["tsx", "/path/to/server.ts", "--stdio"]
    }
  }
}
```

## Dependencies

```bash
# Server
npm install @json-render/mcp @json-render/core @modelcontextprotocol/sdk

# Client (iframe)
npm install @json-render/react @json-render/shadcn react react-dom

# Build tools
npm install -D vite @vitejs/plugin-react vite-plugin-singlefile
```
