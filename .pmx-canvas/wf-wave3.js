export const meta = {
  name: 'registry-finish-wave3-webview',
  description: 'plan-008 Wave 3: migrate webview ops via a runner-injection; add canvas_webview composite',
  phases: [
    { title: 'Implement', detail: 'webview-runner injection + 5 webview ops + canvas_webview composite' },
    { title: 'Audit', detail: 'parallel harden/simplify/spec auditors' },
  ],
}

const SPEC = [
  'You are implementing plan-008 Wave 3 (the canvas_webview consolidation) in /Users/pepe/dev/pmx-canvas (branch refactor/v0.2-registry-finish, checked out).',
  'CONTEXT: the operation-registry refactor is otherwise complete. The 5 browser-automation tools (canvas_webview_status, canvas_webview_start, canvas_webview_stop, canvas_resize, canvas_evaluate) are still hand-written n-way duplication (MCP + HTTP route + SDK + CanvasAccess). They were deferred because the webview machinery (startCanvasAutomationWebView / stop / evaluate / resize / getCanvasAutomationWebViewStatus) lives in src/server/server.ts, which operations/ must NOT import. Resolve that with a RUNNER-INJECTION pattern, exactly mirroring how the SSE emitter is injected: src/server/operations/registry.ts has setOperationEventEmitter(...) which server.ts calls at module load. Do the same for the webview runner.',
  '',
  'Read FIRST: docs/plans/plan-008-registry-finish.md; src/server/operations/registry.ts (the setOperationEventEmitter injection pattern); src/server/operations/types.ts + http.ts + mcp.ts; an op template (src/server/operations/ops/viewport.ts — mutates:false ops that use ctx.emit); src/server/operations/composites.ts + buildCompositeDeprecationNotes; tests/unit/mcp-tool-freeze.test.ts (the frozen list); tests/unit/mcp-composites.test.ts. Then map the current webview surface: the 5 MCP tools in src/mcp/server.ts; their HTTP routes + handlers in src/server/server.ts; the SDK methods in src/server/index.ts (startAutomationWebView/stopAutomationWebView/getAutomationWebViewStatus/evaluateAutomationWebView/resizeAutomationWebView); the CanvasAccess interface + Local + Remote methods in src/mcp/canvas-access.ts; the underlying functions in server.ts (startCanvasAutomationWebView etc.). CLAUDE.md guardrails.',
  '',
  'STEP 1 — webview-runner injection. Create a small module src/server/operations/webview-runner.ts (operations-internal; must NOT import server.ts/index.ts) that declares a WebviewRunner interface (status(): ...; start(options): Promise<...>; stop(): Promise<...>; resize(w,h): Promise<...>; evaluate(expression): Promise<unknown>) and a module-level injected instance with setWebviewRunner(runner) + a getter that throws a clear error if not injected. In src/server/server.ts, at the same module-load point where it calls setOperationEventEmitter(...), call setWebviewRunner({ ... }) wiring the real server.ts automation functions. (screenshot stays OUT — it returns binary; see below.)',
  '',
  'STEP 2 — the 5 webview ops (new file src/server/operations/ops/webview.ts, export an Operation array). Each: mutates:false (webview is a side surface — NO canvas-layout-update). Map to the EXACT current HTTP route+method (read server.ts + RemoteCanvasAccess to find the real paths, e.g. /api/canvas/webview/...). Each handler calls the injected runner (getWebviewRunner().start(...) etc.) — NOT server.ts directly. Preserve the exact wire shapes + the MCP result shapes byte-for-byte (read the current tools):',
  '  - webview.status  -> canvas_webview_status (read; no args)',
  '  - webview.start   -> canvas_webview_start (options: backend/width/height/chromePath/chromeArgv/dataStoreDir)',
  '  - webview.stop    -> canvas_webview_stop (no args)',
  '  - webview.resize  -> canvas_resize (width, height required)',
  '  - webview.evaluate-> canvas_evaluate (expression OR script; runs arbitrary JS in the page; preserve the exact arg validation + the result-wrapping formatResult the legacy tool used; preserve the trust posture — it is the same arbitrary-eval as before, just relocated).',
  'Register the array in src/server/operations/index.ts. DELETE the legacy: the 5 MCP tool blocks (mcp/server.ts), the 5 HTTP handlers + routes (server.ts), and the now-orphaned CanvasAccess methods (interface + Local + Remote: getAutomationWebViewStatus/startAutomationWebView/stopAutomationWebView/resizeAutomationWebView/evaluateAutomationWebView + their type aliases — grep-prove orphaned; KEEP screenshotAutomationWebView on CanvasAccess since canvas_screenshot stays). The SDK PmxCanvas webview methods stay public.',
  '',
  'STEP 3 — canvas_webview composite (src/server/operations/composites.ts), additive: actions status -> webview.status, start -> webview.start, stop -> webview.stop, resize -> webview.resize, evaluate -> webview.evaluate. Deprecation prefixes auto-derive via buildCompositeDeprecationNotes (verify). canvas_screenshot is NOT folded (binary payload) — leave it standalone; note that in the composite description / the standalone list.',
  '',
  'STEP 4 — freeze test: canvas_webview is a NEW tool name. Add it to tests/unit/mcp-tool-freeze.test.ts in sorted position and bump the count 81 -> 82 (in the length assertion + the test title + the header comment). This is the only deliberate freeze change. The 5 legacy webview tool NAMES stay in the list (still registered, now registry-served). Do NOT otherwise edit operation-parity.test.ts or mcp-server.test.ts.',
  '',
  'STEP 5 — tests + docs. Add mcp-composites.test.ts parity cases: canvas_webview status/start/stop behave like the standalone tools (status is the safe head-to-head; start/stop may be environment-gated — if a real webview cannot start in the test env, assert the op dispatches + returns the same shape/Error as the standalone tool rather than requiring a live browser; mirror however the existing webview tests in mcp-server.test.ts handle it — READ them first). Update docs/mcp.md (add canvas_webview to the composite table; note screenshot stays standalone; bump counts) and CHANGELOG [Unreleased] (Added: canvas_webview composite + the 5 webview ops migrated via runner injection; Deprecated: the 5 legacy webview tools). Update docs/plans/plan-008-registry-finish.md to mark canvas_webview DONE (move it out of the deferred list).',
  '',
  'HARD CONSTRAINTS: operations/ must NEVER import server.ts or index.ts — the webview runner is INJECTED. Wire shapes + MCP result shapes + the evaluate trust posture byte-identical. The 5 legacy tool names preserved (registry-served). No any/dynamic-import/defensive-noise. Replicate legacy quirks; only allowed unification = local-vs-remote success/error asymmetry (document). If the webview genuinely cannot be made to work in the test environment (no Chrome), do NOT fake it — make the ops dispatch correctly and have the tests assert dispatch/shape parity the same way the existing webview tests do, and report it.',
  '',
  'VERIFY (iterate until green): export PATH=$HOME/.bun/bin:$PATH && cd /Users/pepe/dev/pmx-canvas && bun run typecheck ; then PMX_CANVAS_DISABLE_BROWSER_OPEN=1 bun test tests/unit/mcp-tool-freeze.test.ts tests/unit/mcp-composites.test.ts tests/unit/mcp-server.test.ts tests/unit/operation-parity.test.ts tests/unit/server-api.test.ts 2>&1 | tail -12 ; then the FULL suite: PMX_CANVAS_DISABLE_BROWSER_OPEN=1 bun test tests/unit 2>&1 | tail -6 . Do NOT run git or Playwright.',
  '',
  'RETURN: the runner-injection design (interface + where server.ts injects); the 5 ops (name -> tool -> route); legacy deleted (file + line delta); CanvasAccess methods removed (+ grep orphan proof, and confirm screenshot kept); canvas_webview composite + auto-derived deprecation; freeze 81->82; how the webview tests handle a no-Chrome env; typecheck + targeted + FULL suite results; any divergence + resolution.',
].join('\n')

