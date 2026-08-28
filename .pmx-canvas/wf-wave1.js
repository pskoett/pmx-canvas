export const meta = {
  name: 'registry-finish-wave1',
  description: 'plan-008 Wave 1: migrate validate.get + annotation.remove; add canvas_query validate + canvas_view remove-annotation actions',
  phases: [
    { title: 'Implement', detail: '2 registry ops + 2 composite actions + deprecations + tests' },
    { title: 'Audit', detail: 'parallel harden/simplify/spec auditors' },
  ],
}

const SPEC = [
  'You are implementing plan-008 Wave 1 in /Users/pepe/dev/pmx-canvas (branch refactor/v0.2-registry-finish, checked out).',
  'Read FIRST: docs/plans/plan-008-registry-finish.md (Wave 1); the registry pattern in src/server/operations/types.ts + http.ts + registry.ts; src/server/operations/ops/query.ts (read ops + where canvas_query composite members live); src/server/operations/ops/edges.ts (edge.remove is the template for an id-from-path DELETE op with a 404 denial); src/server/operations/composites.ts + src/server/operations/mcp.ts (composite mechanism + buildCompositeDeprecationNotes); tests/unit/mcp-composites.test.ts (parity-test pattern); CLAUDE.md guardrails.',
  '',
  'SCOPE — two clean registry migrations + two composite actions. NOTHING else (webview / open_mcp_app / build_web_artifact / refresh / add-primitive / add_html_node / add_html_primitive / screenshot all STAY legacy per plan-008).',
  '',
  '1) New op validate.get (board validation, a pure read).',
  '   Legacy: MCP tool canvas_validate (no args, src/mcp/server.ts); HTTP GET /api/canvas/validate (handler handleCanvasValidate in src/server/server.ts calling validateCanvasLayout(canvasState.getLayout()) from canvas-validation.ts); SDK PmxCanvas.validate(); CanvasAccess validate() (interface + Local + Remote).',
  '   New op in a NEW file src/server/operations/ops/validate.ts (export an Operation array): op name validate.get, mutates false, NO ctx.emit (pure read); http method GET path /api/canvas/validate; serialize returns the result of validateCanvasLayout(canvasState.getLayout()); mcp toolName canvas_validate, copy the current description, no extraShape (no args), formatResult as plain JSON text. Handler returns validateCanvasLayout(canvasState.getLayout()). validateCanvasLayout and canvasState are server-independent — do NOT import server.ts or index.ts.',
  '   DELETE the legacy: handleCanvasValidate + its route line (server.ts); the canvas_validate server.tool block (mcp/server.ts); CanvasAccess.validate (interface + Local + Remote + the ValidationResult type alias if now orphaned — prove with grep). KEEP PmxCanvas.validate() (SDK stays public).',
  '',
  '2) New op annotation.remove.',
  '   Legacy: MCP canvas_remove_annotation with one arg id; HTTP DELETE /api/canvas/annotation/:id (handler handleCanvasRemoveAnnotation calling canvasState.removeAnnotation(id), returns HTTP 404 with body { ok:false, error } if not found, else { ok:true, removed:id }, and emits canvas-layout-update); SDK removeAnnotation(id); CanvasAccess removeAnnotation(id) (interface + Local + Remote DELETE).',
  '   New op (put it in a NEW file src/server/operations/ops/annotation.ts, export an Operation array — keep operations/ server-independent): op name annotation.remove, mutates true (the registry auto-emits canvas-layout-update — matches legacy), http method DELETE path /api/canvas/annotation/:id (id comes from the path param; the default readInput merges it into input.id). Handler: read input.id; const removed = canvasState.removeAnnotation(id); if not removed, throw OperationError with the EXACT legacy message and status 404; else return the EXACT legacy success body { ok:true, removed:id }. READ the legacy handler first to copy the message + body byte-for-byte. mcp toolName canvas_remove_annotation, extraShape with id as a required string, formatResult plain JSON.',
  '   DELETE the legacy handler + route + MCP tool block + CanvasAccess.removeAnnotation (interface + Local + Remote, grep-prove orphaned). KEEP PmxCanvas.removeAnnotation() (SDK).',
  '',
  '3) Register + wire composites.',
  '   Register the two new Operation arrays in src/server/operations/index.ts (import + spread into the registration loop).',
  '   In src/server/operations/composites.ts: canvas_query gains a validate action mapping to op validate.get (alongside its search/layout actions); canvas_view gains a remove-annotation action mapping to op annotation.remove (alongside arrange/focus/fit/clear). Update each composite actionSummary string. The deprecation prefix for canvas_validate and canvas_remove_annotation then AUTO-derives via buildCompositeDeprecationNotes (op name -> tool name -> "Deprecated: use canvas_query with action validate." etc.) — verify it fires.',
  '',
  'CONSTRAINTS: the tool NAMES are unchanged (canvas_validate + canvas_remove_annotation are still registered, now registry-served), so mcp-tool-freeze count stays 81 — do NOT edit mcp-tool-freeze.test.ts (the sorted name list is unchanged). Do NOT edit operation-parity.test.ts or mcp-server.test.ts. Wire shapes + denial bodies byte-identical. operations/ must not import server.ts or index.ts. No any / no dynamic import / no defensive-noise. Replicate legacy quirks as-is; the only allowed unification is a local-vs-remote success/error asymmetry (document it).',
  '',
  'TESTS: add mcp-composites.test.ts parity cases — canvas_query with action validate returns the same shape as the validation read; canvas_view with action remove-annotation plus an id removes an annotation (create one first via the annotation HTTP API or a drawn annotation) and a missing id is a loud error. Update CHANGELOG [Unreleased]: a Changed entry (validate + annotation migrated to the registry + the two composite actions) and a Deprecated entry (canvas_validate, canvas_remove_annotation).',
  '',
  'VERIFY (iterate until green): export PATH=$HOME/.bun/bin:$PATH && cd /Users/pepe/dev/pmx-canvas && bun run typecheck ; then PMX_CANVAS_DISABLE_BROWSER_OPEN=1 bun test tests/unit/operation-parity.test.ts tests/unit/mcp-tool-freeze.test.ts tests/unit/mcp-server.test.ts tests/unit/mcp-composites.test.ts tests/unit/server-api.test.ts tests/unit/cli-node.test.ts 2>&1 | tail -12 . Do NOT run git or Playwright.',
  '',
  'RETURN: ops created (name -> tool -> route), legacy deleted (file + line delta), CanvasAccess methods removed (+ grep orphan proof), the two composite actions added + the auto-derived deprecation confirmed, the 404 denial body preserved, typecheck + test results, any asymmetry unified.',
].join('\n')

