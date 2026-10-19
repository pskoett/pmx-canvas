# PMX Canvas — Project Instructions

Standalone spatial canvas workbench for coding agents. Infinite 2D canvas with nodes, edges, pan/zoom, minimap, and real-time updates — controlled through MCP, HTTP API, or a Bun-based JavaScript/TypeScript SDK. Extracted from [PMX](https://github.com/pskoett/pmx).

The canvas is the agent's extended working memory: humans pin nodes to curate context, agents read that curation via MCP resources.

Provide concise, focused responses. Skip non-essential context, and keep examples minimal.

## Core Principles

### 1. Think Before Coding
Don't assume. Don't hide confusion. Surface tradeoffs.

- **State assumptions explicitly** — If uncertain, ask rather than guess
- **Present multiple interpretations** — Don't pick silently when ambiguity exists
- **Push back when warranted** — If a simpler approach exists, say so
- **Stop when confused** — Name what's unclear and ask for clarification
- **Attack the premise.** If two fixes based on the same assumption fail the same check, write down that assumption and test it directly before trying another fix. Use the smallest experiment that can disprove it; this is not permission for an unrelated redesign.
- **Redesign from first principles.** When a new requirement exposes a mismatch in the existing design, consider how you would model it if that requirement had existed from the start. Prefer that design within the affected scope, without rewriting unrelated code.

### 2. Simplicity First
Minimum code that solves the problem. Nothing speculative.

- No features beyond what was asked
- No abstractions for single-use code
- No "flexibility" or "configurability" that wasn't requested
- No error handling for impossible scenarios
- If 200 lines could be 50, rewrite it
- **No backwards compatibility.** This project does not code for backwards
  compatibility: no legacy shims, deprecation aliases, dual code paths, or
  migration scaffolding for old clients/configs. When a behavior changes,
  change it cleanly and update everything that depends on it.

The test: Would a senior engineer say this is overcomplicated? If yes, simplify.

### 3. Surgical Changes
Touch only what you must. Clean up only your own mess.

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting
- Don't refactor things that aren't broken
- Match existing style, even if you'd do it differently
- If you notice unrelated dead code, mention it — don't delete it

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused
- Don't remove pre-existing dead code unless asked

The test: Every changed line should trace directly to the user's request.

### 4. Goal-Driven Execution
Define success criteria. Loop until verified.

Transform imperative tasks into verifiable goals:

| Instead of... | Transform to... |
|---------------|-----------------|
| "Add validation" | "Write tests for invalid inputs, then make them pass" |
| "Fix the bug" | "Write a test that reproduces it, then make it pass" |
| "Refactor X" | "Ensure tests pass before and after" |

For multi-step tasks, state a brief plan:
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]

Strong success criteria let the agent loop independently. Weak criteria ("make it work") require constant clarification.

### 5. Learn and Improve
Every mistake is a learning opportunity. Log it, learn from it, prevent it.

- After ANY correction from the user: log the lesson
- Prefer encoding recurring lessons in types, lint rules, boundary checks, or regression tests over adding more prose. Use the smallest mechanism that catches the actual failure; do not add speculative guards.
- Log to `.learnings/ERRORS.md`, `LEARNINGS.md`, or `FEATURE_REQUESTS.md`
- Promote broadly applicable learnings to `CLAUDE.md` and `AGENTS.md` when automated enforcement cannot capture them; avoid duplicating what a check already enforces.

### 6. Design for Retries and Concurrent Writers
Apply this when the operation being changed can be retried, interrupted, or run concurrently.

- **Make retries idempotent.** Retrying the same logical operation should converge on the intended state without duplicating side effects. Where repetition is intentional, distinguish a new operation from a retry. Verify interruption and retry at the relevant failure boundary.
- **Separate before serializing.** Before adding a lock or queue, check whether writers can own separate files, keys, or state. Preserve genuinely shared state and its existing owner, including `CanvasStateManager`; serialize through that owner when separation would violate the domain.
- Keep these changes within the requested operation. Do not introduce a general retry framework or repartition unrelated state.

