export const meta = {
  name: 'registry-finish-wave5-folds',
  description: 'plan-008 Wave 5: deprecate add_html_node / add_html_primitive / refresh_webpage_node toward canvas_node (no mechanism)',
  phases: [
    { title: 'Implement', detail: 'confirm equivalence, deprecate 3 tools, parity tests, docs' },
    { title: 'Audit', detail: 'parallel harden/simplify/spec auditors' },
  ],
}

const SPEC = [
  'You are implementing plan-008 Wave 5 (the final fold) in /Users/pepe/dev/pmx-canvas (branch refactor/v0.2-registry-finish, checked out). Waves 1-4 are merged/committed.',
  '',
  'CONTEXT + THE KEY DISCOVERY (verify it, then act on it): plan-008 deferred three legacy tools — canvas_add_html_node, canvas_add_html_primitive, canvas_refresh_webpage_node — assuming a fold needs a NEW composite action (refresh / add-primitive) plus a per-action INPUT-INJECTION mechanism the composite layer lacks. That assumption is WRONG and you must NOT build that mechanism. The registry node.add and node.update ops ALREADY absorb all three behaviors via plain params:',
  '  - node.add (src/server/operations/ops/nodes.ts) shape ALREADY has html / primitive / kind / presentation / slideTitles / embeddedNodeIds / embeddedUrls / summary / agentSummary / description (lines ~677-688). Its handler routes type:"html" + primitive|kind -> createHtmlPrimitiveNode (line ~768) and type:"html-primitive" -> createHtmlPrimitiveNode (line ~760); bare type:"html" -> the normal html path (reads axCapabilities/strictSize off the loose body). It is a z.looseObject so extra keys (strictSize, axCapabilities) pass through.',
  '  - node.update shape ALREADY has refresh (line ~860) -> refreshCanvasWebpageNode (line ~575).',
  '  - The canvas_node composite (action "add" -> node.add, action "update" -> node.update) exposes those ops\' full inputShape+extraShape, so the params are already reachable as: canvas_node{action:"add",type:"html",...}, canvas_node{action:"add",type:"html",primitive:"<kind>",data:{...}}, canvas_node{action:"update",id,refresh:true}.',
  '',
  'FIRST verify the above by reading src/server/operations/ops/nodes.ts (nodeAddShape, the node.add handler html/html-primitive/webpage branches, createHtmlPrimitiveNode, the node.update shape + refresh branch) and src/server/operations/composites.ts (how canvas_node builds its add/update action schemas from the member ops — confirm primitive/kind/presentation/slideTitles/refresh are exposed). Also read the 3 legacy tool blocks in src/mcp/server.ts (canvas_add_html_node ~line 277, canvas_add_html_primitive ~line 327, canvas_refresh_webpage_node ~line 371) and the SDK methods they call (PmxCanvas.addHtmlNode / addHtmlPrimitive / refreshWebpageNode in src/server/index.ts). Read how legacy tools are currently deprecated: buildCompositeDeprecationNotes (composites.ts) + where notes get prepended to tool descriptions (operations/mcp.ts / composites). Read CLAUDE.md guardrails + docs/plans/plan-008-registry-finish.md.',
  '',
  'THEN, the SIMPLEST correct completion = DEPRECATE-ONLY (no new action, no new mechanism, no SDK/op change, no freeze-count change). Prepend a deprecation note to each of the 3 standalone tool descriptions in src/mcp/server.ts pointing at the existing canvas_node action (match the wording style of the auto-derived composite notes, e.g. "Deprecated: use canvas_node ..."):',
  '  - canvas_add_html_node      -> "Deprecated: use canvas_node with action \\"add\\" and type:\\"html\\". " + (keep the existing rich guidance text after the prefix).',
  '  - canvas_add_html_primitive -> "Deprecated: use canvas_node with action \\"add\\", type:\\"html\\", primitive:\\"<kind>\\" (and data). " + existing text.',
  '  - canvas_refresh_webpage_node -> "Deprecated: use canvas_node with action \\"update\\" and refresh:true. " + existing text.',
  '  If buildCompositeDeprecationNotes can be extended to register these manual tool->guidance entries cleanly (so the notes live in ONE place with the others), prefer that; otherwise a direct prefix on the 3 descriptions is fine. Do NOT change behavior, schemas, SDK methods, ops, or the freeze list (the 3 tools STAY registered, just annotated; canvas_node is already frozen). The 3 tools remain functional until v0.3 removal.',
  '',
  'IMPORTANT — do NOT: add a canvas_node "refresh" action, a canvas_render "add-primitive" action, an "add-html" action, any per-action input-transform / mapInput mechanism in composites.ts, or migrate these tools to new ops. The whole point of this wave is that none of that is needed. If during verification you find a param of a standalone tool that is genuinely NOT reachable via canvas_node add/update (a real equivalence GAP), STOP and report that gap precisely (tool, param, why) instead of working around it — do not bloat node.add or build a mechanism to close it.',
  '',
  'PARITY TESTS (this is the substantive proof — add to tests/unit/mcp-composites.test.ts, mirroring its existing head-to-head pattern that calls a composite tool and the legacy tool and compares results): for each of the 3, assert canvas_node achieves the SAME result as the standalone tool:',
  '  (1) canvas_node{action:"add",type:"html",html,title,presentation?,slideTitles?} vs canvas_add_html_node -> same node type/created payload (compare the stable fields; ignore non-deterministic ids/timestamps).',
  '  (2) canvas_node{action:"add",type:"html",primitive:"<a real kind>",data:{...}} vs canvas_add_html_primitive{kind,data} -> same primitive node (htmlPrimitive kind + type:"html"). Use a real HtmlPrimitiveKind (read html-primitives.ts / isHtmlPrimitiveKind for a valid kind).',
  '  (3) canvas_node{action:"update",id,refresh:true} vs canvas_refresh_webpage_node{id} -> same refresh result shape (incl. the ok:false/isError path parity). Create a webpage node first; the refresh hits the persisted URL — if that needs network, prefer a node whose refresh path is exercised without a live external fetch (mirror however server-api.test.ts / existing tests handle webpage refresh; if a live fetch is unavoidable, assert the result-shape parity on the error path rather than a live 200, and note it). DO NOT introduce a flaky live-network test.',
  '',
  'DOCS: update docs/mcp.md (note the 3 tools are deprecated -> canvas_node actions; keep the tool list/counts correct — NO count change), CHANGELOG [Unreleased] (Deprecated: the 3 tools now point at canvas_node; note no new action/mechanism was needed), and docs/plans/plan-008-registry-finish.md (reverse the "fold deferred" verdict for these 3: record that node.add/node.update already expose the params, so the fold is deprecate-only and the per-action injection mechanism was unnecessary; mark Wave 5 DONE; set the plan Status to Complete and note the only remaining legacy is canvas_snapshot (v0.3 name collision) + canvas_screenshot (binary, intentional standalone)).',
  '',
  'VERIFY (iterate until green): export PATH=$HOME/.bun/bin:$PATH && cd /Users/pepe/dev/pmx-canvas && bun run typecheck ; then PMX_CANVAS_DISABLE_BROWSER_OPEN=1 bun test tests/unit/mcp-composites.test.ts tests/unit/mcp-tool-freeze.test.ts tests/unit/mcp-server.test.ts 2>&1 | tail -12 ; then the FULL suite: PMX_CANVAS_DISABLE_BROWSER_OPEN=1 bun test tests/unit 2>&1 | tail -6 . NOTE: tests/unit/server-api.test.ts has a PRE-EXISTING network-dependent test (diagram-in-place hits live mcp.excalidraw.com) that can transiently time out — if the ONLY full-suite failures are in server-api diagram/ext-app tests, re-run server-api.test.ts in isolation to confirm green; do not attribute that to your change. Do NOT run git or Playwright.',
  '',
  'RETURN: confirmation (with file:line) that node.add/node.update + canvas_node add/update already expose html/primitive/kind/presentation/slideTitles/refresh; the 3 deprecation notes added (verbatim) + where; whether you centralized them via buildCompositeDeprecationNotes or prefixed directly; the 3 parity tests added (and how the webpage-refresh one avoids live-network flake); any genuine equivalence GAP found (or "none"); confirmation that NO new action / mechanism / op / SDK change / freeze change was made; docs/plan/CHANGELOG updates; typecheck + targeted + FULL suite results.',
].join('\n')

