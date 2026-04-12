# Agent Instructions

Agent-specific workflows, tool usage patterns, and automation rules for the pmx-canvas project.

## Workflow Orchestration

### 1. Plan Mode Default
- Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions)
- If something goes sideways, STOP and re-plan immediately — don't keep pushing
- Use plan mode for verification steps, not just building
- Write detailed specs upfront to reduce ambiguity

### 2. Subagent Strategy
- Use subagents liberally to keep main context window clean
- Offload research, exploration, and parallel analysis to subagents
- For complex problems, throw more compute at it via subagents
- One task per subagent for focused execution

### 3. Self-Improvement Loop
- After ANY correction from the user: log the lesson
- Write rules for yourself that prevent the same mistake
- Ruthlessly iterate on these lessons until mistake rate drops
- Log to `.learnings/ERRORS.md`, `LEARNINGS.md`, or `FEATURE_REQUESTS.md`
- Promote broadly applicable learnings to `CLAUDE.md` and `AGENTS.md`

### 4. Verification Before Done
- Never mark a task complete without proving it works
- Diff behavior between main and your changes when relevant
- Ask yourself: "Would a staff engineer approve this?"
- Run the server, check endpoints, demonstrate correctness

### 5. Demand Elegance (Balanced)
- For non-trivial changes: pause and ask "is there a more elegant way?"
- If a fix feels hacky: "Knowing everything I know now, implement the elegant solution"
- Skip this for simple, obvious fixes — don't over-engineer
- Challenge your own work before presenting it

### 6. Autonomous Bug Fixing
- When given a bug report: just fix it. Don't ask for hand-holding
- Point at logs, errors, failing tests — then resolve them
- Zero context switching required from the user

## Task Management

1. **Plan First**: Write plan with checkable items
2. **Verify Plan**: Check in before starting implementation
3. **Track Progress**: Mark items complete as you go
4. **Explain Changes**: High-level summary at each step
5. **Capture Lessons**: Update `.learnings` files after corrections
6. **Review Before Done**: Final review to ensure everything is clear and robust

## Core Principles

- **Simplicity First**: Make every change as simple as possible. Impact minimal code.
- **No Laziness**: Find root causes. No temporary fixes. Senior developer standards.
- **Minimal Impact**: Changes should only touch what's necessary. Avoid introducing bugs.
- **Learn and Improve**: Every mistake is a learning opportunity. Log it, learn from it, prevent it.

## TypeScript Guardrails

1. **Do not introduce dynamic imports by default**: Do not add `await import(...)` or similar dynamic-loading patterns unless the user explicitly asks for them or the existing architecture requires them.
2. **Do not use `any` casts or annotations**: Avoid `as any`, `: any`, `Promise<any>`, or equivalent escape hatches. Model the real type instead.
3. **Do not add defensive noise by default**: Do not add extra defensive checks or broad `try/catch` blocks unless they are necessary for a specific runtime boundary, recovery path, or user-requested behavior.

## Canvas Architecture Rules

1. **State lives in the server.** `CanvasStateManager` is the singleton source of truth. All mutations go through it. The browser is a renderer.

2. **SSE-created nodes must sync to server-side canvasState.** When `emitPrimaryWorkbenchEvent` creates nodes on the client via SSE, also create them in the server-side `canvasState` singleton. Otherwise `canvas_get_layout` returns 0 nodes and `canvas-layout-update` reconciliation deletes client-only nodes.

3. **Rebuild canvas bundle after client source changes.** After modifying any file under `src/client/`, run `bun run build` before testing in the browser. The dist bundle is not auto-built; stale bundles silently hide new features.

4. **Canvas edits happen in place.** The web canvas is a live multi-node workspace. Flows should update the current session without evicting prior document nodes. Agents must not describe the canvas as requiring reopen/replace for additional documents.

5. **MCP tools map 1:1 to PmxCanvas methods.** When adding a new canvas operation, add it to: (a) `CanvasStateManager`, (b) `PmxCanvas` class in `src/server/index.ts`, (c) HTTP endpoint in `src/server/server.ts`, (d) MCP tool in `src/mcp/server.ts`. All four layers must stay in sync.

6. **Context pins are the bridge between human and agent.** The human pins nodes in the browser, the agent reads `canvas://pinned-context`. This is the primary communication channel from human spatial curation to agent context. Preserve this flow.

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

## Testing Conventions

Use the `pmx-canvas-testing` skill for the repo-standard verification ladder, test command
selection, and handoff expectations whenever you change code in this project.

Use the `published-consumer-e2e` skill when you need to validate PMX Canvas as an installed
package in a clean temp consumer instead of the repo dev path.

1. **Never dismiss failing tests.** Investigate every failure before declaring success. A "pre-existing" failure still needs resolution or explicit acknowledgment.

2. **Verify the full stack.** Don't just check that code compiles — start the server, hit the endpoints, confirm the SPA loads:
   ```bash
   bun run src/cli/index.ts --no-open --demo &
   curl http://localhost:4313/api/canvas/state
   curl http://localhost:4313/canvas/index.js -o /dev/null -w "%{http_code}"
   curl -N http://localhost:4313/api/workbench/events
   ```

3. **Test MCP server separately.** The MCP server can be tested with `bun run src/mcp/server.ts` and sending JSON-RPC over stdin.

## Adding New Node Types

1. Add the type string to the union in `src/server/canvas-state.ts` (`CanvasNodeState.type`)
2. Create a renderer component in `src/client/nodes/YourNode.tsx`
3. Add the case to `src/client/canvas/CanvasNode.tsx` switch statement
4. Add to the MCP tool's `type` enum in `src/mcp/server.ts`
5. Update `SKILL.md` and `readme.md` with the new type

## Adding New HTTP Endpoints

1. Add the handler function in `src/server/server.ts`
2. Add the route in the `Bun.serve` fetch handler
3. Add the corresponding method to `PmxCanvas` class in `src/server/index.ts`
4. Add the MCP tool in `src/mcp/server.ts`
5. Update `SKILL.md`, `readme.md`, and CLI help text

## Error Hygiene

When maintaining `.learnings/`:
1. Keep only high-signal entries: unresolved blockers, recurring failures, or incidents that require durable guardrails
2. Remove one-off resolved noise after extracting reusable guidance
3. Keep active learnings concise and scannable

## Browser Automation Visibility Rule

When using browser automation for UI investigation:
1. Use a visible browser window (headed mode) so the user can see what is happening
2. Do not run headless unless the user explicitly asks for it
