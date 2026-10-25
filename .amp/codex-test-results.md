# PMX Canvas 0.10.0: Amp release verification and skill audit

**Completed with reruns and unresolved intermittent browser failures. Not a clean release-wide pass.**

Source gates, consumer contracts and actual Amp acceptance were executed. The original
registry portal aggregate remains red: two browser assertions passed only on isolated
rerun, with causes unresolved; six other failures were corrected harness setup. The
dependency advisory and skill guidance/packaging findings remain. No reproducible new
functional product regression was confirmed in the exercised paths.

Requested scope: full applicable [version-testing protocol](pmx-canvas-version-testing-protocol.md),
actual Amp portal/native acceptance and bundled-skill audit. Previous baseline:
`pmx-canvas-0.9.3-report.md` (local baseline, not included in this publication).
Existing personal changes are preserved.

## Release identity

- Registry latest/exact version: 0.10.0, queried 2026-10-24.
- Revision: [4a5040c](https://github.com/pskoett/pmx-canvas/commit/4a5040cc5efc62b5abf2ca16792b3720abf5fd48).
- [Release](https://github.com/pskoett/pmx-canvas/releases/tag/v0.10.0), published 2026-10-24T17:30:12Z.
- Registry workspace `/home/user/workspace/pmx-canvas-0100-review`, reserved port 4441.
- Source checkout `/tmp/pmx-canvas-0100-src`; separate disposable consumer/migration fixtures.
- Pinned Bun 1.4.4 / Node 24.22.1. Heavy browsers run serially under a 3 GiB workload limit.
- Evidence `/tmp/pmx-0100-evidence/`; each gate preserves command, result and original failures.

## Gate ledger

| Gate | Status | Evidence |
|---|---|---|
| Exact release available | Passed | registry.json, release.json |
| Registry installation | Passed | npm install --save-exact pmx-canvas@0.10.0 --prefer-online; exit 0, 323 packages |
| Registry integrity and package-file audit | Passed | Tarball SHA-512 and all 805 installed files match, checked twice |
| Source coverage/build/typecheck/lint/unit/client/browser | Passed with nested-runtime caveat | 1,546 unit, 332 client, 333 browser; corrected pinned SDLC case passed separately |
| CLI E2E/release smoke/pack/declaration freshness | Passed | Source named gates exit 0; 805-file pack; declarations and guidance twins match |
| Exact-SHA CI | Passed with browser retry | Test 40114364962: 332 passed + one flaky; Publish 40115829001 success |
| Public CLI/HTTP/MCP/SDK | Passed with harness reruns | Consumer attempt ledger, 84 recorded attempts |
| Migration, persistence, backups and timer | Passed | Genuine 0.9.3 upgrade, 0.8.2 conversion, 48 initializers/WAL, actual timer and restored blob/snapshots |
| Lifecycle/read truth/safety/pump/stress | Passed with harness rerun | Clocks, context race, four-transport copy, pump, deleted-receipt replay, 320 cards |
| 0.10.0 hardening contracts | Passed in consumer scope | 25 schemas/annotations, 243 pairing controls, 102 help details, cancellation/subscriptions on both stdio paths |
| Actual public portal identity | Passed | Public/local health agree on 0.10.0, workspace, healthy persistence; initial board empty |
| Registry browser suite | Failed aggregate; eight isolated reruns passed | 324 passed / eight failed; six setup failures corrected, two unresolved intermittent assertions; separately seeded SDLC 1/1 passed |
| Documents/export/renderers/themes/nested host | Passed with capture/selector corrections | 14 supplemental cases, PDF 1, keyboard 1, nine-theme case 1; 16 renderer cases at each of 600/1440 |
| Native Amp discovery | Passed after human approval | reload_mcp connected with 25 tools; native help exposes 102 operations |
| Native Amp pin/steer/edit/ack | Passed with native-call harness correction | Addressed delivery, wrong-recipient negative, revision-checked edit, inspected result before ack; whole-board pin after board switch |
| Native WebView | Passed, Chrome only | Native start/evaluate/resize/screenshot/stop/status; cached test-owned Chrome process stopped separately |
| Skill structure/portability/drift/contract audit | Completed with findings | 17/18 validators pass; all 40 resource digests match; personal main mirrors stale |
| Cleanup and review board | Passed | Final board validates, SQLite integrity OK, schedule off; test browsers/sessions stopped, review service retained |

## Release claim matrix

| Claim | Discriminating check | Status |
|---|---|---|
| Breaking: SDK getTour envelope | saved/derived tour via .tour.stops; HTTP/MCP parity | Passed consumer |
| Breaking: SDK wait cancellation rejects | approval/elicitation/mode cancellation vs pending timeout | Passed consumer |
| Breaking: resource subscriptions explicit | subscribed/unsubscribed clients, reconnect/resubscribe, reads still work | Passed standalone and attached stdio; no automatic native-host subscription claim |
| Breaking: AX interaction denial isError | native error path and positive control | Passed raw consumer and native Amp: 403 ax-disabled, no denied work item, enabled control creates exactly one |
| Structured MCP results and effect annotations | output schema validation, structured/text agreement, native host consumption | Consumer passed; native read/help consumed successfully |
| Cooperative cancellation/progress | waits/web fetch/batch, retained completed writes and partial receipts | Passed consumer within supported-operation scope |
| Resource updates do not count as reads | notification/read-status negatives plus explicit-read positive | Passed consumer |
| canvas_help operations and schemas | discovery/detail/invalid operation; no board or read-status changes | 102 details and no DB/listener creation passed; native help/error path passed |
| Shared output-schema definitions | exact catalog bytes and equivalent validation, no token/latency inference | 243 valid/invalid pairing controls passed; native discovery works |
| Minimap toggle dismisses Settings tooltip | pointer plus keyboard focus and neighboring-control recording | Passed at 600/1440; focus returns to Settings, tooltip disappears, minimap toggles; recordings inspected |

## Carryovers and boundaries

- Narrow Markdown, script-only hosted forms and simultaneous-session cases passed in this run.
- Previous coverage timeout/fixture failures did not recur; their causes are not established.
- Low-severity KaTeX advisory remains; shipped compact AX-state guidance is correct, personal mirrors stale.
- Native Copilot/WebKit, physical mobile, remote MCP reconnect, successful OCR, scored model
  evals and long-duration soak require distinct evidence and are not implied by other passes.
- Testing did not change product code or publish a release. Subsequent publication approval
  covers this report and the skill audit only.

## Skill audit

[Detailed skill audit](pmx-canvas-0.10.0-skill-audit.md), with reproducible evidence in
`/tmp/pmx-0100-skill-audit/`. All findings below are guidance, packaging or local conventions,
not demonstrated product-runtime defects.

- All 18 bundled skills audited: 17 pass the unchanged structural validator; `data-analysis`
  fails for unsupported custom frontmatter keys, also present in 0.9.3.
- All 40 manifest resources match their filesystem sizes and hashes, totaling 523,944 bytes.
- Main guide is 868 lines, up from 863 and above this repo's 600-line convention.
- Five main-skill mirror paths differ in the same four files; all testing mirrors match.
  OpenCode aliases the Agents directory. Dirty copies were preserved, not synced.
- Stale personal guidance still says 24 tools, omits `includeContext:false`, and has two broken
  portable links. Shipped guidance fixes those issues. Upgrade instructions should explicitly
  require reviewing local edits before full-tree `skills sync --yes` replacement.
- Tour eval case 22 overstates viewer isolation. Shared tour navigation/exit is not the same
  as isolated deterministic recording; this is a pre-existing eval-definition issue.
- The bundled published-consumer helper depends on unshipped examples and manually assembles
  an incomplete package substitute. Its installed-consumer referral needs correction.
- Two secondary skills point to absent LICENSE.txt files; data-analysis has a nonportable
  cross-skill filesystem reference. These are unchanged from the previous package.
- 53 eval definitions were inspected, not executed or scored. Existing native Amp boundary
  cases are present; dedicated new hardening reasoning cases are absent.

## Setup evidence and recoveries

- [Live 0.10.0 portal](https://t-03grk52mildwpprueyugo9mfl-p25654.onamp.dev/).
- Supervised service `pmx-canvas-0100` uses absolute Bun and installed CLI paths. The portal
  was registered separately on actual port 4441; local and public health were verified.
- Old 0.9.3 service stopped, data preserved. Native configuration targets the new workspace.
  Initial reload/doctor awaited approval; later doctor connected and reload discovered 25 tools.
  The agent did not perform trust approval or move configuration to bypass it.
- Browser harness uses installed source/assets plus exact-release tests outside node_modules.
  Source-only examples and tsconfig are obtained from the exact revision, not claimed shipped.
- Initial discovery failed before any tests because the adapter fixture directory was missing.
  Restoring the exact fixture and linking it into the review cwd yielded 333 discovered tests.
  Separate `discovery` and `discovery-complete` logs/exits retain the failure and recovery.

## Registry consumer results

Detailed evidence: `/tmp/pmx-0100-consumer-results.md` and
`/tmp/pmx-0100-consumer-evidence/attempt-ledger.json`. No functional product regression was
confirmed in these exercised paths. Five harness/setup failures remain alongside corrected
runs: catalog-registration parser, SDK port ownership, an overstrict cancellation-receipt
object and two malformed intent fixtures. No product or rejection assertion was weakened.

- 25 tools with output schemas and four boolean effect annotations; 243 schema-pairing
  controls reject cross-pairs, missing fields, invalid types and fake success envelopes.
- Representative successes compare retained text and structured data. App/build and screenshot
  schemas were checked, but their successful external-helper/image branches were not run here.
- 18 manifests, 40 skill files / 523,944 bytes match delivered bytes and digests. All 51 ordinary
  listed resources were separately read and digest-recorded.
- All 102 operation-help details work; private/removed/unknown operation names reject. The
  metadata-only sequence creates neither a database directory nor a listener.
- All three SDK waits reject cancellation with AbortError while timeout remains pending.
  Local/HTTP invokers and standalone/attached MCP show progress and abort real withheld-header
  and partial-body webpage I/O, without late writes. Completed writes remain persisted.
- Cancelled MCP wire promises do not deliver a final receipt because the MCP SDK suppresses
  responses after abort. Local/HTTP results and ordinary partial-error MCP calls separately
  prove receipt/reference retention. Do not promise receipts to a disconnected/cancelled caller.
- Subscriptions are per connection and URI, require explicit resubscription after reconnect,
  and do not record content reads. Unsubscribe and explicit-read positive controls passed.
- Genuine upgrades preserve asymmetric boards, folders, IDs, README, pins and snapshots;
  legacy folder conversion, 48 concurrent initializers and held-writer WAL reads passed.
- Actual timer and manual backups each retain 23 boards, eight snapshots and one blob.
  Restored blob bytes/hash and snapshot usability pass. Eight final database integrity checks pass.
- Eight concurrent writers created 320 cards. Sixteen bounded health/validation samples pass;
  roughly 32 seconds of sampling is not long-duration soak evidence.
- Supplemental npm audit exits 1: low-severity KaTeX GHSA-238p-pmpm-9mq7 through Mermaid,
  represented by three affected package entries. No exploit or dependency fix performed.
- Consumer services/processes stopped, schedules off, ports 4443/4445/4447/4448/4449 closed.

## Native discovery observations

Native board reads and `canvas_help` consume structured results through Amp successfully.
Help lists 102 operations and supplies node.add's callable `canvas_node` schema with required
`type` and `action`. Invalid operation names throw through Amp, including `.raw`; a caught
negative control confirms that error boundary. Home context correctly refuses until a board
is open. These are expected denials, not test failures or successful context reads.

An initial whole-response equality check around help was unsuitable: consecutive board.list
calls alone also advance catalogRevision. Board generation and empty board identities stay
unchanged. The consumer's no-DB/no-listener help test is the stronger side-effect discriminator.

## Source gates and exact-revision CI

Full source evidence: `/tmp/pmx-0100-source-results.md`, `/tmp/pmx-0100-source-evidence/`.
Frozen install, coverage, `release:check`, CLI E2E, release smoke, pack and declaration
freshness all exited 0. Coverage ran before browser fixtures: 1,546 passed, 67.51% lines
and 73.95% functions, above the 60%/64% floors. The aggregate passed 1,546 unit, 332 client
and 333 browser cases (270 desktop plus 21 each at 600/1024/1920). Lint had no errors,
55 warnings and 12 infos. Pack contains 805 files, 33.76 MB unpacked.

Ten supplemental direct SDK/MCP claim checks pass. Unchanged checks against 0.9.3 give
seven expected failures and three passing timeout controls, establishing discrimination.
All nine changelog bullets map to exact tests in the source report. Discovery measures
25 tools / 138,537 UTF-8 JSON bytes; that is not a token or latency measurement.

The nested published-consumer fixture escaped PATH pinning: its `bash -lc` resolver
selected Bun 1.3.10 rather than 1.4.4 because BUN_BIN was unset. The unchanged SDLC
browser case passed again against an explicitly pinned supervised source fixture.
The full aggregate was not repeated; this is not a clean entirely pinned first run.
The parent's registry wrapper sets BUN_BIN and runs its own installed-package fixture.

Hygiene initially failed on test-generated tracked SDLC HTML. Both versions/diff were
preserved; restoring only that generated file made the identical check pass. The media
integrity helper initially let ffmpeg consume loop stdin; the `-nostdin` correction
validated four archives and fully decoded five videos. Source checkouts finish clean.

[Test CI](https://github.com/pskoett/pmx-canvas/actions/runs/40114364962) succeeded with
**332 browser passes plus one flaky retry**. Receipt Undo/unpin initially hit
`route.fulfill: Route is already handled!`; the same case passed locally without retry.
No root cause is established. CI uploaded coverage only, leaving the named first-failure
browser media unavailable. Windows ran 1,525 passes and 21 skips; macOS ran 1,546 passes.
[Publish CI](https://github.com/pskoett/pmx-canvas/actions/runs/40115829001) succeeded at
the exact revision. These are independent CI results, not local platform execution.

Actual browser is Chrome 152.0.7977.64, not Playwright's declared Chromium 145. Existing
symlinks were inspected, not replaced. OOM counters did not increase. Source services and
ports 4450/4451/4513 are closed. The old 0.9.3 coverage failure did not recur, without
proving its cause or eliminating possible intermittency.

## Registry portal aggregate and isolated reruns

`run-portal.sh full-file-selected` ran 332 exact upstream cases against the public portal:
**324 passed / eight failed**, exit 1. The published-consumer SDLC case requires separate
seeding and was intentionally not in this aggregate. All 63 reference-width cases passed.
Original logs and artifacts remain in `/tmp/pmx-0100-evidence/full-file-selected.*` and
`/tmp/pmx-0100-portal-full-file-selected/`.

Six failures were missing `src/cli/index.ts` in the review process cwd: both Source-save
daemon-restart cases and four recording cases. A symlink to the exact installed-byte
harness source corrected the setup. All six unchanged tests passed afterward.

Two failures were actual browser assertions: the high-degree reference footer retained
scrollTop 3019 after Home instead of returning to zero; lifecycle review did not show
the expected Fast-policy warning after reloading revisions. Both passed unchanged in
the isolated eight-case rerun. Root causes remain unresolved; this does not establish
either a reproducible product regression or a purely environmental cause.

`run-portal.sh failed-case-rerun --project=desktop --grep ...` passed **8/8**, exit 0.
Its independent output directory preserves the original failures. No product code or
assertion was changed, and the complete aggregate was not rerun.

## Supplemental portal protocol

All commands below use `scripts/canvas-release/0.10.0/run-portal.sh` and unique attempt
directories. The package server/bundle was not rebuilt or patched. Tests/examples come
from the exact source revision where they are not shipped in the registry package.

| Attempt | Result and scope |
|---|---|
| `supplemental-protocol` | 14/14: minimap at 600/1440, actual Office extraction, cancellation/wrong-board refusal/export privacy, truthful unavailable OCR, hosted forms with and without allow-forms, long Markdown, nested srcdoc/AX writeback, five node-type pin controls |
| `renderers-600`, `renderers-1440` | 16/16 each; all creatable node types, inline/reloaded/expanded captures where supported |
| `sdlc-seed`, `seeded-sdlc` | Pinned Bun seed exited 0; original published-consumer browser case 1/1 passed against installed registry package and public portal |
| `review-pdf` | 1/1: real two-page PDF, exact retained bytes, actual extraction, reviewed 17/43/28 values and final sentinel, provenance/reload/no-overlap |
| `group-keyboard` | 1/1: group navigation stop, expansion focus and restoration |
| `themes` → `themes-selector-corrected` | First attempt failed on ambiguous data-node-id matching both card and pinned chip. Scoping to `.canvas-node` retained assertions; rerun 1/1 across all nine themes |
| `graph-painted-capture-selected` | 1/1: corrected capture waits for actual expanded graph bar geometry; inspected bars show One=12 and Two=18 |

The first graph-expanded capture caught axes before the bars painted, despite the
fixed 350ms delay. It was not accepted as visual proof. Waiting for rendered bar geometry
produced the correct inspected capture without product changes. A preceding attempt
used an over-anchored grep and discovered no tests; that exit 1 is also retained.
Small contact sheets made sparse ledger/JSON fixtures look empty; full-resolution
inspection confirmed their expected values/text. Empty group placeholders are intentional.

The SDLC seed used a newly created disposable board. The managed review service was stopped
while the SDK owned port 4441, then restarted with absolute Bun 1.4.4 and the installed CLI.
Both local/public health were awaited before the unchanged browser case. Native MCP was
reloaded after restart. This is registry consumer evidence, not a locally packed substitute.

Inspected minimap recordings show a moving pointer over neighboring Theme/Snapshots controls,
the Minimap tooltip, click dismissal, and keyboard reactivation/dismissal. The unrelated
agent-presence label is not a stuck Settings tooltip. Nine theme captures show the complete
review card and both evidence links. Actual nested iframe writeback persisted in AX state;
this is a synthetic MCP Apps host in the Amp orb, not native Copilot acceptance.

## Native Amp acceptance

Actual native calls used Amp's discovered `canvas-release-test` server, source/consumer
`amp-release-test`, on the same workspace and board as the public portal.

1. Browser pinned `node-mvmslu1q-nqth` on review board `board-mvmsltzk-oym4`.
   Native context returned `reason: pinned`; a full node read returned content revision 1.
2. Browser enabled Agent sessions (Beta), selected the explicit recipient, and submitted
   `NATIVE-0100-COBALT`. Wrong recipient `amp-0100-wrong-recipient` did not receive it.
   Correct consumer received message `steer-mvmsnom3-ld4n4p` with matching target.
3. Native intent-linked edit used expectedBoardId and expectedContentRevision, preserving
   the original text and appending `Native Amp loop verified: North 19, South 47.`.
   The first harness call incorrectly read the intent ID at data.id instead of data.intent.id
   and stopped before mutation. Corrected envelope access reused the same intent identity;
   the edit then succeeded. No rejection/precondition was removed.
4. Browser DOM and `native-before-ack.png` were inspected before native acknowledgement.
   The sentence was visible and unclipped. Mark succeeded; the next claim excluded that
   exact message. Four unrelated synthetic import broadcasts were not falsely acknowledged.
5. Browser pinned the whole review board. Native context while a different board was open
   returned its README and pinned card with `reason: pinned-board`. A malformed CSS quote
   in the first pin command was corrected using the observed accessible button name.
6. Native help guided an HTML-node creation on the controls board. AX-disabled interaction
   threw a native 403 `ax-disabled` error, including through `.raw`. Enabling only
   `ax.work.create` produced exactly one allowed work item and no denied item in AX state.
7. Native WebView Chrome start, expression evaluation, resize to 1200×900, screenshot,
   stop and inactive status passed. Evaluation returned five nodes, visible document and
   the native verification text. This backend capture is DPR1; portal captures are DPR2.
   Stop left Bun's cached Chrome process alive; its confirmed test-owned PID was terminated
   separately. No Linux WebKit or native Copilot result is implied.

Review board was restored and only the test-owned presence detached. This demonstrates
active native-agent polling and action, not idle-thread wake-up, an installed continuous
pump, automatic import-agent launch, automatic resource subscriptions or native Skills
activation. Stdio reconnect/resubscribe consumer coverage is not remote/native-host
reconnect acceptance.

## Protocol mapping, limits and delivery

| Protocol area | Evidence |
|---|---|
| Sections 0–1, source/registry/host separation | Exact revision/toolchain/workspace, source named gates, 805-file integrity audit, actual portal/native identity |
| Sections 2.1–2.4, carryovers/changelog/exploration | Claim matrix; retained intermittent failures; all 333 upstream browser cases executed across the aggregate and separately seeded SDLC case, not a green combined aggregate |
| Section 2.5, documents/library/migrations/backups | Genuine upgrade and legacy conversion, actual PDF/Office extraction, original-byte retention, export variants, timer restore and DB integrity |
| Section 2.6, connected memory/lifecycle/host | Consumer clocks/safety/races, portal forms/receipts/drafts/tours, whole-board/native card pin loops |
| Amp host acceptance | Public portal, 600/1024/1920 reference projects, additional 600/1440 captures, nine themes, native loop and retained review board |

Not claimed: successful OCR, physical mobile, native Copilot/Windows/WebKit, exhaustive
transport combinations, remote/native-host reconnect, automatic native subscriptions,
scored agent evals, long-duration soak, all external build/OCR/helper success branches,
or guaranteed latency/token savings. Windows/macOS CI is separate from local host testing.

Final board has five nodes, two contained PDF cards, zero collisions/containment violations,
no missing edge endpoints and no size warnings. SQLite integrity is OK; backup schedule
is off. Snapshot `snap-mvmsvs4y-c472` retains the final review. Final public health reports
0.10.0 and the intended review workspace, with healthy persistence. Cgroup OOM counters
remain at baseline (2 / 21 / 2); no new OOM was observed.

Portal media integrity: nine trace archives passed ZIP/JSON checks and all 14 stored videos
(14 unique contents) fully decoded. Evidence: `portal-media-integrity.txt`. Source and
consumer raw evidence remains separately identified above. Screenshots/recordings for review
are under `.amp/in/artifacts/pmx-canvas-0.10.0/`, including `review-final.png`,
`native-before-ack.png`, `native-webview.png`, nine `theme-*.png` and both minimap MP4s.

Test browsers and source/consumer services are stopped; only the managed review service,
its portal and the native MCP connection intentionally remain. Existing skill edits and
old work were preserved. Publication includes this report and the skill audit only.
Harnesses, raw evidence, media and other personal changes remain outside this report commit;
orb-local evidence paths are not files available from the repository. No product code,
release or dependency was changed.

---

## Independent GitHub Copilot verification, 25 October 2026

**Status: in progress, not a release pass.** Amp's evidence above is preserved.
This is a new independent run, not a reclassification of earlier results.

### Identity and gate ledger

Latest registry release is **0.10.0**, revision
`4a5040cc5efc62b5abf2ca16792b3720abf5fd48`.
Both global npm prefixes were updated first. PATH selects
`/opt/homebrew/bin/pmx-canvas`, now 0.10.0; Bun 1.4.4, Node 24.22.1.
Personal `main` safely fast-forwarded `c043c796 → 42b22f86`, bringing in
Amp's report and skill audit without replacing unrelated local work.
Package-owned skill mirrors were synchronized and the check reports `ok: true`.

Evidence root:
`/Users/pepe/.copilot/session-state/af6d04ae-7428-4904-b6b0-3722c63b8d9d/files/pmx0100-copilot-20261025`.
Evidence is local, not included in this report. Source, registry consumer and
native host results remain independent.

| Gate | Initial status | Expected evidence |
|---|---|---|
| Exact source frozen install | not tested | immutable archive, install log and exit |
| Source coverage | not tested | unit counts and measured thresholds |
| Source release:check | not tested | build/typecheck/lint/unit/client/full browser with pane projects |
| Source CLI E2E, packed smoke, pack inspection | not tested | individual commands/logs/exits |
| Exact registry install and public transports | not tested | separate npm installation; CLI/HTTP/fresh MCP/SDK |
| Registry full browser replay | not tested | unchanged tests with correct cwd, DB and installed MCP CLI |
| Persistence, migration, real timer backups | not tested | independent disposable databases and actual file observations |
| Documents, exports and renderer regression | not tested | real extraction, consent, bytes/provenance, offline output |
| Native Copilot actions and steering | not tested | actual extension actions, correct target, active-turn receipt without manual submission |
| Native Copilot rendering | not tested | actual host evidence only, never inferred from Chrome |
| Cleanup | not tested | schedules disabled, owned services stopped, retained DBs valid |

### Claims to verify

| Release claim | Planned discriminator | Initial status |
|---|---|---|
| 0.10.0 SDK tour envelope | `.tour.stops`, derived and saved controls | not tested |
| SDK wait cancellation | all three waits reject cancellation, timeout remains pending | not tested |
| Explicit resource subscriptions | independent clients, unsubscribe and reconnect/resubscribe; no false reads | not tested |
| AX denial is a tool error | `isError: true`, no denied mutation, enabled positive control | not tested |
| Structured results and annotations | fresh catalog, output validation and text agreement | not tested |
| MCP cooperative cancellation | supported waits/I/O and retained completed writes | not tested |
| canvas_help | operation discovery/detail/errors without board mutation | not tested |
| Shared discovery schemas | valid/invalid instance validation, no token-saving inference | not tested |
| Minimap Settings tooltip | pointer/keyboard dismissal with focus retained | not tested |
| 0.9.3 narrow Markdown fix | reproduce old overlap at 600 px, wide control | not tested |
| Script-only hosted forms | actual Save with unchanged script-only sandbox | not tested |
| Startup session race | active and ended sessions resist delayed reads | not tested |
| Copilot steering fix | all three sends request immediate mode; native receipt must not require manual send | not tested |
| Camera/tour performance | no card geometry rewrite or content-load side effect | not tested |
| Markdown parsing/cache | saved target/image preservation and no redundant parse | not tested |
| Lifecycle read scope | no unrelated-board hydration or full audit-history sweep | not tested |

Prior initial harness errors are not to be repeated intentionally: registry
fixtures must run inside the verified daemon workspace, use its actual DB
path, and explicitly select the installed `--mcp-app` entry point. First
failures and corrective reruns will be retained separately.

### First independent results

- Exact-source frozen install and coverage passed initially: **1,546 unit
  tests, zero failures**, **66.78% lines / 64.65% functions**. The aggregate
  `release:check` has reached its **333-case** browser stage; no final exit
  is available yet.
- Global and clean-registry installed smoke both passed **4/4**. The global
  consumer uses verified workspace `workspace` on **4533**, PID **18411**;
  independent registry consumer uses `registry-workspace` on **4535**,
  PID **18748**. The SDK's own 4534 service stopped after each check.
- Public CLI/HTTP/fresh MCP checks passed **18/18**, including current
  **25-tool** discovery, background write guards, idempotency, qualified graph,
  folder search, wiki binding, versioned review and full-read truth.
  All **18 skill manifests / 40 resources / 523,944 bytes** passed digest
  and size checks. Evidence: `consumer-results.json`.
- Installed SDK baseline passed **8/8**. New tour envelope and all three
  cancellation-versus-timeout contracts passed **8/8** after correcting a
  fixture that initially omitted `stop.target`. The rejected fixture is
  preserved, not counted as a product failure. Evidence:
  `sdk-results.json`, `sdk-breaking-results{,-attempt-1}.json`.
- MCP hardening passed **15** checks: all advertised schemas reject empty
  envelopes; all **102** help details resolve with validated successful
  structured/text agreement; unknown help errors; help does not alter board
  identities or content-read state; AX denial is a real tool error with no
  work created and an enabled positive control; subscriptions are explicit,
  client/URI-scoped, stop on unsubscribe and require resubscription after
  reconnect; notifications do not record reads; an attached MCP approval
  wait cancels while the actual gate stays pending.
- The first two hardening attempts incorrectly required success-schema
  `structuredContent` on the deliberate AX denial. That standalone tool
  intentionally returns text plus `isError: true` for failures. The corrected
  harness preserves this documented shape and all original attempts.
  A later recording-only correction copies notification arrays before they
  are cleared. Evidence: `hardening-results.json`, attempt logs and
  `hardening-interaction-{denied,allowed}.json`.

### Carryover fixes, documents and persistence

The old narrow-Markdown fixture now passes at **600 and 1440 px**:
the actual `149` text range hits a paragraph rather than Source. At 600 px
its y-coordinate is 688, clear of the action footer. Evidence:
`occlusion-results.json`, paired screenshots. This independently verifies
the old **0.9.2-A** reproduction, not every possible layout.

The exact installed MCP app now saves the lifecycle override under the
unchanged **`allow-scripts`** sandbox. Its extra-`allow-forms` control also
persists cadence 7. This independently closes the representative lifecycle
reproduction of **0.9.2-B**; the other form variants await suite results.
Both profiles still log the previously observed sandbox localStorage error.
No same-origin permission was added. Evidence: `hosted-form-results.json`.

Actual PDF and DOCX import/review/export checks passed **26/26**. The
unchanged synthetic original documents from the previous cycle retain
19/47/83 and `END-DOCUMENT-COPILOT-092`; they were copied as input fixtures,
not represented as newly authored 0.10.0 documents. Extraction was executed
again with pdftotext/pandoc, original SHA-256 matched, visible consent and
review committed, wrong-board/cancel controls refused, reload retained
imports, all four export-consent combinations matched, and offline HTML
rendered. Evidence: `document-results.json`.

A fresh registry **0.9.2 → 0.10.0** workspace upgrade passed **9** checks,
including asymmetric boards, folders, IDs, content, README, pins and old
snapshot restoration. Bounded **100-card / 20-update** concurrency,
large-body backup restoration and recovered snapshot restoration passed.
The large body is **40,047 characters**. A one-minute timer is configured;
actual backup-file observation and disabling remain pending.
Evidence: `migration-results.json`, `stress-backup-results.json`.

### Native Copilot status

The existing `pmx-release-native` panel now points at the verified
**4533 / 0.10.0** workbench. Actual status and pinned-context actions returned
the correct fresh workspace and `COBALT-0100-WAITING`. Native `add_work_item`
created `work-mvnk9emd-l30shc` for this cycle.

All **three installed adapter send sites now specify `mode: "immediate"`**
and the direct action checks for a session before sending. Thus the proposed
0.9.2-C code fix is present in the release's files. File installation alone
does not prove the host reloaded its extension process.

One `PMX0100_NATIVE_STEER_PROBE` action returned `ok: true`. **No actual
new-user-turn receipt has been observed yet.** It has not been repeated,
and no manual-send receipt will be counted as automatic steering. No
extension-reload tool is exposed in this session. Native UI inspection and
the serving-app-version tool are also unavailable in the current tool
catalog, so neither a native paint pass nor a current desktop build is
claimed.

### Further consumer evidence

- Minimap toggling passed **4/4** pointer/keyboard checks at **600/1440 px**:
  the Settings menu and tooltip close, focus returns to Settings, and the
  minimap toggles back to its initial state. Screenshots were inspected;
  recordings are retained in `minimap-videos/`. Evidence: `minimap-results.json`.
- Standalone installed MCP passed **6/6** checks. Metadata discovery and
  help created neither `.pmx-canvas` nor a listener; subsequent content
  operations started the correct 0.10.0 workspace. No updates arrived before
  subscribing, only the requested URI arrived afterward, unsubscribe stopped
  updates, and closing both official client and transport closed the listener.
  Evidence: `standalone-results.json`.
- The actual backup timer produced
  `canvas-20261025T082358422Z.db`, **438,272 bytes**, containing **12 boards /
  132 nodes / 2 snapshots / 1 blob / 2 retained attachment payloads**.
  The schedule is now **off**, with a real last-run timestamp. Live,
  pre-restore, migration and timed-copy databases all passed SQLite integrity.
  Both upgrade versions use application schema 2, so no schema-changing
  backup is claimed. Evidence: `backup-final-status.json`, `backup-integrity.json`.
- Actual daemon restart changed PID **18411 → 21504** and preserved all
  **12 boards / 132 nodes**, stable authored data/geometry/pins and read
  revisions. Evidence: `restart-results.json`.

At **08:26:26Z**, no automatic native-probe user turn has arrived in this
conversation. A pending-delivery read contains three unrelated synthetic
document-import broadcasts; their presence is not evidence of a functioning
native pump. They have not been falsely marked delivered.

**Peter's native observation:** “Queued, waiting for me to send it.”
The 0.10.0-cycle one-shot probe therefore **did not meet active-run steering
acceptance** on this host. It remains unsent manually. This is not a successful
automatic delivery or an idle-wake result.

Keep two facts separate: the released adapter files contain the immediate-mode
fix, but the observed live integration still queues. Fresh activation of those
files has not been proven because extension reload is unavailable here.
Do not conclude that the patched implementation was necessarily executing,
or close 0.9.2-C from a source-file match. A verified extension reload followed
by a separately authorized native check is needed to distinguish stale-host
activation from a remaining app/adapter delivery defect. The original probe
will not be repeated or counted as a pass after manual submission.

### Initial source failure and diagnostic rerun

The initial full source browser run has failed
`canvas.pw.ts:5165`, **“populated multi-agent bars keep view controls reachable
after resizing”**. The trace records a 30-second click timeout: the
More/Fit union selected the More button, then repeatedly reported that it
was not visible. Original screenshot, video, context and trace were copied
to `source-initial-failures/` before any rerun.

The **unchanged** case passed on an independently fresh installed-registry
daemon at 4538 (**1/1**, 4.6-second case). That diagnostic daemon was stopped.
Assertions, timeout and retry count were not changed. This does not clear
the initial aggregate failure or establish a product/environment cause.
The full registry replay remains queued behind the source workload.
Evidence: `source-toolbar-failure-summary.json`,
`toolbar-targeted-attempt-1.{log,exit}`, `toolbar-test-results/`.

The registry tarball's SHA-512 matches npm metadata, and all **805** shipped
files match the clean registry installation byte-for-byte.
Evidence: `registry-integrity.json`.

Real MCP webpage cancellation also passed **4/4** controls: deliberately
withheld response headers and a partial response body were both actually
aborted upstream. The caller rejected, while the already-committed
placeholder remained unchanged and late content never landed. This does
not promise a final receipt to a cancelled wire caller. Both the official
client and transport, and the loopback upstream server, were closed.
Evidence: `cancel-io-results.json`.

The real image-only PDF again produced no text; a fresh capability check
confirmed tesseract is absent, and the import truthfully recorded
`unavailable`. No OCR success is claimed. Edited extracted-text export
gating passed both consent variants. Real presentation capture produced
two frames and finalized metadata after SIGINT with exit 0.
Evidence: `scanned-results.json`, `edited-derived-results.json`,
`record-results.json`.

### Source gates complete; registry staging correction retained

Final initial source command exits:
`frozen-install=0`, `coverage=0`, **`release-check=1`**,
`cli-e2e=0`, `release-smoke=0`, `pack-dry-run=0`.
Build/typecheck/lint and **1,546 unit / 332 client** tests passed.
The complete browser aggregate was **330 passed / 1 failed / 2 skipped**.
The single failure is the preserved toolbar case described above; the two
skips are Linux-only foreground PTY variants, not passes. The sequential
runner's own exit 0 does not override the individual failed gate.
Pack inspection reports **805 files / 33.76 MB**.
The actual local browser is **Chrome 145.0.7632.6**, separately measured,
not Amp's Chrome 152.

The registry replay setup required two retained corrections:

1. The first replay was deliberately stopped after seven passing cases when
   inspection found that nested CLI launches would lack installed built
   assets. Its interrupted log/results remain separately retained.
2. Linking the staged `src` directly into the installed `node_modules`
   path then failed **before discovery**: Node refuses TypeScript stripping
   from files under node_modules. Those exit-1 discovery/seeded-attempt logs
   are preserved, not reported as browser assertion failures.

The final setup keeps TypeScript harness paths outside node_modules, with
all **315** staged source files byte-identical to the registry package;
`dist` and skills resolve to the installed package. Explicit app CLI, actual
DB path and workspace cwd remain pinned. All **17 browser files** are
unchanged. Discovery now succeeds for **333** cases; the **332-case**
ordinary replay is running, with SDLC seeding/execution separate.
No assertion, timeout or retry count was changed.
Evidence: `registry-staged-source-integrity.json`,
`registry-browser-test-digests.json`, `registry-discovery-attempt-3.log`,
`registry-browser-interrupted-attempt-1*`,
`registry-browser-node-loader-attempt-2*`.

Actual native focus, review annotation and synthetic approval rejection
persisted with source `copilot`. A fresh alternate-workspace listener on
4533 caused the native adapter to refuse `MUST-NOT-CROSS-WORKSPACE-0100`
with “Action withheld”; its work list stayed empty. Restoring the original
listener restored access to its persisted timeline. Evidence:
`native-state-projection.json`, `guard-*.json`. These successful adapter
actions do not resolve the queued-steering failure or native paint gap.

### Registry failures remain under investigation

The corrected full registry replay is not green. Its first hosted-form
case failed during **context/trace teardown**, with the trace reporting
“Tearing down context exceeded the test timeout of 30000ms”.
The original artifacts were copied to `registry-initial-failures/`;
`registry-hosted-failure-summary.json` preserves the actual error.
Other hosted cases and the 220-card Graph case have also failed while the
aggregate continues. Final counts and unchanged targeted reruns are pending.
Do not infer a form-save regression from a teardown timeout or substitute
the passing lifecycle-only probe for this failed aggregate.

The separate public dependency audit exits **1** with **three low-severity
package entries**, representing the same KaTeX advisory through Mermaid and
PMX Canvas, not three independent vulnerabilities. No moderate/high/critical
entries were reported. Advisory:
[GHSA-238p-pmpm-9mq7](https://github.com/advisories/GHSA-238p-pmpm-9mq7).
No exploit or dependency fix was attempted. Evidence: `registry-audit.json`.

### Copilot final verdict and gate reconciliation

**Runnable verification completed with failures and unchanged reruns.
Native-host acceptance remains partial. This is not a clean full-protocol pass.**
The earlier ledger and progress entries are historical; this section records
the final outcomes of this independent Copilot cycle.

| Gate | Final outcome |
|---|---|
| Source frozen install and coverage | initial pass; 1,546 tests, 66.78% lines / 64.65% functions |
| Source build/typecheck/lint/unit/client | initial pass; 1,546 unit / 332 client |
| Source full browser / release:check | **initial failure**, 330 passed / 1 failed / 2 platform skips; release:check exit 1 |
| Source failed-case rerun | unchanged toolbar case **1/1 passed** on a fresh source DB/port; does not clear original |
| Source CLI E2E, packed smoke, pack inspection | initial pass, individual exits 0; 805-file pack |
| Global and exact registry smoke | both 4/4 passed |
| Registry setup/discovery | interrupted initial attempt and Node-loader failure retained; corrected discovery 333 cases |
| Registry corrected full ordinary replay | **319 passed / 11 failed / 2 platform skips**, exit 1 |
| Registry separately seeded SDLC | **1/1 passed**, exit 0 |
| Registry unchanged failed-location rerun | **11/11 passed**, exit 0 |
| Unique browser coverage per source/registry layer across attempts | **331 cases passed / 2 Linux-only PTY skips**, not a single clean initial aggregate |
| Public contracts, metadata, subscriptions, cancellation, SDK, documents and persistence | passed in the individually scoped checks above, with retained harness corrections |
| Native adapter targeting/context/actions | actual actions and workspace-replacement refusal passed |
| Native active-turn steering | **failed acceptance on this host: queued**, confirmed by Peter; fresh extension activation unverified |
| Native WKWebView paint, extension reload, current desktop build | unavailable/unverified, not inferred from Chrome or installed files |

The eleven registry failures were reported at fixture teardown: **nine
hosted context/trace teardowns and two request teardowns** (220-card Graph
and delayed camera echo). All eleven unchanged cases passed when selected
after the full workload, with the same video/trace settings and timeouts.
No video-disabled diagnostic, relaxed assertion or product fix was used.
Their original failures remain red; the cause is **not established**.
The source toolbar case also passed unchanged against both a fresh registry
control and a fresh source server. These isolated passes do not establish
full-suite reliability or an environmental explanation.

Evidence: `registry-browser.{log,exit}`, `registry-seeded.{log,exit}`,
`registry-targeted.{log,exit}`, `registry-targeted-command.json`,
`registry-failure-census-progress.json`,
`source-toolbar-rerun.{log,exit}` and their separate result directories.
No reproducible new functional runtime regression was established by the
controlled consumer checks; the red aggregate gates and observed native
steering failure remain reportable outcomes, not waived exceptions.

The released narrow-Markdown and representative script-only lifecycle fixes
are independently verified. The full hosted form case, including category,
preset and board copy, passed on unchanged targeted rerun, not initially.
The new cancellation/subscription/help/structured-result contracts passed
their scoped standalone, attached MCP and SDK checks. The unchanged source
client regressions for delayed startup presence passed, including both
new-session preservation and prevention of detached-session resurrection.

### Claim-matrix closure and instrumentation limits

| Initial claim row | Final evidence or remaining gap |
|---|---|
| SDK tour envelope | saved and derived envelopes passed in installed SDK |
| SDK cancellation | all three AbortError controls and pending-timeout controls passed |
| Explicit subscriptions | standalone and attached positives/negatives passed; attached reconnect requires resubscription |
| AX rejection isError | denied work absent and enabled exactly-one-work control passed |
| Structured results and annotations | 25 schema/annotation entries, empty-envelope negatives, validated help/representative successes passed; not every external-helper success branch |
| MCP cooperative cancellation | real header/body I/O and gate-wait cancellation passed; completed placeholders retained |
| canvas_help | all 102 details, invalid name, no board/read mutation and standalone no-DB/no-listener passed |
| Shared discovery schemas | source contract regression passed; public representative validation passed, no token/latency inference |
| Minimap tooltip/focus | four pointer/keyboard controls at 600/1440 passed |
| Narrow Markdown | old 600 px overlap reproduction and 1440 control passed |
| Script-only forms | representative lifecycle initially passed; full form case passed only on targeted rerun |
| Startup presence | all three unchanged source client race regressions passed |
| Native steering | released files fixed, but actual host acceptance failed; activation gap remains |
| Camera/tour cost | functional camera/tour cases exercised; no independent query/write-count instrumentation, so cost claim is not certified |
| Markdown parser/cache cost | binding/rename preservation exercised; repeated-parse cost not independently instrumented |
| Lifecycle read cost | scope/version behavior exercised; unrelated-board hydration and audit-history loading cost not independently measured |

These instrumentation gaps are additional reasons not to call this a full
claim-by-claim pass. Functional suite coverage is not a proxy for a measured
database/query/parser cost claim.

### Remaining native action

The installed adapter contains the expected **`mode: "immediate"`** fix on
all three sends, but the actual one-shot instruction still appeared in
Copilot's queue. Do **not** submit that old probe manually to manufacture a
pass. Freshly reload the extension and reconnect the native MCP connection
before a separately authorized post-reload acceptance check. This session
has no exposed extension-reload tool, and no fresh native process activation
or automatic delivery is claimed.

Unproven surfaces also include native Windows, physical mobile, successful
OCR, Office formats beyond the tested DOCX, scored model evals, prolonged
soak/conflicting edits, every external app/helper success branch and
automatic import-agent launch. Source or Chromium results do not close them.

### Final review and cleanup

- Saved a readable outcome card on the disposable acceptance board.
  `shots/final-review.png` was inspected as **Chromium** evidence, not native
  Copilot paint. Final validation: **6 nodes**, zero collisions, containment
  violations, missing endpoints or size warnings.
- Saved snapshot **`snap-mvnn7a5l-voq4`**. Completed the test-owned native
  work item and resolved the synthetic annotation; no real action was
  authorized by the rejected test gate.
- Both disposable workspace Beta switches are off. Both backup schedules
  are off. Original attachments, snapshots and test databases are retained.
- Stopped the owned 4533 and 4535 daemons. Connection-refused checks covered
  **4533-4538, 4631, 4641, 4657 and 4671**; no evidence-root runtime process
  remained in the final process check. No unrelated daemon was stopped.
- **14** owned database/backup files passed final SQLite integrity checks.
  All **12** original source/registry failure trace ZIPs are valid.
  All **805** installed registry package files still match the original
  tarball after testing. Amp's original report prefix remains byte-identical.
- Evidence: `final-cleanup.json`, `final-integrity.json`,
  `final-all-db-integrity.json`, `initial-trace-integrity.json`.
  Raw evidence remains local at the Copilot root above, not shipped in this
  report. The working branch remains **main**. No commit, push, product-code
  fix or release publication was performed.

### Post-finalization native-probe receipt

The original `PMX0100_NATIVE_STEER_PROBE` arrived as an actual new user turn
at **2026-10-25T10:50:06.076+01:00** (**09:50:06.076Z**), after finalization.
The original send was **08:18:55.163Z**, approximately **91 minutes**
earlier. No second probe was sent.

This records eventual conversation receipt only. Peter had already confirmed
that the instruction was queued, waiting for manual submission. This later
turn does not establish whether it was manually submitted or automatically
drained after the run ended, and does **not** prove active-run steering,
idle wake-up or fresh extension activation. The native acceptance result
remains unresolved/failed for the originally observed active-run behavior.
The completed tests were not restarted and the stopped test services remain
stopped.

## Independent Codex Verification, 25 October 2026

**Completed with findings, red aggregate browser gates and blocked remaining native checks. Not a clean release-wide pass.** This addendum is independent of the Amp and Copilot results above. No product fixes, commit, push or publication were performed.

### Identity And Test Boundaries

- npm 0.10.0, gitHead `4a5040cc5efc62b5abf2ca16792b3720abf5fd48`; main was already current at `42b22f86`. No pull or upgrade was needed.
- Official tarball SHA-512 verified. All **805 files** match both the clean registry install and selected global install, with no missing, extra or changed files. Exact source archive was fetched by that revision; it has no Git metadata. Relevant source files also hash-match the installed package.
- Bun **1.4.4**, dedicated Node **24.22.1**, explicit `BUN_BIN` for nested fixture commands. The shell's Node 25.9.0 was not the release-gate runtime.
- Evidence root: `/Users/pepe/dev/personalclaude/artifacts/pmx0100/`. Source `/tmp/pmx-canvas-0100-codex`; separate registry, native and worker workspaces. Existing user libraries and other agents' services were not stopped or mutated.
- Loaded the released main/testing skills. All **15 complete mirrors were already in sync**, and remained so at final check. The older Amp mirror-staleness observation is closed for this Codex cycle, not rewritten historically.

### Findings

**C01, P2: macOS foreground Ctrl-C recording fails to finalize.** Reproduced twice on the installed release, Bun 1.4.4 and owned Chrome for Testing 145.0.7632.6. The harness verifies the recorder is the foreground PTY process group, waits for actual frames, then writes terminal ETX. The two attempts retain **68** and **24 PNGs**, exit 1 with `Chrome process closed the pipe` / `page detached (crashed or closed)`, and never write `recording.json`. This is a reproduced platform behavior, not a Linux skipped-test pass, and its introduction version/root layer is not established. A normal-duration control writes five frames plus metadata; genuine browser loss correctly reports failure. ffmpeg is absent, so no successful MP4 encode is claimed. Both WebKit and owned Chrome start/evaluate/resize/screenshot/stop pass. Evidence: `persistence/followup/report.md` and its separate timestamped attempts. Existing Chrome 9222 was untouched.

**C02, P2 guidance/API mismatch: Ghost Cursor expiry and batch-linkage promises are too strong.** Two independent runtime attempts confirm that a swept, quietly expired intent allows a later leaf mutation to proceed unlinked rather than rejecting. A live top-level `intentId` on `canvas_batch` rejects on standalone MCP, but daemon-attached MCP/direct HTTP discard it and execute unlinked. Supported live leaf links settle at the ghost coordinates; vetoed leaf links refuse; leaf-linked batch entries work on both paths. Correct the skill's unconditional expiry-rejection and linked-top-level-batch examples. This is not proof of a new 0.10 regression or an authorization bypass: preview expiry is not a human veto. Evidence: `transport/report.md`, both successful `ghost-*` attempts, and skill finding N01.

**C03, integration limitation: terminal progress can be lost by the installed official SDK callback.** Raw wire observation receives both initial and terminal progress for **40/40** calls, while SDK 1.32.2 `onprogress` receives both for **31/40**. Nine terminal notifications report an unknown token. The inferred SDK cleanup/notification-order race is not a proven PMX root cause. Do not use a terminal callback alone as a durable completion receipt. Evidence: `transport/attempts/progress-isolate-callback/`.

**C04, P3 skill discoverability:** the full reference correctly documents `structuredContent.result = { operation, outcome, data }`, retained text and help/direct-tool exceptions, but the main skill's MCP section does not surface this boundary. An old helper assumption failed here and was corrected to read registry `result.data`. Add a direct response-shape pointer and paired example, not an unconditional all-tool unwrap. This was a harness error exposing a guidance improvement, not malformed product output. Evidence: `skill-audit/focused-prose-check.md`.

### Executed Gates

| Gate | Codex result |
|---|---|
| Frozen source install, build, typecheck, lint | Passed |
| Unit coverage | **1,546 passed**, 0 failed; **67.50% lines / 73.92% functions**, above 60/64 floors |
| Source client suite | **332 passed**, 0 failed |
| Full source browser aggregate | **325 passed, 6 failed, 2 skipped**; `release:check` exit 1 |
| Unchanged focused source rerun | **11 passed**, including all six failing cases and related save/viewport controls; original aggregate remains red |
| CLI E2E, release smoke, pack dry run | All exit 0; packed-source smoke is separate from npm evidence |
| Full registry browser aggregate, excluding separate SDLC case | **329 passed, 1 failed, 2 skipped**; exit 1 |
| Registry failing footer case, unchanged isolated rerun | **1 passed**; original aggregate remains red |
| Actual-registry SDLC fixture | Separate **1 passed**, 25 nodes / 15 edges / 3 pins; actual installed package, not the helper's manually partial package |
| CLI / HTTP / fresh official stdio MCP / Bun SDK | Scoped positive and negative controls passed after retained harness corrections |
| MCP schemas / annotations / help | **25 tools**, 270 schema controls, 194 validated retained results, **102** help details; metadata-only help creates no DB/listener |
| Tour envelope / wait cancellation / partial effects / subscriptions | Saved/derived envelopes, all three SDK AbortError-vs-timeout waits, cooperative cancellation, retained effects, exact-URI isolation and reconnect/resubscribe passed |
| Persistence supplement | **166 passing assertions** across 16 final scenarios; nine earlier failed environment/fixture attempts retained |
| Upgrades / storage | Genuine 0.9.3 upgrade, real 0.8.2 category conversion, restart/replay, blob/snapshot/library restore, actual timer disable/retention, WAL and 48 initializers passed |
| Lifecycle / concurrency / import privacy | Four clocks, source/dependency guards, locks/attribution, delayed-read refusal, 320 concurrent-writer cards, four privacy exports and offline paint passed; boundary clock was internally injected, not seven elapsed days |

The source browser failures were the file-backed superseded-save case, hosted draft replay, real HTML/Mermaid, both older-hosted-Clear variants, and wide Home navigation. Five report context-teardown timeouts; the save case times out and reports a closed page during cleanup. All pass unchanged isolated reruns. The registry failure repeats the previously reported high-degree footer `Home` key assertion: `scrollTop` stays **3019**, expected 0, then passes isolated. These remain aggregate reliability findings with unresolved causes, not waived passes or proven content corruption. The two skipped cases are Linux-specific PTY tests; the independent macOS reproduction above does not close them as passes.

Registry harness startup failures are preserved separately: missing ESM marker, then Node refusing TypeScript under a `node_modules` realpath. Corrected by a private ESM harness and byte-identical registry source copies outside `node_modules`; the server still runs the actual npm package. No product/test assertions changed. First source/registry failure traces were retained before reruns. Source and registry broad browser runs overlapped; load/timing contribution was not isolated. Measured relevant process RSS samples were 5.65 and 5.84 GiB, not continuous peak monitoring or a soak claim.

### Actual Codex Browser Evidence

Opened the native browser before fixture mutation on isolated **4543**. The preferred browser helper failed native-module signature validation; documented CUA fallback was used without bypass. Native paint and actions passed for:

- HTML and JSON controls, header and whole-board pins, current double-click action-menu pin/unpin, status Close and Undo. Literal right-click did not open that menu; released guidance correctly specifies double-left-click.
- Pinned context read, addressed composer steer, fresh MCP claim, different-recipient refusal, explicit intent, source-preserving edit, visible `CHECK-0100`, then acknowledgement. North 19 / South 47 remained intact. This is active-turn polling, not automatic idle-chat wakeup.
- AX-disabled JSON draft and dynamic-list continuity through inline -> expand -> edit/replace -> close in both `src` and `srcdoc`, without reload/spec save between assertions. Local drafts never entered the authored server spec.
- HTML AX disabled-negative, user-approved late enable of only `ax.work.create`, actual click and persisted work acknowledgement, disable/remount and refused next click. The temporary capability is off at finish.
- Native minimap pointer and keyboard dismissal at **600 px**, plus initial desktop pointer dismissal. Expanded long Markdown at **600/1440** shows the final `149` and sentinel without Source-button occlusion; narrow DOM hit-test lands on the paragraph.
- Real PDF and DOCX native chooser upload, explicit import requests, retained-byte extraction using pdftotext / structured XML parsing, visible draft review, and Add to board. Final values **83 / 97**, asymmetric regional values, final sentinels and attachment provenance are present. Both jobs are committed. API-only consent tests remain separately labelled in worker evidence; no successful OCR is claimed.

The chat's configured native MCP catalog still exposes **24 tools without `canvas_help`**, while every fresh official client discovers 25. Native configured reconnection/Skills activation is therefore **not established**; subprocess discovery is not relabelled as that pass.

The graph **Open in tab** click produced no observed new Codex tab, then saved origin permission denied further browser observations. Peter reported restoring permission; one retry was still denied. No alternate browser, origin or raw-CDP workaround was attempted. Native standalone graph live-resize, Excalidraw ready/expanded/site refusal, and the remaining desktop keyboard check are **blocked/not completed**, not certified from source/registry paint. The browser viewport was reset and only the disposable tab was closed.

### Skill Audit And Cleanup

Independent file audit: **18 skills / 40 identical resources / 523,944 bytes**, all resource digests verified; **17/18** structural validator passes, with known data-analysis frontmatter failure. **43 PMX + 10 control-orchestrator eval definitions** were inspected, with **zero scored model runs**. Carryovers remain: unsafe unconditional sync replacement guidance, overbroad tour-locality eval, source-dependent published-consumer helper, missing license pointers, nonportable cross-skill reference and oversized entrypoint. Full findings and current mirror closure are also appended to [the version skill audit](pmx-canvas-0.10.0-skill-audit.md) and [the longitudinal skill audit](pmx-canvas-skill-audit-2026-06-22.md).

Final native board: **10 nodes**, zero collisions, missing endpoints, containment or size warnings; snapshot **`snap-mvntf8ww-8en5`**. Test-owned presence detached, HTML AX disabled, both imports committed. All **43** retained databases pass integrity; all **7** original browser-failure trace ZIPs validate. All owned listeners/processes are stopped. See `final-integrity.json` and `native-api-cleanup.json`.

Cleanup boundary: the two Beta flags remain enabled **only in the stopped disposable native database**. Their API reset correctly requires a human workbench, and browser permission remained blocked. No human token was fabricated. This is explicitly partial settings cleanup, not a claim that those switches were restored. Other worker schedules/settings were restored in their own workspaces. Unrelated user data and services are untouched.

Remaining gaps: successful OCR/other Office formats, prolonged soak/conflicting semantic edits, physical mobile/Windows, native Copilot activation, native configured Codex MCP/Skills reconnection, automatic idle wakeup, every external helper success branch, full model benchmarks and independent parser/query/write-cost instrumentation. No token-saving claim follows from byte measurements. **Useful core release, but not a clean full-protocol sign-off.**