phase('Implement')
const impl = await agent(SPEC, { label: 'implement:wave5-folds' })

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
const AUDIT_BASE = 'Read-only audit of UNCOMMITTED changes in /Users/pepe/dev/pmx-canvas (branch refactor/v0.2-registry-finish) implementing plan-008 Wave 5 — deprecating canvas_add_html_node / canvas_add_html_primitive / canvas_refresh_webpage_node toward existing canvas_node add/update actions (deprecate-only: NO new action, NO new mechanism, NO op/SDK/behavior/freeze change). Use git diff and read the files. '
const audits = await parallel([
  () => agent(AUDIT_BASE + 'HARDEN/PARITY: are the parity tests REAL proof that canvas_node add(type:html)/add(type:html,primitive)/update(refresh:true) produce the same result as the 3 standalone tools (not vacuous/over-loose assertions)? Is there any param of a standalone tool (presentation, slideTitles, embeddedNodeIds, strictSize, axCapabilities, html-primitive kind/data, webpage refresh url + ok:false/isError path) that is NOT actually reachable/equivalent via canvas_node — i.e. a silent equivalence gap the deprecation note would mislead users into? Did the webpage-refresh parity test introduce live-network flakiness?', { label: 'audit:harden', phase: 'Audit', agentType: 'pskoett-ai-skills:harden-auditor', schema: FINDINGS_SCHEMA }),
  () => agent(AUDIT_BASE + 'SIMPLIFY: did the agent stay deprecate-only? Flag ANY new composite action, any per-action input-transform / mapInput mechanism, any new op, any SDK/op behavior change, any freeze-count change, or any speculative abstraction — none of that should exist. Also flag dead code or redundant deprecation wiring.', { label: 'audit:simplify', phase: 'Audit', agentType: 'pskoett-ai-skills:simplify-auditor', schema: FINDINGS_SCHEMA }),
  () => agent(AUDIT_BASE + 'SPEC vs plan-008 Wave 5: the 3 tools carry accurate deprecation notes pointing at the correct canvas_node action+params; the notes are correct (e.g. html-primitive really is type:"html"+primitive, refresh really is action update+refresh:true); freeze list unchanged (3 tools still registered); operation-parity/mcp-server not edited beyond what is needed; docs/mcp.md + CHANGELOG + plan-008 updated (plan Status -> Complete, verdict reversal recorded, only canvas_snapshot + canvas_screenshot remain). Flag any guard-test edit or count drift.', { label: 'audit:spec', phase: 'Audit', agentType: 'pskoett-ai-skills:spec-auditor', schema: FINDINGS_SCHEMA }),
]).then((r) => r.filter(Boolean))
const findings = audits.flatMap((a) => (a && a.findings) ? a.findings : [])
log('Wave 5 (folds) audit: ' + findings.length + ' finding(s); critical/high: ' + findings.filter((f) => f.severity === 'critical' || f.severity === 'high').length)
return { implementation: impl, findings }
