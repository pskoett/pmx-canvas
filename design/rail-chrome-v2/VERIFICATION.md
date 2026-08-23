# Rail + Session Chrome (v2) — Live verification

Date: 2026-08-23. Board: a fresh scratch DB served by `bun run src/cli/index.ts --no-open`
(port 4777). **Agent side** drove the real MCP stdio server (`bun run src/mcp/server.ts`,
`PMX_CANVAS_AGENT_SOURCE=claude-code`) through `@modelcontextprotocol/sdk`'s client; **human
side** drove a headed Chromium (Playwright) — two tabs for the presence checks. Script:
`verify-live.ts` (session scratchpad; 36 checks, every step asserts on the tool result AND the
rendered board). All 36 pass after one fix it found (below).

| # | Surface (design item) | Agent side | Human side | Result |
|---|---|---|---|---|
| 1 | Quiet board / empty state (11) | — | empty state, no agent chrome | pass |
| 2 | External steering (1, 9, 17) | 3 MCP writes, no session | indicator `claude-code · 3 ops`, feed rows with summaries, writers sheet names the writer | pass |
| 3 | Context pins | reads `canvas://pinned-context` | pins two nodes from the cards | pass |
| 4 | Session attach (2, 5a) | `set-presence attached:true, phase:thinking` | panel + command bar mount, indicator retires, chip "Thinking", pins as chips, pre-session snapshot exists | pass |
| 5 | Ghost intent + attribution (phase 3) | `canvas_intent signal` → `canvas_node add` with `intentId` | ghost with label, cursor parks on the new node, `focusNodeId` = that node | pass (after fix) |
| 6 | Work items + gates (3) | `canvas_ax_work add` ×2, `canvas_ax_gate approval request` ×2 | items in the panel with status, status chip on the node, gate with countdown + top-bar badge, chip "Waiting on you"; **Approve** resolves the gate the agent awaits; a 1 s gate auto-holds and shows **Reopen** | pass |
| 7 | Command bar steering (5a) | `canvas_ax_delivery claim` | types in the composer, Enter | claim returns the message | pass |
| 8 | Scope fence (4) | write outside → MCP error 403; inside lands; cannot clear the fence | **Fence to selection**, fence drawn, **Clear** | pass |
| 9 | Shared undo (10) | rewrites a title, later claims steering | **↩ undo this edit** on the Update row | edit reverted, "Undid your edit" steering claimed | pass |
| 10 | User wins (6) | `edit` intent on a node, then a write while the human holds it → 409 | drags that node: yield pill, intent vetoed | after release the write lands | pass |
| 11 | Groups v2 (20) | reads membership in `/api/canvas/state` | shift-click two nodes, **G**, collapse → chip hides children, expand | pass |
| 12 | Edge creation (15) | reads the labelled edge | Connect tool drag, **L**, label prompt | pass |
| 13 | Palette (7) / minimap (19) | — | ⌘K groups Actions then Jump to; one minimap rect per node | pass |
| 14 | Detach → receipt → History (2, 8) | `set-presence attached:false` | receipt `2 / 1 / 1`, View diff, Full log → drawer lists the session entry; board quiet again | pass |
| 15 | Human presence (5) | — | second tab sees `mia`'s cursor by name | pass |

Not exercised live (covered by unit/e2e): reconnect/resync banner (14), keyboard traversal +
focus traps (18), the external-steering inline Veto, restored-gate TTL refresh, the SDK fence.

## What the live run found

- **Split identity on attach (fixed, `da71bad`).** `ax.presence.set` normalized `source`
  through the AX source enum, so the MCP server's `claude-code` attach landed as `api` while its
  writes carried `claude-code`: no cursor movement, all activity under an "external writer".
  Every existing test had attached with an enum label. Regression test attaches with a non-enum
  label; learning LRN-20260823-004.
- **Timeline duplication (fixed, this commit).** Agent `ax.event.record` / `ax.evidence.add` /
  `ax.steer` writes appeared both as their own timeline rows and as generic "Update" rows; they
  are now excluded from the activity feed.
- Two wrong tool-call shapes in the verification script itself (`canvas_ax_gate` needs `kind`,
  `canvas_ax_work` uses `add`) — the documented shapes were right; the script now fails a step
  on `isError` so a silent error can never read as a pass again.

## How to re-run

```bash
bun run design/rail-chrome-v2/verify-live.ts   # screenshots + scratch DB → $PMX_VERIFY_OUT (default /tmp/pmx-canvas-verify)
```

The script lives beside this file and is kept out of the repo's test suites on purpose: it launches a headed browser and
a real MCP process and takes ~90 s. Its steps are the table above; `tests/e2e/canvas.pw.ts`
holds the headless, per-feature versions.
