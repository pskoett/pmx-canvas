---
id: eval-20260424-001
pattern-key: pmx-canvas.cli-e2e-fresh-workspace
source: pmx-canvas-0.1.2-e2e-cli-coverage-report
promoted-rule: "Fresh-workspace CLI coverage must verify node creation, parseable JSON, web-artifact failure behavior, external apps, arrange/validate, and focus no-pan before release."
promoted-to: package.json test:e2e-cli
created: 2026-04-24
last-run: 2026-04-25
last-result: pass
---

# PMX Canvas CLI E2E Coverage Eval

## What This Tests

Prevents regressions in the published-agent CLI flows that caused the 0.1.2 E2E report failures.

## Precondition

- Bun is installed.
- The repo has been built with `bun run build` when client/browser assets changed.
- Network is available for the hosted Excalidraw MCP preset and web-artifact dependency install.
- Port `4567` is free, or `PMX_CANVAS_E2E_PORT` is set to a free port.

## Verification Method

Command check:

```bash
bun run test:e2e-cli
```

The command runs `scripts/e2e-cli-coverage.sh`, which creates a fresh temp workspace, starts the local PMX Canvas CLI server, and verifies:

- `layout` and `node list` emit JSON parseable by Python's `json` module.
- Core node types can be created through the CLI, including two webpage input paths.
- Graph nodes accept `--data` as an alias for `--data-json`.
- All graph variants create successfully: line, bar, pie, area, scatter, radar, stacked-bar, composed.
- Simple and dashboard-shaped json-render specs create successfully.
- Generic `node add --type mcp-app` is rejected with guidance.
- `external-app add --kind excalidraw` creates a tool-backed app node.
- Broken web-artifact builds return `ok: false`, exit non-zero, and do not create a node.
- One successful web-artifact build emits a substantial bundled React/Recharts app, opens a node, and browser-verifies the real app content renders in the iframe.
- `focus --no-pan` selects without viewport panning.
- `arrange --layout grid` and `validate` agree on a valid layout.
- Search can find artifact nodes and `status` reports expected graph/json-render/web-artifact counts.

## Expected Result

**Pass:** `PMX Canvas CLI E2E coverage passed` and exit code 0.

**Fail:** Any command exits non-zero, JSON parsing fails, an assertion fails, or the server does not become healthy.

## Recovery Action

If this eval fails:

1. Re-run with `PMX_CANVAS_E2E_KEEP_WORKDIR=1 bun run test:e2e-cli` to preserve the temp workspace.
2. Inspect the preserved `.pmx-canvas/` state and `pmx-canvas.log` printed by the script.
3. Fix the failing CLI/server path and add or update the narrower unit regression.
4. Re-run `bun run test:e2e-cli`, then `bun run test:all` before release.