### 7. Explain Measured Numbers
Before reporting or acting on a performance or evaluation result:

- State what was measured, the baseline, workload, and conditions. Compare equivalent work and verify that outputs remain correct.
- Identify what limits the result and check for confounders such as caching, warm-up, skipped work, or measurement overhead. Repeat enough to distinguish a real change from noise.
- Keep a reproducible command or script. Report uncertainty and separate measured results from explanations that remain hypotheses; do not claim a speedup from a proxy that misses the user's workload.

## TypeScript Guardrails

1. **Do not introduce dynamic imports by default**: Do not add `await import(...)` or similar dynamic-loading patterns unless the user explicitly asks for them or the existing architecture requires them.
2. **Do not use `any` casts or annotations**: Avoid `as any`, `: any`, `Promise<any>`, or equivalent escape hatches. Model the real type instead.
3. **Do not add defensive noise by default**: Do not add extra defensive checks or broad `try/catch` blocks unless they are necessary for a specific runtime boundary, recovery path, or user-requested behavior.

## Workflow Orchestration

### 1. Plan Mode Default
- Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions)
- If something goes sideways, STOP and re-plan immediately — don't keep pushing
- Write detailed specs upfront to reduce ambiguity

### 2. Subagent Strategy
- Use subagents liberally to keep main context window clean
- Offload research, exploration, and parallel analysis to subagents
- For complex problems, throw more compute at it via subagents
- One task per subagent for focused execution

### 3. Autonomous Bug Fixing
- When given a bug report: just fix it. Don't ask for hand-holding
- Point at logs, errors, failing tests — then resolve them
- Zero context switching required from the user

## Canvas Architecture Rules

1. **State lives in the server.** `CanvasStateManager` in `canvas-state.ts` is the singleton source of truth. All mutations go through it. The browser is a renderer. State survives browser refresh.

2. **SSE-created nodes must sync to server-side canvasState.** When `emitPrimaryWorkbenchEvent` creates nodes on the client via SSE (`workbench-open`, `ext-app-open`), also create them in the server-side `canvasState` singleton. Otherwise `canvas_query { action: "layout" }` returns 0 nodes and `canvas-layout-update` reconciliation deletes client-only nodes.

