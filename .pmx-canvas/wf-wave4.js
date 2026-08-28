export const meta = {
  name: 'registry-finish-wave4-app',
  description: 'plan-008 Wave 4: migrate open_mcp_app / add_diagram / build_web_artifact; add canvas_app composite',
  phases: [
    { title: 'Implement', detail: '3 side-channel app ops + canvas_app composite' },
    { title: 'Audit', detail: 'parallel harden/simplify/spec auditors' },
  ],
}

const SPEC = [
  'You are implementing plan-008 Wave 4 (the canvas_app consolidation) in /Users/pepe/dev/pmx-canvas (branch refactor/v0.2-registry-finish, checked out).',
  'CONTEXT: the registry refactor is otherwise complete. Three external/built-content tools remain hand-written: canvas_open_mcp_app, canvas_add_diagram, canvas_build_web_artifact. They were deferred as "poor fits" but on reflection are migratable: executeOperation is async (so the long-running build fits — its "long-running" caveat is about MCP client timeouts, not registry fit), and their runtimes are domain modules, not server.ts.',
  '',
  'FIRST, INVESTIGATE server-independence (operations/ must NEVER import server.ts or index.ts):',
  '- src/server/mcp-app-runtime.js (openExternalMcpApp, closeMcpAppSession) — server-independent?',
  '- src/server/web-artifacts.js (buildWebArtifactOnCanvas) — server-independent?',
  '- src/server/diagram-presets.js (buildExcalidrawOpenMcpAppInput, ensureExcalidrawCheckpointId, isExcalidrawCreateView) — server-independent?',
  '- src/server/ext-app-lookup.js (findCanvasExtAppNodeId) — server-independent?',
  'If a needed function is server-independent, the op handler calls it directly. If a needed piece lives ONLY in server.ts, use the runner-INJECTION pattern established in Wave 3 (src/server/operations/webview-runner.ts + setWebviewRunner injected at server.ts module load). Read that as the template for any injection you need.',
  '',
  'Read FIRST: docs/plans/plan-008-registry-finish.md; the SDK methods being migrated in src/server/index.ts (openMcpApp ~lines 897-972, addDiagram ~973-978, buildWebArtifact ~891-895) — these hold the exact logic (toolCallId generation, openExternalMcpApp call, prior-session closeMcpAppSession, the ext-app-open + ext-app-result SSE emits via emitPrimaryWorkbenchEvent, node-id resolution via findCanvasExtAppNodeId); the HTTP handlers handleCanvasOpenMcpApp / handleCanvasAddDiagram / handleCanvasBuildWebArtifact in src/server/server.ts; the 3 MCP tool blocks in src/mcp/server.ts; the CanvasAccess methods (openMcpApp/addDiagram/buildWebArtifact) in src/mcp/canvas-access.ts. Also read an op template (src/server/operations/ops/webview.ts for injection, ops/nodes.ts for ctx.emit) + composites.ts + buildCompositeDeprecationNotes + mcp-tool-freeze.test.ts + mcp-composites.test.ts. CLAUDE.md guardrails.',
  '',
  'MIGRATE — 3 ops (new file src/server/operations/ops/app.ts, export an Operation array). Each is mutates:false (these do NOT emit canvas-layout-update; the legacy emitted ext-app-open / ext-app-result instead — replicate those via ctx.emit with the EXACT event names + payloads). Move the SDK method bodies into op handlers (the SDK methods then become thin wrappers over the op core, like the other slices):',
  '  - mcpapp.open  -> canvas_open_mcp_app  -> POST /api/canvas/mcp-app/open. Replicate openMcpApp EXACTLY: toolCallId, openExternalMcpApp(transport,...), close prior session, emit ext-app-open + ext-app-result via ctx.emit, resolve nodeId via findCanvasExtAppNodeId, return { ok, id?, nodeId, toolCallId, sessionId, resourceUri } byte-identical.',
  '  - diagram.open -> canvas_add_diagram   -> POST /api/canvas/diagram. Thin preset: buildExcalidrawOpenMcpAppInput(input) then delegate to the mcpapp.open core (call the shared core, not re-emit twice). Same return shape.',
  '  - webartifact.build -> canvas_build_web_artifact -> POST /api/canvas/web-artifact. async handler awaits buildWebArtifactOnCanvas(input); returns the byte-identical metadata envelope { ok, path, bytes, projectPath, openedInCanvas, ..., id?, nodeId, url, metadata, logs }. If openInCanvas creates a node via SSE, replicate that emit via ctx.emit. NOTE it is long-running (minutes) — that is fine for an async op; do not add timeouts.',
  '  CAUTION (toolCallId / any nondeterminism): op handlers run under the registry. Date.now()/Math.random() are fine in server runtime (this is NOT a workflow script) — keep the legacy id-generation exactly as the SDK did.',
  '',
  'Register the array in src/server/operations/index.ts. DELETE the legacy: the 3 MCP tool blocks (mcp/server.ts), the 3 HTTP handlers + routes (server.ts), the orphaned CanvasAccess methods (openMcpApp/addDiagram/buildWebArtifact + type aliases — grep-prove). The SDK PmxCanvas.openMcpApp/addDiagram/buildWebArtifact stay PUBLIC but delegate to the op cores (extract a shared core function each op + the SDK call, OR have the SDK call executeOperation — match how the other slices kept the SDK public). Preserve the SDK emitting its events (now via the op/ctx.emit path; ensure exactly the legacy events fire once, not twice).',
  '',
  'COMPOSITE canvas_app (additive, src/server/operations/composites.ts): actions open-mcp-app -> mcpapp.open, diagram -> diagram.open, build-artifact -> webartifact.build. Deprecation prefixes auto-derive. Freeze: canvas_app is a NEW name -> add to mcp-tool-freeze.test.ts in sorted position, bump 82 -> 83 (length + title + header). The 3 legacy tool names stay (registry-served).',
  '',
  'HARD CONSTRAINTS: operations/ must NEVER import server.ts/index.ts (call server-independent domain modules directly, or inject). SSE event names + payloads (ext-app-open, ext-app-result) byte-identical. Wire shapes + MCP result shapes byte-identical. mutates:false (no spurious canvas-layout-update). No any/dynamic-import/defensive-noise. Replicate legacy quirks; only allowed unification = local-vs-remote success/error asymmetry (document). If ANY of the 3 genuinely cannot be migrated without importing server.ts AND injection is not clean, STOP-and-report that op (do not force) — but then the canvas_app composite can only fold the migrated ones, so report the situation rather than shipping a half-composite.',
  '',
  'TESTS: add mcp-composites.test.ts parity cases for canvas_app (at minimum: diagram and/or open-mcp-app dispatch to the same op as the standalone tool and return the same shape — use the existing mcp-server.test.ts mcp-app fixture pattern; READ how mcp-server.test.ts exercises canvas_open_mcp_app / canvas_add_diagram, there is an mcp-app-fixture). build_web_artifact may be too slow/heavy for a unit test — if so, assert dispatch parity without a full build, mirroring any existing approach, and note it. Update docs/mcp.md (canvas_app row + counts), CHANGELOG [Unreleased] (Added canvas_app + 3 ops migrated; Deprecated the 3 tools), and plan-008 (mark canvas_app DONE / update deferred list).',
  '',
  'VERIFY (iterate until green): export PATH=$HOME/.bun/bin:$PATH && cd /Users/pepe/dev/pmx-canvas && bun run typecheck ; then PMX_CANVAS_DISABLE_BROWSER_OPEN=1 bun test tests/unit/mcp-tool-freeze.test.ts tests/unit/mcp-composites.test.ts tests/unit/mcp-server.test.ts tests/unit/operation-parity.test.ts tests/unit/server-api.test.ts 2>&1 | tail -12 ; then the FULL suite: PMX_CANVAS_DISABLE_BROWSER_OPEN=1 bun test tests/unit 2>&1 | tail -6 . Do NOT run git or Playwright.',
  '',
  'RETURN: server-independence findings per dep (and any injection used); the 3 ops (name -> tool -> route -> SSE events); how the SDK methods stay public (core extraction); legacy deleted (file + line delta); CanvasAccess methods removed (+ grep orphan proof); canvas_app composite + deprecation; freeze 82 -> 83; how build_web_artifact is tested; typecheck + targeted + FULL suite results; any op you had to defer + why.',
].join('\n')