phase('Implement')
const impl = await agent(SPEC, { label: 'implement:wave1' })

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
const AUDIT_BASE = 'Read-only audit of UNCOMMITTED changes in /Users/pepe/dev/pmx-canvas (branch refactor/v0.2-registry-finish) implementing plan-008 Wave 1 — migrating canvas_validate to op validate.get and canvas_remove_annotation to op annotation.remove, and adding canvas_query validate + canvas_view remove-annotation composite actions. Templates: src/server/operations/ops/query.ts, edges.ts, composites.ts, mcp.ts. Use git diff and read the files. '

const audits = await parallel([
  () => agent(AUDIT_BASE + 'HARDEN: wire-shape/denial fidelity — does validate.get return the exact validation body, and annotation.remove preserve the exact 404 message + success body and emit canvas-layout-update (mutates true)? no-arg / id shapes preserved? any CanvasAccess method deleted while still referenced? operations/ free of server.ts/index.ts imports?', { label: 'audit:harden', phase: 'Audit', agentType: 'pskoett-ai-skills:harden-auditor', schema: FINDINGS_SCHEMA }),
  () => agent(AUDIT_BASE + 'SIMPLIFY: dead code after deletion, orphaned imports/aliases, reimplemented vs delegated logic, new ops file placement.', { label: 'audit:simplify', phase: 'Audit', agentType: 'pskoett-ai-skills:simplify-auditor', schema: FINDINGS_SCHEMA }),
  () => agent(AUDIT_BASE + 'SPEC vs plan-008 Wave 1: exactly these 2 ops migrated (webview/open_mcp_app/refresh/etc NOT touched)? 2 composite actions added with auto-derived deprecation? tool names unchanged (freeze still 81, not edited)? guard tests untouched? legacy fully deleted? parity tests added? CHANGELOG updated?', { label: 'audit:spec', phase: 'Audit', agentType: 'pskoett-ai-skills:spec-auditor', schema: FINDINGS_SCHEMA }),
]).then((r) => r.filter(Boolean))
const findings = audits.flatMap((a) => (a && a.findings) ? a.findings : [])
log('Wave 1 audit: ' + findings.length + ' finding(s); critical/high: ' + findings.filter((f) => f.severity === 'critical' || f.severity === 'high').length)
return { implementation: impl, findings }
