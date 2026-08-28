export const meta = {
  name: 'registry-finish-wave2-batch',
  description: 'plan-008 Wave 2: migrate canvas_batch into a canvas.batch registry meta-op; delete the 290-line switch',
  phases: [
    { title: 'Implement', detail: 'batch meta-op + emit-suppression mechanism; delete executeCanvasBatch switch' },
    { title: 'Audit', detail: 'parallel harden/simplify/spec auditors' },
  ],
}

const SPEC = [
  'You are implementing plan-008 Wave 2 (the BATCH meta-operation — plan-005 item 9, the LAST and HIGHEST-RISK registry slice) in /Users/pepe/dev/pmx-canvas (branch refactor/v0.2-registry-finish, checked out).',
  'Read FIRST and THOROUGHLY: docs/plans/plan-008-registry-finish.md (Wave 2) and docs/plans/plan-005-operation-registry.md (item 9 batch notes + the array-preserving body reader). Then read the CURRENT batch implementation end to end: src/server/canvas-operations.ts executeCanvasBatch (the ~290-line switch) and resolveBatchRefs; src/server/server.ts handleCanvasBatch (the HTTP /api/canvas/batch route — its body reader + final emit); the canvas_batch MCP tool in src/mcp/server.ts; the SDK PmxCanvas.runBatch in src/server/index.ts. Also read the registry: src/server/operations/registry.ts (executeOperation + emitOperationEvent + operationContext), types.ts, http.ts, and an op template (ops/nodes.ts). CLAUDE.md guardrails apply.',
  '',
  'GOAL: convert batch into a canvas.batch registry meta-op that dispatches each entry through executeOperation, and DELETE the 290-line switch. This is byte-compatibility-critical and frame-count-critical — get it exactly right or STOP and report (do NOT force, do NOT edit guard tests).',
  '',
  'STEP 1 — emit-suppression mechanism in the registry (minimal core change).',
  'The current batch calls the core functions directly (addCanvasNode etc.), so it emits NO per-entry SSE events and the HTTP handler fires ONE final canvas-layout-update. Routing entries through executeOperation would instead fire each op as auto-layout-emit (mutates:true) PLUS each op handler ctx.emit (e.g. pin.set emits context-pins-changed, arrange/focus emit their events). That changes the SSE frame stream. To preserve current behavior (exactly ONE final canvas-layout-update for the whole batch, no per-entry frames), suppress ALL emits during the batch loop. Implement a depth-counted suppression in registry.ts, mirroring canvas-state.ts _suppressRecordingDepth: a module flag (counter) that makes emitOperationEvent(...) a no-op while > 0, and a helper to run a function with emits suppressed (and restore on finally, re-entrant-safe). Both the mutates auto-emit AND ctx.emit go through emitOperationEvent, so suppressing there covers both. Do NOT change behavior for non-batch ops.',
  '',
  'STEP 2 — the canvas.batch op (new file src/server/operations/ops/batch.ts, export an Operation array).',
  '- name canvas.batch; mutates:false (it emits ONE canvas-layout-update manually via ctx.emit at the very end — NOT via the mutates path, because it must fire once regardless of whether entries mutated).',
  '- http: method POST, path /api/canvas/batch, with a per-op readInput that preserves BOTH body shapes: a bare array [ {op, args, assign?}, ... ] AND an object { operations: [...] } (use the shared array-preserving readJsonValue; do not coerce). Match handleCanvasBatch exactly.',
  '- mcp: toolName canvas_batch; copy the current description + arg schema (operations array of {op, assign?, args}); formatResult plain JSON.',
  '- handler: replicate executeCanvasBatch semantics EXACTLY — iterate entries in order; for each, resolve $ref/assign against the running refs map using the SAME resolveBatchRefs logic (move it into batch.ts or import it if exported from canvas-operations without pulling server.ts); call executeOperation(entry.op, resolvedArgs) for each entry but with emits SUPPRESSED via the Step-1 mechanism (wrap the whole loop in the suppression helper); push each entry result into results[]; if entry.assign is a non-empty string, store the result in refs[assign]; on a thrown error, set failedIndex + error and STOP (do not continue) — matching current behavior; after the loop, emit ONE canvas-layout-update via ctx.emit; return the byte-identical envelope { ok, results, refs, failedIndex?, error? }.',
  '- CRITICAL result-shape parity: the per-entry result pushed into results[] must be IDENTICAL to what the current switch pushes (tests assert fields like results[i].id, results[i].url). The current switch pushes the CORE function outputs; executeOperation returns the op SERIALIZE output. VERIFY per op that these match (e.g. node.add serialize = buildNodeResponse; graph.add serialize includes url+spec). If any differ, that is a real risk — reconcile so the batch result entries stay byte-identical to today, or STOP and report the mismatch. Do not silently change result shapes.',
  '- All 11 batch op names already exist as registry ops: node.add, node.update, node.remove, graph.add, edge.add, group.create, group.add (group_nodes), group.remove (ungroup), pin.set (+ the legacy pin.add/pin.remove modes — map them to pin.set with the right mode, matching the current switch), snapshot.save, arrange. Verify each name resolves; if the current switch accepts an op-name alias the registry does not (e.g. pin.add/pin.remove), handle the alias in the batch handler before dispatch.',
  '',
  'STEP 3 — delete the legacy.',
  '- Delete executeCanvasBatch (the ~290-line switch) + resolveBatchRefs from canvas-operations.ts IF fully moved into batch.ts (keep resolveBatchRefs if other callers exist — grep). Delete handleCanvasBatch + its route from server.ts and the canvas_batch server.tool block from mcp/server.ts (now registry-served). The SDK PmxCanvas.runBatch stays public but should delegate to the batch op core / executeOperation (keep its public signature + the canvas-layout-update emit it does). CanvasAccess.runBatch: keep if still referenced; if it delegated to the SDK it can stay.',
  '- History: per-entry ops record their own mutation (executeOperation -> op handler -> canvas-operations -> mutation history). Confirm the resulting undo/redo history matches the current behavior (read canvas-operations.test.ts batch/history expectations). If the current batch recorded a single compound entry vs per-entry, PRESERVE whatever it does.',
  '',
  'HARD CONSTRAINTS: do NOT edit tests/unit/operation-parity.test.ts, mcp-tool-freeze.test.ts, mcp-server.test.ts — they are guards. operation-parity counts SSE frames, so a correct single-final-emit is mandatory. canvas_batch tool name + wire shapes byte-identical (freeze count stays 81). operations/ must not import server.ts/index.ts. No any/dynamic-import/defensive-noise. This is a ONE-COMMIT-REVERT slice — if you cannot make it byte-compatible + all guards green, STOP and report exactly what diverges rather than editing tests or forcing.',
  '',
  'VERIFY (iterate until green — run the FULL relevant set, batch touches everything): export PATH=$HOME/.bun/bin:$PATH && cd /Users/pepe/dev/pmx-canvas && bun run typecheck ; then PMX_CANVAS_DISABLE_BROWSER_OPEN=1 bun test tests/unit/operation-parity.test.ts tests/unit/mcp-tool-freeze.test.ts tests/unit/mcp-server.test.ts tests/unit/server-api.test.ts tests/unit/cli-node.test.ts tests/unit/canvas-operations.test.ts tests/unit/pmx-canvas-sdk.test.ts tests/unit/mcp-composites.test.ts 2>&1 | tail -14 . Then the FULL suite: PMX_CANVAS_DISABLE_BROWSER_OPEN=1 bun test tests/unit 2>&1 | tail -6 . Do NOT run git or Playwright.',
  '',
  'Update CHANGELOG [Unreleased] with a Changed entry (batch migrated to the canvas.batch registry meta-op; the 290-line switch deleted; executeOperation gained an internal emit-suppression used for the single final layout frame; wire shapes + tool name unchanged).',
  '',
  'RETURN: the emit-suppression design; the batch op (input shapes handled, ref resolution, envelope); per-entry result-shape parity findings (op-by-op: does executeOperation serialize == the old switch push?); legacy deleted (file + line delta, incl. the switch line count); op-name aliases handled (pin.add/remove); history behavior preserved; typecheck + targeted + FULL suite results; anything that diverged + how you resolved it (or why you stopped).',
].join('\n')