phase('Implement')
const impl = await agent(SPEC, { label: 'implement:wave3-webview' })

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
const AUDIT_BASE = 'Read-only audit of UNCOMMITTED changes in /Users/pepe/dev/pmx-canvas (branch refactor/v0.2-registry-finish) implementing plan-008 Wave 3 — migrating the 5 webview ops via a runner-injection (new src/server/operations/webview-runner.ts + ops/webview.ts) and adding the canvas_webview composite. Use git diff and read the files. '
const audits = await parallel([
  () => agent(AUDIT_BASE + 'HARDEN: operations/ truly free of server.ts/index.ts imports (the runner is injected, getter throws if not)? wire/result shapes + evaluate trust posture preserved? mutates:false (no spurious canvas-layout-update)? CanvasAccess methods deleted while still referenced (screenshot must be KEPT)? injection wired at server.ts module load?', { label: 'audit:harden', phase: 'Audit', agentType: 'pskoett-ai-skills:harden-auditor', schema: FINDINGS_SCHEMA }),
  () => agent(AUDIT_BASE + 'SIMPLIFY: dead code after deletion, orphaned imports/aliases, the runner interface minimal, no over-abstraction, ops delegate (not reimplement).', { label: 'audit:simplify', phase: 'Audit', agentType: 'pskoett-ai-skills:simplify-auditor', schema: FINDINGS_SCHEMA }),
  () => agent(AUDIT_BASE + 'SPEC vs plan-008 Wave 3: 5 webview ops migrated + canvas_webview composite added; screenshot left standalone (binary); freeze 81->82 (only deliberate change); operation-parity/mcp-server NOT edited (only mcp-tool-freeze for the +1 name); legacy fully deleted; deprecation auto-derived; docs/mcp.md + CHANGELOG + plan-008 updated. Flag any guard-test edit beyond the freeze +1.', { label: 'audit:spec', phase: 'Audit', agentType: 'pskoett-ai-skills:spec-auditor', schema: FINDINGS_SCHEMA }),
]).then((r) => r.filter(Boolean))
const findings = audits.flatMap((a) => (a && a.findings) ? a.findings : [])
log('Wave 3 (webview) audit: ' + findings.length + ' finding(s); critical/high: ' + findings.filter((f) => f.severity === 'critical' || f.severity === 'high').length)
return { implementation: impl, findings }