phase('Implement')
const impl = await agent(SPEC, { label: 'implement:wave4-app' })

phase('Audit')
const FINDINGS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          file: { type: 'string' },
          line: { type: 'number' },
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          category: { type: 'string' },
          issue: { type: 'string' },
          fix: { type: 'string' },
        },
        required: ['file', 'severity', 'category', 'issue', 'fix'],
      },
    },
  },
  required: ['findings'],
}
const AUDIT_BASE = 'Read-only audit of UNCOMMITTED changes in /Users/pepe/dev/pmx-canvas (branch refactor/v0.2-registry-finish) implementing plan-008 Wave 4 — migrating canvas_open_mcp_app / canvas_add_diagram / canvas_build_web_artifact into registry ops (new src/server/operations/ops/app.ts) and adding the canvas_app composite. Use git diff and read the files. '
const audits = await parallel([
  () => agent(AUDIT_BASE + 'HARDEN: operations/ free of server.ts/index.ts imports (server-independent calls or injection)? ext-app-open/ext-app-result SSE events fire EXACTLY once with byte-identical payloads (not twice, not zero — esp. diagram delegating to the mcpapp.open core)? mcp-app session lifecycle (toolCallId, prior-session close) preserved? wire/result shapes byte-identical? CanvasAccess deleted while still referenced? mutates:false (no spurious layout frame)?', { label: 'audit:harden', phase: 'Audit', agentType: 'pskoett-ai-skills:harden-auditor', schema: FINDINGS_SCHEMA }),
  () => agent(AUDIT_BASE + 'SIMPLIFY: dead code after deletion, orphaned imports/aliases, the SDK-core extraction not duplicated, diagram preset stays thin (delegates, no copy), no over-abstraction.', { label: 'audit:simplify', phase: 'Audit', agentType: 'pskoett-ai-skills:simplify-auditor', schema: FINDINGS_SCHEMA }),
  () => agent(AUDIT_BASE + 'SPEC vs plan-008 Wave 4: 3 ops migrated + canvas_app composite (open-mcp-app/diagram/build-artifact); SDK methods stay public (delegate to cores); freeze 82->83 (only deliberate change); operation-parity/mcp-server NOT edited beyond freeze+1; legacy fully deleted; deprecation auto-derived; docs/mcp.md + CHANGELOG + plan-008 updated. Did the agent defer any op with a stop-and-report rather than forcing? Flag any guard-test edit beyond freeze+1, or any half-composite.', { label: 'audit:spec', phase: 'Audit', agentType: 'pskoett-ai-skills:spec-auditor', schema: FINDINGS_SCHEMA }),
]).then((r) => r.filter(Boolean))
const findings = audits.flatMap((a) => (a && a.findings) ? a.findings : [])
log('Wave 4 (canvas_app) audit: ' + findings.length + ' finding(s); critical/high: ' + findings.filter((f) => f.severity === 'critical' || f.severity === 'high').length)
return { implementation: impl, findings }