phase('Implement')
const impl = await agent(SPEC, { label: 'implement:wave2-batch' })

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
const AUDIT_BASE = 'Read-only audit of UNCOMMITTED changes in /Users/pepe/dev/pmx-canvas (branch refactor/v0.2-registry-finish) implementing plan-008 Wave 2 — converting canvas_batch into a canvas.batch registry meta-op (new src/server/operations/ops/batch.ts) with an emit-suppression mechanism in registry.ts, deleting the ~290-line executeCanvasBatch switch in canvas-operations.ts. Use git diff and read the files. This is the highest-risk slice (one-commit-revert). '

const audits = await parallel([
  () => agent(AUDIT_BASE + 'HARDEN: (1) emit-suppression is depth-counted + re-entrant-safe + restored on throw (finally), and never leaks suppression to non-batch ops; (2) EXACTLY one canvas-layout-update frame per batch (no per-entry frames; no double final emit) — this is what operation-parity counts; (3) per-entry result shape byte-identical to the old switch (the risk: executeOperation serialize vs old core-output push); (4) $ref/assign resolution + failedIndex/error stop-semantics identical; (5) bare-array AND {operations} bodies both work; (6) op-name aliases (pin.add/pin.remove) handled. Flag any divergence concretely.', { label: 'audit:harden', phase: 'Audit', agentType: 'pskoett-ai-skills:harden-auditor', schema: FINDINGS_SCHEMA }),
  () => agent(AUDIT_BASE + 'SIMPLIFY: the 290-line switch is actually deleted (not left dangling); resolveBatchRefs not duplicated if still importable; dead code / orphaned imports after deletion; the suppression helper is minimal, not over-built.', { label: 'audit:simplify', phase: 'Audit', agentType: 'pskoett-ai-skills:simplify-auditor', schema: FINDINGS_SCHEMA }),
  () => agent(AUDIT_BASE + 'SPEC vs plan-008 Wave 2 + plan-005 item 9: batch is now a registry op dispatching executeOperation per entry; the switch deleted; canvas_batch tool name + wire envelope {ok,results,refs,failedIndex?,error?} unchanged (freeze 81, not edited); operation-parity/mcp-tool-freeze/mcp-server NOT edited; SDK runBatch still public; history (per-entry vs compound) preserved; CHANGELOG updated. Did the agent STOP-and-report any divergence rather than forcing? Flag any guard-test edit.', { label: 'audit:spec', phase: 'Audit', agentType: 'pskoett-ai-skills:spec-auditor', schema: FINDINGS_SCHEMA }),
]).then((r) => r.filter(Boolean))
const findings = audits.flatMap((a) => (a && a.findings) ? a.findings : [])
log('Wave 2 (batch) audit: ' + findings.length + ' finding(s); critical/high: ' + findings.filter((f) => f.severity === 'critical' || f.severity === 'high').length)
return { implementation: impl, findings }