3. **Rebuild canvas bundle after client source changes.** After modifying any file under `src/client/`, run `bun run build` before testing in the browser. The dist bundle is not auto-built; stale bundles silently hide new features. **An already-open tab used to keep old JS through every dev rebuild** — `reloadIfServerUpgraded` compared the package *version* only, which a rebuild+restart never bumps; an entire debugging arc (2026-08-24) chased "still broken" reports that were a stale tab faithfully reproducing already-fixed bugs. The `connected` frame now carries a served-bundle stamp and a mismatched tab reloads itself on (re)connect — but tabs opened before the stamp shipped, and any surface you cannot force-navigate, still need one manual hard reload. Before believing a UI bug report (yours or the user's), first establish WHICH bundle the reporting surface is actually running.

4. **Canvas edits happen in place.** The web canvas is a live multi-node workspace. Flows should update the current session without evicting prior nodes (including prior document nodes). Agents must not describe the canvas as requiring reopen/replace for additional documents.

5. **MCP tools map 1:1 to PmxCanvas methods.** When adding a new canvas operation, add it to: (a) `CanvasStateManager`, (b) `PmxCanvas` class in `src/server/index.ts`, (c) HTTP endpoint in `src/server/server.ts`, (d) MCP tool in `src/mcp/server.ts`. All four layers must stay in sync.

6. **Context pins are the bridge between human and agent.** The human pins nodes in the browser, the agent reads `canvas://pinned-context`. This is the primary communication channel from human spatial curation to agent context. Preserve this flow.

7. **No HTTP server port assumptions.** Default port is 4313 but can be changed via `--port` or `PMX_WEB_CANVAS_PORT` for server startup; when both are unset the server also falls back to `PMX_CANVAS_PORT` (0.4.0), so one variable can point the client and server at the same port. Amp orbs: the portal-assigned `PORT` env is honored after those (only when `AMP_ORB` is set), so an orb service command needs no port flag. `PMX_CANVAS_PORT` otherwise remains the agent CLI's client-side default target port. The server tries fallback ports if the preferred one is taken. **`PMX_CANVAS_WORKSPACE_ROOT`** pins the workspace root for both the MCP same-workspace lookup and the daemon `startCanvasServer` binds, overriding the launch `cwd` — set it when a host spawns `--mcp` from an incidental dir (e.g. `~/.copilot`) so the canvas targets the real project. When the preferred port is held by a *different*-workspace daemon, the MCP server now attaches to it (inherits its workspace) instead of silently splitting to a fallback port; use `PMX_CANVAS_ALLOW_WORKSPACE_SPLIT=1` to force a separate canvas.

8. **Mutation listeners are single-slot.** `canvasState.onMutation` and
   `setWorkItemsChangedListener` hold exactly ONE callback each — registering a second consumer
   silently displaces the first. `server.ts` claims `onMutation` whenever a server starts, so
   whether a side effect fires depends on whether anything booted a server first. Fan out inside
   the existing registration; never add a competing one.

9. **The viewport is a SCREEN-space translate, not a world-space camera.** The canvas renders
   `matrix(scale, 0, 0, scale, x, y)`, so `screen = world * scale + viewport`. To put a node at a
   fixed screen margin, compute `margin - node.position * scale` — what `fitCanvasView` and the
   client's `focusNode` do. Writing `node.position - margin / scale` mixes conventions and lands
   the node off-screen at any scale ≠ 1 (it shipped twice: `view.focus` in 0.4.6, and `fit`'s
   world-space padding, which collapses under floating chrome at fit zoom). Margins that must
   clear overlays are screen-space constants. Since the rail-chrome restructure the canvas region
   itself excludes the rail/top bar — screen-space math anchors on `canvasArea()`
   (`src/client/canvas/canvas-area.ts`), never `window.innerWidth`.

10. **json-render / graph viewers read their spec once, at document load.** The iframe `src` is
    keyed on `nodeId + ?v=specVersion`, so any content update MUST bump `specVersion`
    (`buildJsonRenderNodeUpdate` does). Skip it and the URL is byte-identical, the iframe never
    reloads, and the node renders stale forever while the server data is correct — the live
    workboard shipped that way in 0.4.6.

## Tech Stack

- **Runtime:** Bun (build + serve)
- **UI:** Preact + @preact/signals
- **Styling:** CSS custom properties for the main canvas UI, plus a Tailwind CLI build for the json-render viewer bundle
- **Server:** Bun.serve (HTTP + SSE)
- **MCP:** @modelcontextprotocol/sdk (stdio transport)
- **Bundler:** Bun bundler for client SPA
- **Dependencies:** `preact`, `@preact/signals`, `marked`, `@modelcontextprotocol/sdk`, `@modelcontextprotocol/ext-apps`, `zod`

## Build & Run

```bash
bun install                    # Install dependencies
bun run build                  # Build client SPA → dist/canvas/
bun run dev                    # Start server + open browser
bun run dev:demo               # Start with the showcase demo board
bun run start                  # Start headless (no browser)
pmx-canvas serve --daemon      # Start daemonized server with pid/log tracking
pmx-canvas serve status        # Check daemon health + pid state
pmx-canvas serve stop          # Stop daemonized server
pmx-canvas --mcp               # Run as MCP server
pmx-canvas --theme=daylight    # Start with the Daylight theme
bun run lint                   # Biome lint + format check (lint:fix to write)
```

## Persistence

All generated files live under `.pmx-canvas/` in the workspace root:

```
.pmx-canvas/
  canvas.db            # SQLite: every board, snapshots, context pins, and blobs — git-committable
  backups/             # `pmx-canvas backup` copies (canvas-<timestamp>.db), newest N kept
  exports/             # `pmx-canvas export` static board files (<board>-<timestamp>.html)
  artifacts/           # web-artifact HTML bundles
    .web-artifacts/    # reusable per-artifact build projects
  daemon-<port>.log    # daemon stdout/stderr (when started with `serve --daemon`)
  daemon-<port>.pid    # daemon pid file
```

State auto-saves every mutation (debounced 500ms) and auto-loads on server start. Pre-0.2 legacy layouts (`.pmx-canvas/state.json`, `.pmx-canvas.json`, snapshot dirs, blob files) are no longer imported as of 0.4.0 — restore them with a 0.3.x install first if needed.

- Override DB path: `PMX_CANVAS_DB_PATH` env var
- `PMX_CANVAS_STATE_FILE` remains only as a `.db`-path alias (non-`.db` values are ignored with a boot warning as of 0.4.0)
- `--demo` only seeds when canvas is empty (won't clobber restored state)
- State saves: viewport, nodes, edges, annotations, context pins, snapshots, and large node blobs
- Stop the server or flush/close the SDK before committing `canvas.db`; shutdown checkpoints SQLite WAL data into the DB file.

## Demo Board

`src/server/demo-state.json` is a **generated fixture — never hand-edit it.** Rebuild it with:

```bash
bun run scripts/generate-demo-board.ts
```

The generator builds the board through the real HTTP API, then rewrites live ids and timestamps
to stable ones so the output is byte-deterministic (run it twice, get the same file). Anything it
creates must go through the API — that is what keeps the fixture honest about what the product
actually produces.

The fixture embeds each HTML primitive's generated markup plus the canvas-bound AX partition, so
it goes stale the moment a renderer, primitive, or node type changes — silently, because counts
and coverage assertions are just as happy with month-old markup. `tests/unit/demo.test.ts` guards
this by rebuilding every primitive from the stored `primitiveData` and byte-comparing against the
current renderer. Regenerate and re-run that test after touching any of the above.

## Design

The design guide is [`docs/design.md`](docs/design.md); the drawings it refers to are the
artboard sources in [`docs/design/`](docs/design/) (`*.dc.html`, layout in `canvas.json`). Read
both before changing anything a person sees: styles under `src/client/theme/`, chrome, node
renderers, Home, edges.

1. **Build to the drawing, not the prose.** Find the surface's artboard in the table in
   `docs/design.md` and take sizes, colours, spacing and copy from its source; values computed in
   its `renderVals()` script are part of the drawing. If no artboard covers the surface, draw it
   (or ask) before building; do not invent a look.
2. **Ship with the wave.** `docs/design.md` pairs each design area with a vision move in numbered
   waves. Design ships with the function that produces its data: do not restyle a surface ahead of
   its wave, and do not ship a wave's function with the old styling.
3. **Meaning colours are fixed.** Blue = in the agent's context (pinned). Violet = what the agent
   did (read, created, edited, suggested). Amber = needs a look (warning, stale, out of date) and
   nothing else. Relation inks never reuse these three. Every such mark also carries a glyph and a
   word.
4. **The drawings are the target; the code may lag.** Until wave 0 lands, today's CSS still uses
   `--c-warn` for pins and attention and falls back to Arial on controls. Do not spread those
   patterns; move the surface you touch toward the drawing.
5. **Done means** the checks in `docs/design.md`: the reference cases at 600, 1024 and 1920 px, all nine themes,
   the demo board regenerated, user-facing docs updated.
6. **One design home.** Decisions and deviations go in `docs/design.md`; a drawing changed in the
   proposal canvas is re-exported into `docs/design/` in the same change. No other design folders.

## Themes

Nine themes: `harbor` (default), `daylight`, `high-contrast`, `midnight`, `sepia`, `arctic`, `ember`, `forest`, `volt`. The canonical registry is `src/shared/themes.ts`; per-theme CSS variable blocks live in `src/client/theme/global.css` + `surface-theme.css` (kept in sync by `tests/unit/surface-theme-tokens.test.ts`). Set via:
- CLI: `--theme=daylight`
- Env: `PMX_CANVAS_THEME=daylight`
- Browser: rail theme picker (sun/moon button in the left tool rail opens the theme menu)

Embedded dark/light-only viewers (json-render, MCP apps) collapse named themes to their scheme via `canvasThemeScheme` (e.g. `sepia` → light, `ember` → dark).

## Releasing

The full release recipe (pre-flight gates, version bump, tag → publish, smoke,
common gotchas) lives in [`docs/RELEASE.md`](docs/RELEASE.md). The README
intentionally does not document the release flow — it's an end-user-facing file
and the release process is maintainer-only.

## Changelog Style

Keep `CHANGELOG.md` entries simple and user-facing — short, plain sentences, no
deep technical exposition, no exhaustive migration tables. Per release:

- Optional **Highlights** — 3–5 one-line bullets of the most notable changes
- **Added** / **Changed** / **Fixed** (and **Breaking** when needed) — each
  bullet is one plain sentence describing the change from the user's
  perspective (what they can now do or what behaves differently)
- No nested sub-bullets, tool-by-tool mappings, or implementation detail; link
  to docs for anything long-form

Example bullet: "Added a `/rename` slash command to rename the current session
directly from the composer."

## README changes require approval

Do not change `Readme.md` or replace its screenshots or demo video unless the user
explicitly asks for that change or approves it first. A feature, fix, or release is
not permission to update the README. This rule overrides any checklist below that
asks for a README update.

Keep the README a short product introduction and getting-started guide. Put detailed
feature behavior, API contracts, and release notes in the relevant docs or changelog.
Use fictional content and data in README screenshots and demos, never real work boards.
Keep agent-skill setup as the recommended starting point; reserve repository cloning
for development, not the main installation instructions.

## Testing Conventions

Use the `pmx-canvas-testing` skill for the repo-standard verification ladder, test command
selection, and handoff expectations whenever you change code in this project.

Use the `published-consumer-e2e` skill when you need to validate PMX Canvas as an installed
package in a clean temp consumer instead of the repo dev path.

1. **Never dismiss failing tests.** Investigate every failure before declaring success. A "pre-existing" failure still needs resolution or explicit acknowledgment.

2. **Verify the full stack.** Don't just check that code compiles — start the server, hit the endpoints, confirm the SPA loads:
   ```bash
   bun run src/cli/index.ts --no-open --demo &
   curl http://localhost:4313/api/canvas/state        # Should return 3 nodes, 2 edges
   curl http://localhost:4313/canvas/index.js -o /dev/null -w "%{http_code}"  # Should be 200
   curl -N http://localhost:4313/api/workbench/events  # Should stream SSE events
   ```

3. **Test MCP server separately.** The MCP server can be tested with `bun run src/mcp/server.ts` and sending JSON-RPC over stdin.

4. **Assert the user-visible effect, not the server number.** When a feature's value IS the
   rendered result — a viewport move, a node being visible, iframe-backed content refreshing —
   assert the observable: the node's `getBoundingClientRect()` lands in the viewport, the iframe
   URL actually changed, the rendered text updated. A viewport tuple, a `panned: true`, or updated
   `node.data` is an intermediate, and asserting one locks in whatever convention the
   implementation happened to use. Three features shipped broken with green tests this way
   (`view.focus`, the live workboard, `fit`) — in two cases the wrong-convention assertions were
   added by the very commit that introduced the bug. See architecture rules 9 and 10 for the two
   traps this repo keeps hitting.

## API and Product Reference

See [API and product reference](docs/api-reference.md) for canvas types, MCP, AX primitives, spatial semantics, history, code graphs, and integration paths.

## Conventions

- All server-side modules live in `src/server/`
- All client-side Preact components live in `src/client/`
- The MCP server imports from `src/server/index.ts` — it does not duplicate state management
- CSS uses custom properties (`:root { --c-* }`) — no Tailwind classes
- Imports use `.js` extensions for Bun module resolution
- The `canvasState` singleton is shared across HTTP handlers, MCP tools, and the SDK class
- **Client writes go through the bridge helpers** (`requestJson` / `requestOk` /
  `requestBestEffort` in `src/client/state/intent-bridge.ts`), never a bare `fetch`: they carry
  the `X-PMX-Workbench` marker that tells the server the write is the human's. Without it the
  human's own click is booked as an anonymous `api` agent — it lights the External Steering
  indicator, shows as agent work in the session timeline, and is subject to the scope fence
  (context pins and annotations shipped that way; `tests/client/context-pin-bar.test.tsx`
  asserts the marker)
- **No native browser UI in client flows.** `window.prompt`, `window.alert`, `window.confirm`,
  and title-attribute tooltips are silent no-ops in embedded browser panes (Claude, Copilot,
  and Codex all drive the workbench through one) — a flow depending on them "does nothing"
  there, with no error. This shipped three times. Use `askText`/`TextPrompt`
  (`src/client/canvas/TextPrompt.tsx`) for input, `BarHint` for hover hints, and an in-flow
  caption where an anchored tooltip would clip inside an overflow container.

## Adding New Node Types

1. Add the type string to the union in `src/server/canvas-state.ts` (`CanvasNodeState.type`),
   plus `canvas-provenance.ts` (`CanvasNodeType`), `ax-interaction.ts`
   (`DEFAULT_NODE_AX_CAPABILITIES` — exhaustive record), `canvas-schema.ts` (create schema),
   `canvas-validation.ts` (`NODE_MIN_CREATE_SIZES` floor)
2. Create a renderer component in `src/client/nodes/YourNode.tsx`, to its artboard in `docs/design/`
   (draw one first if none exists — see [Design](#design))
3. Add the case to the render switches in `src/client/canvas/CanvasViewport.tsx` AND
   `ExpandedNodeOverlay.tsx`, plus the exhaustive records in `state/node-factory.ts`, `types.ts`
   (union, `TYPE_LABELS`, `EXPANDABLE_TYPES`), `icons.tsx`
4. **Add the type to `isCanvasNodeType` in `src/client/state/sse-bridge.ts`** — this runtime
   guard silently DROPS unknown types during layout apply, so a missed entry renders nothing
   in the live workbench even though every unit/client test passes
5. Add to `NODE_TYPES` in `src/server/operations/ops/nodes.ts` (MCP uses that same enum)
   and a `defaultNodeSize` case
6. Update `SKILL.md`, `readme.md`, and `docs/node-types.md` with the new type
7. Regenerate the demo board (`bun run scripts/generate-demo-board.ts`) and add the type to it —
   see [Demo Board](#demo-board)
8. **Open the type in a real browser before calling it done.** Steps 3–5 can all be complete and
   every unit and client test green while the node renders nothing (see step 4). A DOM check on a
   live board is the only thing that catches it.

## Adding New HTTP Endpoints

1. Add the handler function in `src/server/server.ts`
2. Add the route in the `Bun.serve` fetch handler
3. Add the corresponding method to `PmxCanvas` class in `src/server/index.ts`
4. Add the MCP tool in `src/mcp/server.ts`
5. Update `SKILL.md`, `readme.md`, and CLI help text
6. **Document it in the contract docs** — `docs/http-api.md` (and `docs/mcp.md` / `docs/cli.md`
   for a tool/action/command). `docs/api-stability.md` defines the public surface as *what those
   files document*, so an undocumented route is both invisible to agents and outside the
   stability contract. The same applies to counts and tables agents read as authoritative: the
   tool count, the composite `action` lists, the theme list, and the AX capability matrix in
   `skills/pmx-canvas/references/full-reference.md` all went stale mid-cycle at least once.

**Routes that serve raw file bytes need four separate guards** (the 0.4.7 `file-bytes` route
shipped without any of them):
- **Confine on REAL paths** — `realpathSync` the candidate *and* the workspace root before
  comparing. A lexical `resolve()`/`relative()` check stops `..` and absolute escapes but not a
  symlink inside the workspace; realpath the root too, or a symlinked root (macOS `/tmp`)
  rejects legitimate files.
- **Derive `Content-Type` from the bytes**, never from caller-writable node data, and send
  `X-Content-Type-Options: nosniff` plus a non-inline disposition for anything not deliberately
  rendered.
- **Stream** (`Bun.file`) with a size ceiling and an `isFile()` check — a directory 500s and a
  FIFO hangs a server that has no request timeout.
- **Sandbox any iframe pointing at it.** If every other iframe in the client is sandboxed, a new
  unsandboxed one is the bug.

## Creating a New Skill

1. Create folder in `skills/` with skill name (lowercase, hyphens)
2. Create `SKILL.md` with YAML frontmatter:
   ```yaml
   ---
   name: skill-name
   description: What it does and when to use it.
   ---
   ```
3. Add optional directories: `scripts/`, `references/`, `assets/`
4. Ensure folder name matches `name` field

## Validating Skills

- Frontmatter has required `name` and `description`
- `name` is lowercase, hyphens only, matches folder
- `description` explains what AND when to use
- No README.md or other auxiliary files in skill folder
- Agent-facing pipeline skills live in `.agents/skills/` and must be mirrored identically in `.claude/skills/` and `.opencode/skills/`
- Run `bun run validate:agent-skills` after changing any mirrored skill files

## Error Hygiene

When maintaining `.learnings/`:
1. Keep only high-signal entries: unresolved blockers, recurring failures, or incidents that require durable guardrails
2. Remove one-off resolved noise after extracting reusable guidance
3. Keep active learnings concise and scannable

## Agent Skill Pipeline

- Agent-facing pipeline skills are stored in `.agents/skills/` and mirrored in `.claude/skills/` and `.opencode/skills/`
- Use `skill-pipeline` as the top-level router / entrypoint for non-trivial coding tasks
- Claude Code hooks are configured in `.claude/settings.json` and point at the mirrored `.claude/skills/` scripts
- Keep the three skill trees byte-for-byte identical; verify with `bun run validate:agent-skills`
- The skill trees are local-only dev tooling and gitignored — a clean checkout does not contain them, and `validate:agent-skills` skips (exits 0) when they are absent
- Use the skill definitions under `.agents/skills/` as the canonical instructions

### How To Run It

Treat pipeline depth as task-sized:

- Trivial tasks: no pipeline
- Small tasks: run `verify-gate` then `simplify-and-harden`
- Medium tasks: run `intent-framed-agent`, then `verify-gate`, then `simplify-and-harden`
- Large or long-running tasks: run `plan-interview`, then `intent-framed-agent` with `context-surfing`, then `verify-gate`, then `simplify-and-harden`, then `self-improvement`
- Batch tasks: run `agent-teams-simplify-and-harden`, then `self-improvement`
- CI/headless review: use `simplify-and-harden-ci` and `self-improvement-ci`; use `learning-aggregator-ci` and `eval-creator-ci` for the outer loop
- Run `pre-flight-check` at session start when hooks are available; Claude hooks also wire `context-surfing` handoff detection and `self-improvement` reminders
- Use `learning-aggregator` and `eval-creator` for cross-session outer-loop improvement work

### Version

- Imported pipeline version manifest: `.agents/skills/PIPELINE_VERSIONS.md`
- Canonical imported revision: `01ae6f8b3c9a0ab96e8ec87b27fdd88677696cde` from `https://github.com/pskoett/pskoett-ai-skills`

## Browser Automation Visibility Rule

When using browser automation for UI investigation:
1. Use a visible browser window (headed mode) so the user can see what is happening
2. Do not run headless unless the user explicitly asks for it
