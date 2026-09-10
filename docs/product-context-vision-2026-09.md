# Vision extension: boards, personal wiki, and workspace context

**Status:** Proposed for discussion, not an implementation commitment.
**Date:** 2026-09-06
**Companions:** [Product review](product-review-2026-09.md), [product vision](product-vision-2026-09.md).
**Request:** Review the existing vision and explore hosted users building their own wiki by describing their work, with their boards contributing context, and cross-cutting organizational context shared within a workspace. Reuse the logic of the personal/context-frame projects inside pmx-canvas's own store rather than depend on an external wiki.
**Method:** Read both documents and current canvas context/provenance/caller contracts; research threads inspected both actual reference projects after user-authorized local-file transfers. The shared snapshot matched the previously inspected files; the personal transfer superseded its initially empty checkout. Reconsulted the oracle on private maintenance versus confirmation/publication using those findings. Static source analysis only: no reference services, onboarding, or promotion jobs were executed, and earlier audit tests/adoption measurements were not rerun. The public example is no longer the basis for this proposal.

## Position

**Work visually with your agents, build understanding as you go, and bring the right knowledge into whatever comes next.**

**The board is the human's extended memory and the agent's working memory.** It is a place for the human to do knowledge work, not just prepare context for an agent: research, analysis, dashboards, discovery, planning, coordination, and starting or orchestrating coding and other work. These are examples of its broad purpose, not a closed list. People can use the board to think and work directly, with agents contributing on the same surface.

As the work develops, sources, notes, questions, charts, plans, decisions, and outputs accumulate and connect on the board. They contribute to a memory graph and maintained wiki that support both human recall and agent context across tasks. Relevant prior knowledge can then return to a board as material for further work. The board, graph, and wiki are connected views and uses of this knowledge—not three competing sources of truth or three separate filing chores.

- **Do and shape the work together.** Read, write, compare evidence, monitor a dashboard, develop a plan, and direct execution on the board. Arrange, connect, pin, and annotate to support human understanding as well as shape agent context. Agents bring questions, proposals, and results back onto the same surface. Spatial layout provides context; not every move or camera gesture expresses intent.
- **Make memory useful in the next task.** Resume without re-explaining everything. Bring relevant prior learning and authorized cross-team decisions, dependencies, and conflicts into the work—not merely into a growing collection of notes.
- **Keep context honest as work changes.** Show sources and revisions, surface known changes and conflicts, and make uncertainty and review needs visible. Help people judge what still applies; do not treat a newer timestamp as truth or silently replace confirmed knowledge.

The important distinction: **a board is evidence of work, not automatically an authoritative statement about the organization.** Remembering every board is useful. Treating every brainstorm, rejected option, generated answer, or private note as accepted organizational context is not.

Preserve the existing decisions: all node types and fleet capabilities stay; the app owns storage and history; 6b remains undecided; hosted multiplayer is later work. This extension does not authorize starting those implementations.

### Revised conclusion after inspecting both projects

**Combine their logic, not their deployment machinery.** The personal frame supplies the daily work and learning loop; the shared frame supplies cross-cutting organizational knowledge and governed promotion; canvas supplies the visual working surface. A hosted canvas can make these three roles one coherent experience without requiring users to manage repositories, QMD collections, plugins, or promotion archives.

The largest correction to the first proposal is that **routine private wiki upkeep should not require approval for every edit**. The personal frame already instructs agents to maintain knowledge during work. Preserve that convenience through explicit scoped delegation, visible source-backed working revisions, history, and undo. Confirmation of a claim and disclosure to colleagues remain separate, deliberate actions. This is agent-assisted learning during work, not a promise that an unattended background process understands every session.

The loop is bidirectional: work produces personal understanding; selected outcomes become shared knowledge; authorized shared decisions inform the next person's work. Cross-cutting context is not the union of employee wikis, and shared authority does not erase a person's explicitly divergent interpretation.

## Review of the existing plan

### What I would keep

- **Many named boards first.** This directly addresses the continuity problem described by the real-board evidence. Recover historical boards without treating snapshots as a normal board picker. Verify backups and recovered content before any destructive storage change.
- **A budgeted agent brief.** Context selection is a stronger differentiator than adding more tools. Show why material was included and allow explicit retrieval of its source.
- **Agent output on the working surface.** Ask and status cards should be spatially usable while keeping their underlying lifecycle and fleet behavior.
- **App-owned storage, durable attribution, consistent mutation policy.** These help local users immediately and establish useful hosted foundations.
- **Renderer consolidation without capability cuts.** Optimize actual rendering cost rather than infer that a feature is unnecessary from one person's usage.

### What I would revise before implementation

1. **Sequence around user outcomes, not the number of refactors.** The proposed 0.6 combines multi-board persistence, trust, schema work, frame consolidation, and packaging in 2–3 weeks. That estimate is not established by the review. First prove preservation, explicit board targeting, visible write failures, and a useful context loop; let renderer and packaging work ship independently rather than gate that outcome.
2. **Bring mutation-policy convergence and durable identity forward.** Routing the SDK through policy is independent of choosing five versus 22 MCP tools. Establish a consistent write boundary before promising complete journal coverage or trusted attribution.
3. **Separate history from semantic memory.** A journal records operations; a wiki records durable understanding. A log alone does not implement an audit policy, permission-aware replay, concurrent editing UX, or meaningful synthesis. Start with transactional state-plus-event durability; full replay and time scrubbing need demonstrated value, not prerequisite status for a wiki experiment.
4. **Do not exclude everything completed or generated.** Completed work chatter can leave the default brief; a completed decision may be the most important context next month. A generated view of accepted knowledge is not equivalent to unreviewed agent speculation. Lifecycle, authority, and relevance are separate dimensions.
5. **Do not make automatic session projection the default definition of memory.** Files, diffs, and test output fit coding work but not every PM board. Automatically register the board; make verbose session projection opt-in or compact and collapsed. Recency alone must not let a noisy feed consume the brief.
6. **Replace the human-only token claim with a threat model.** A boot secret in workbench HTML is accessible to an agent that can fetch that HTML. It does not establish human intent. Hosted roles require authenticated, scoped principals; a promise of human confirmation additionally requires a confirmation mechanism unavailable to the agent. A same-user shell agent can also modify an accessible SQLite file: app ownership alone is not process isolation.
7. **Correct the provenance claim.** Current node data already contains persisted source provenance; what is missing is durable authenticated writer attribution and acceptance history. Extend those concepts rather than invent a second source-provenance system.
8. **Treat hosted as more than a login screen.** Revocation, derived-content permissions, backups/restores, uploads, quotas, sandbox isolation, and operational recovery are new responsibilities. Node-level compare-and-set can be a starting conflict policy, but requires visible conflict/retry behavior; it does not settle collaborative text editing.
9. **Use measurements as evidence, not promises.** The earlier audit describes a particular tree and machine. Current context construction already has text previews and bounded pending steering. The claimed 10,000-token saving depends on what schemas hosts actually load; on-demand help alone does not remove advertised schemas. Measure current payloads before fixing budgets. Net-negative lines are not a user-value release gate.

The north star is doing knowledge work on a shared visual surface that extends human memory and supplies agent working memory, with understanding carried into the next task. Validate human usefulness as well as agent behavior: can a person inspect evidence, understand relationships, resume research, monitor a dashboard, or develop and direct a plan? Pins, camera attention, and the time scrubber are mechanisms to validate against that purpose, not the purpose itself.

## The user experience

1. **Describe your work.** “I lead developer experience, work with these teams, and own these outcomes.” The assistant proposes a small personal home: responsibilities, initiatives, goals, people, and open questions. No mandatory taxonomy or blank-wiki setup project.
2. **Work on named boards.** Research, compare evidence, use dashboards, create outputs, and start, plan, or orchestrate coding and other work. Boards remain separate and recoverable. Each board is automatically listed as a source in the owner's context, within its existing permissions; the human can return to it without needing an agent to reconstruct the work.
3. **Remember without manual filing.** After the user delegates maintenance of specified private sources, the assistant updates existing personal working pages during the task. Source links, a quiet change history, and undo replace a compulsory wiki-edit review queue. Unknowns stay unknown; generated interpretations stay labeled.
4. **Confirm what matters.** “Keep this as my decision” confirms an exact revision with its evidence and owner. New agent changes remain working revisions, not silently renewed confirmation. Pinning still means attention, not publication.
5. **Resume with relevant memory.** A new board retrieves labeled personal working knowledge alongside confirmed personal context and authorized workspace knowledge. For shared organizational facts, shared canon has authority; for personal preferences, the person's context applies. Conflicting or newer evidence is shown rather than overwritten.
6. **Share deliberately.** Publish a reviewed decision, goal, or dependency to the workspace. Another participant benefits without gaining access to the author's private wiki.

Example: a PM explores options on a discovery board, accepts a decision into personal context, then publishes an appropriately sourced workspace decision. A team lead opens a planning board and receives that decision plus related shared dependencies—not the PM's private stakeholder notes or abandoned brainstorming.

### Work becomes memory, and memory supports more work

1. **Work on the board:** humans and agents add and use source material, relationships, live views, plans, and results.
2. **Connect the memory:** retain source and revision links so a person or agent can follow how an observation relates to evidence, a decision, or an outcome. Not every dashboard refresh or scratch note needs a permanent wiki page.
3. **Maintain understanding:** under the private-maintenance delegation, synthesize useful learning into existing working wiki pages. Preserve uncertainty and rejected alternatives; confirmation and wider sharing remain separate actions.
4. **Bring it back into work:** humans browse and revisit the graph, wiki, and boards; agents receive relevant, permission-scoped working context. New work adds evidence and can revise the understanding again.

The graph holds meaningful connections and provenance; the wiki presents maintained understanding; the board keeps active work spatial and usable. A board can contribute immediately as evidence and working memory without declaring all of its contents authoritative. This loop is the proposed direction, not a claim that automatic graph/wiki maintenance already ships.

## One model, distinct scopes

| Surface | Responsibility | What it must not imply |
|---|---|---|
| Board | Human work surface and extended memory; agent working memory through spatial material, artifacts, asks, and evidence | The human only curates for agents, or everything visible is accepted knowledge |
| Personal wiki | Durable context owned by one person across boards | Workspace membership grants access |
| Workspace context | Deliberately shared goals, decisions, ownership, dependencies | A union of everyone's private context |
| Agent brief | Budgeted, task-specific view over authorized material | A new source of truth or permission grant |

Use common entities, revisions, source links, and relations. Personal and workspace entities have separate ownership and audience. Model a hosting tenant separately from a person's private area and a collaborative workspace; a local filesystem workspace is not automatically an organizational security boundary. Cross-tenant membership and personal portability remain later decisions.

A board node may reference a canonical entity, display its current accepted revision, or pin an exact historical revision. Scratch cards need not become wiki entities. Board-local comments and proposals do not silently update canonical content. Restoring or deleting a board does not rewind or delete accepted workspace knowledge.

Start with flexible pages and a few useful semantic kinds—decision, assumption, goal, initiative, responsibility—not a large ontology. Identity uses stable IDs, not titles. Updating the existing object should be the default; duplicates and conflicts need explicit reconciliation rather than silent last-writer-wins synthesis.

## Automation and publication policy

**Automate remembering. Require authorization when content gains authority or reaches a broader audience.** Visibility and acceptance are independent: a shared draft is not an accepted decision, and an accepted personal note is not shared.

| Stage | Default behavior | Guardrail |
|---|---|---|
| Evidence | Register boards and source revisions automatically | Registration neither widens access nor fetches every external reference |
| Personal working revision | Maintain source-linked private pages during work under explicit scoped delegation | Reversible and labeled as working knowledge; cannot silently replace confirmed content in storage or retrieval |
| Review view | Show a consolidated diff when inspection, reconciliation, or confirmation is needed | Not a mandatory stop for every private edit; show evidence, uncertainty, and changes |
| Confirmed revision | Record endorsement of exact content | Confirmation means user endorsement, not objective truth; later drafts do not inherit it |
| Publication | Release exact content to an explicit destination | Requires target publishing authority and authority to disclose restricted source-derived content; does not implicitly confirm the claim |

Delegate maintenance once with concrete sources and scope, not blanket authority: “Maintain my private working memory from these boards; ask before confirming claims or sharing.” An explicit human request can confirm a specific revision; “summarize my week” does not authorize publication to colleagues. A private edit needs no new approval while it remains within that delegation. An agent edit to confirmed content creates a working revision; carrying confirmation or publication forward requires new authorization. Do not use model confidence, timeouts, pins, task completion, or movement onto a shared board as implicit approval.

Use two independent dimensions: working versus confirmed **entity revision**, and personal versus explicitly shared **audience**. Do not introduce sentence-level approval machinery initially. Working and confirmed revisions share an entity identity but stay distinguishable; a page mixing them cannot wear a blanket “confirmed” badge. Confirmed content cannot be silently displaced in a brief, title, summary, or relation either. When newer working evidence conflicts, show both with their status. A source's embedded instructions cannot authorize maintenance, confirmation, or disclosure.

For example, a confirmed “launch requires security sign-off” and a later draft “Tuesday if review passes” must not become “committed launch: Tuesday” in the next brief. Retaining the old revision in history is insufficient if retrieval loses its condition. Routine private maintenance remains automatic; endorsement does not.

Prevent the review queue itself from leaking: a proposal derived from private sources stays private until disclosure is authorized. The target workspace is not automatically allowed to see it merely because publication there is proposed.

### Shared synthesis needs its own source boundary

Generate shared drafts from a clean, target-scoped context. Do not reuse a personal assistant conversation containing restricted information and merely filter its citations afterward. Private information can influence conclusions without appearing in citations.

By default, an automatic derivative's audience cannot exceed the intersection of its inputs' audiences. Explicit authorized publication is a separate operation, not a side effect of summarization. This rule covers titles, backlinks, search indexes, embeddings if introduced, cached briefs, exports, notifications, and historical payloads—not just the final page text.

Permissions are checked before retrieval, ranking, and generation. An agent's access is bounded by its authenticated principal, delegated scope, and destination audience. Pinning changes relevance, never permissions. Source material is data, not authority to execute instructions found inside it.

On source revision or permission changes, invalidate affected derived caches and mark/recompute drafts as needed. Distinguish removing a board from the working surface from erasing retained evidence. Define deletion and retention policy before hosting; an append-only journal cannot be an excuse to retain private content forever. Revocation prevents future retrieval but cannot recall information already disclosed.

## Storage direction

**Keep this inside pmx-canvas, with SQLite as the initial candidate—not an external wiki requirement.** The important decision is ownership and lifecycle, not committing today to one physical database layout for every hosted team.

An eventual design needs records for boards; knowledge entities and immutable revisions; source references to exact board/node revisions; relations; ownership and access grants; proposals and acceptance events. Preserve source provenance, writer attribution, and acceptance as distinct facts. Treat search and summaries as rebuildable projections, not canonical state.

Commit authoritative state changes and their durable events atomically. A board journal may support board history; workspace knowledge has an independent lifetime and needs its own revision/event coverage. Do not force workspace entities into a board just to reuse a board-local journal. Full event-sourced reconstruction is not required for the first useful knowledge feature.

Use text search and explicit links first. Add embeddings only if retrieval evaluation shows a gap. Physical database placement, cross-database transactions, hosting concurrency, and blob storage remain implementation choices to test later.

### Translate the reference logic into one application

| Reference responsibility | Native canvas equivalent | Do not carry forward as a requirement |
|---|---|---|
| Setup interview and wiki scaffolding | Confirmed role/team/preferences profile, unknowns left explicit, editable context home | Host-specific installation and registration steps |
| Inbox/raw/workspace/wiki/artifacts | Capture, preserved source, active board, maintained knowledge, output with lineage | A folder tree the user must maintain |
| Personal QMD plus shared graph reads | One permission-aware retrieval contract with separate personal/shared scopes and authority labels | QMD dependency or a local mirror of shared canon |
| Promotion staging, hashes, central triage | Source-linked proposed object revision, exact review, transactional publication and audit | Git branch/archive transport or acceptance-as-publication |
| Drift reports and protected personal pages | Revision-aware reconciliation, explicit conflict state, preserved personal divergence | Silent overwrite or “newer timestamp means true” |
| Canvas pins, edges, source/artifact nodes | Board references into durable knowledge and evidence; bounded attention input | Every board becoming canonical or every artifact copied into a wiki |

The database can host all these logical roles without three independent stores. Keep their lifetimes and ownership distinct. Retrieval should return source identity/revision, scope, working/confirmed status, and freshness information consistently—even on fallback/error paths. In a brief, personal relevance and organizational authority are different ranking inputs; neither bypasses access checks. Reuse useful graph semantics before porting entire engines or introducing a universal ontology.

## What to reuse from context-frame

**Reference access, 2026-09-06:** The user supplied Amp projects `pskoett/pmx-context-frame` and `pskoett/pmx-context-frame-personal`, not GitHub repositories. Both now have inspected user-authorized reference transfers. Shared-file comparisons confirmed the prior structural findings. The personal research used transferred local Mac working files, not the empty `origin/main`; the missing-file blocker is resolved. No private personal or business content is reproduced here, and no runtime behavior is inferred merely from successful extraction.

Research records: [workspace project inspection](https://ampcode.com/threads/T-01a075f7-ce1a-717d-b7b5-543983bf386c), [personal project inspection](https://ampcode.com/threads/T-01a075f7-d585-72d2-a929-99e40a2087bb). File ranges below refer to the project named by each subsection, not pmx-canvas.

### Actual personal behavior

- **The lifecycle is already explicit.** Inbox → preserved raw sources → active workspace/canvas/artifacts → maintained wiki → selected shared-candidate staging. Navigation, inventory, and maintenance log are distinct from outputs (`README.md:32–54,132–150`; `wiki/index.md:11–40`; `wiki/wiki-system.md:158–165`).
- **Onboarding by conversation exists as agent instructions.** The setup skill interviews role/team/artifact preferences and namespace, scaffolds profile/team/method pages, leaves unknowns as stubs, updates indexes/log, and can be rerun. External configuration changes require confirmation. This is not a built-in wizard or proof of completed onboarding (`.github/skills/setup/SKILL.md:10,23–34,52–79,81–110`).
- **Private maintenance is not per-edit approval-gated.** Agents are instructed to update maintained pages during work, preserve sources, and update indexes/log. This is task-time editorial responsibility, not guaranteed background automation. Canon reconciliation must preserve intentional personal divergence and not silently overwrite durable pages (`AGENTS.md:79–85`; `wiki/wiki-system.md:70–105,158–175`; `plugins/pmx-frame/skills/update-context/SKILL.md:92–107`).
- **Archive code preserves evidence, not synthesis.** It validates the inbox source and a local target or no-promotion reason, moves the original into a monthly archive, and writes path/time/outcome/target metadata. The agent still decides the reusable learning. Artifact retention is classification-first, not age-only deletion (`scripts/inbox-archive.mjs:24–76`; `artifacts/README.md:13–30`).
- **Personal and shared retrieval are intentionally separate.** QMD indexes only personal wiki, selects `self`, and labels parsed hits `personal-draft`; malformed JSON passes through untagged, so that is not a universal enforced envelope. Bootstrap removes non-self documents and serializes index mutation. Freshness uses mtimes and optional Git lag, not semantic validation (`.qmd/index.yml:1–7`; `scripts/qmd-query.mjs:18–44`; `scripts/qmd-enforce-personal-only.mjs:7–23`; `scripts/qmd-bootstrap.mjs:8–39`; `scripts/qmd-freshness.mjs:118–153`).
- **Authority depends on the question.** Local orientation reads personal navigation and relevant work. For shared facts, shared canon outranks personal drafts, using bounded graph discovery then exact page reads, with a repository fallback when needed. Conflicts are surfaced and personal divergence preserved; the instructions do not justify flattening everything into one undifferentiated index (`AGENTS.md:44–55`; `plugins/pmx-frame/skills/pmx-shared-context/SKILL.md:12–44,56–75,96–112`).
- **Promotion packages selected objects.** Frozen IDs, source metadata, and group-reachable evidence are required by the template; trust is assigned centrally. An admin wrapper delegates validation to a separate canon CLI, computes hashes/actions and source Git state, deposits an inbox batch, and optionally commits locally. It does not itself remotely push or publish canon; admin/private labels are workflow assumptions, not app ACLs (`publish/pmx/object-template.md:6–23,48–55`; `AGENTS.md:87–117`; `scripts/pmx-promote.mjs:220–315`).
- **Maintenance supports judgment.** Scripts report drift, learnings, retention, and unreviewed outputs; template updates preserve user-owned content. They do not automatically synthesize or reconcile the wiki. Scheduled CI checks skill staleness, and no automatic host context-injection hook is shipped (`scripts/pmx-context-sync.mjs:141–208`; `scripts/context-maintenance.mjs:159–175,237–303`; `plugins/pmx-frame/skills/update/scripts/update-derived-frame.mjs:20–47,81–87,140–188`; `.github/workflows/skills-staleness.yml:3–26`; `AGENTS.md:136–148`).
- **Board documentation is not runtime evidence.** `.pmx-canvas/README.md:5–9,22–48` describes personal JSON state/snapshots, but the transferred directory has only documentation/placeholders, no actual board state. The plugin launches external canvas; its skill warns about runtime/version skew. Typed nodes, meaningful edges, artifacts, and pinned neighborhoods describe intended integration, not implemented local board storage (`plugins/pmx-frame/.mcp.json:40–46`; `plugins/pmx-frame/skills/pmx-canvas/SKILL.md:21–28,104–137,176–185,228–236`). Do not replace current canvas SQLite with this potentially stale JSON description; QMD's SQLite is a rebuildable retrieval index, not an authoritative board database.

### Actual workspace behavior

- **A durable object graph, not just templates.** `raw/` retains captures; `wiki/` contains linked durable objects; organization/domain/product/team/person hubs connect strategy, goals, assumptions, experiments, and decisions. Only wiki files feed the graph. Explicit IDs and kinds take precedence over path-derived fallbacks (`docs/architecture.md:3–13,55–91`; `src/context-engine.ts:413–434,530–565,635–661`).
- **Compact-first retrieval is implemented.** One parser/index feeds CLI and graph services; lexical search, node lookup, bounded neighborhoods and paths precede separately fetched full pages. Typed relations retain source page/field and differ from navigational links. Search defaults to 25/max 100 results; neighborhoods max depth 3/max 100 nodes; paths max depth 8; page bodies cap at 256 KiB. These are existing defaults, not proposed canvas budgets (`src/context-engine.ts:590–617,872–960,973–989,1028–1043,1080–1092,1159–1184`; `src/mcp.ts:26–60`).
- **Index freshness is not live synchronization.** Graph metadata is indexed when the service is constructed, while page bodies are read from disk on demand. A canvas implementation should return coherent revisions and invalidate indexes on writes rather than inherit that mismatch. “Stale” currently means overdue `review_by`; “orphan” means zero graph degree, not false or useless content (`src/graph-service.ts:29–46,77–79`; `src/context-engine.ts:1137–1156`).
- **Personal-to-shared promotion is already a deliberate boundary.** Personal frames submit `inbox/promotions/<batch>/`. Central editorial intake rewrites personal observations into neutral shared context, preserves identity/provenance, resolves links, and distributes sources. The workspace contract and personal packaging code support this handoff, but no end-to-end publication was executed during this review (`AGENTS.md:25–53`; `docs/promotion-contract.md:13–23`).
- **Acceptance is not publication.** `promotions:accept` records triage state/history; it does not validate, rewrite, copy, or publish objects. Optional batch lint overlays proposals in a disposable copy. Keep this distinction explicit when implementing transactional publication in canvas (`src/cli.ts:448–457`; `src/promotions.ts:459–535`).
- **Stable identities and provenance are concrete reusable contracts.** Promotion objects specify `id`, `kind`, `title`, `owner`, `status`, `sources`, timestamps, and schema version; namespaced ULIDs survive path/type changes. Manifests describe origins/actions/checksums; triage records actor/reason/history. Enforcement is weaker than the prose: some comparisons run only when fields are supplied, empty object lists warn, and documented `baseCanonRef` lacks implementation (`docs/promotion-contract.md:32–77`; `src/contract.ts:277–333,448–489`; `src/promotions.ts:398–417,428–507`).
- **There is validation, but not hosted authorization.** Duplicate IDs, broken references, and missing local sources fail lint; some missing metadata only warns. The server is anonymous: host/origin checks and limits are not user/workspace ACLs. Compact output is not redacted; it includes owner, summary, and source references. Canon-over-personal precedence is agent guidance, not enforced ranking or authorization (`src/context-engine.ts:725–805,872–886`; `src/server.ts:30–59,89–139`; `docs/space/instructions.md:14–21`).
- **Automation is mixed.** Parsing, querying, lint, contracts, and triage are implemented code. Editorial synthesis remains human/agent work. A weekly/manual agent workflow is checked in, but execution and enablement were not verified; external Space sync is explicitly unbuilt. Promotion-branch CI restrictions do not apply to every writer (`.github/workflows/promotion-check.yml:34–72`; `.github/workflows/weekly-promotion-triage.md:1–44,62–99`; `docs/space-distribution.md:75–88`).

### How this changes the proposal

The workspace reference is substantially more developed than the public example: reuse its object contracts, typed/provenanced relations, bounded graph retrieval, review dates, and explicit promotion states—not merely its folder organization. Translate these semantics into app-owned records and transactions; do not import path fallbacks or Git as required persistence.

Cross-cutting context should connect strategy → objectives → delivery through assumptions, evidence, and decisions. Keep ownership, reporting lines, roles, and cross-domain functions distinct; an operational board must not silently redefine organizational structure. These are current modeling policies, not automatic inference (`docs/context-stack.md:18–44`; `AGENTS.md:55–92`).

**Automatically remember the board; promote selected durable outcomes, not the entire board as shared truth.** The reference's canvas note already describes an external workbench contributing outcomes (`docs/pmx-canvas.md:3–17`). It does not implement the proposed SQLite/personal-wiki integration. Shared accepted objects can then flow back into personal agents' briefs as authorized references—not cloned editable wiki pages. Show source scope and acceptance status when personal interpretations differ from shared decisions; a trust label must not silently erase contrary evidence.

Reviewed personal-to-shared promotion is an existing design on both sides, not a new concept invented by this proposal. Equally important, routine private upkeep is already agent-maintained without blanket per-edit approval. App-enforced publication, revision-conflict checks, complete contract validation, consistent authority labels, and derived-content ACLs remain additions. Source inspection establishes scripts and instructions, not their operational success.

## Oracle challenge and recommendation

The oracle agreed with unified storage/model but rejected unified audience or authority. Its decisive counterexample: a private staffing note influences a shared roadmap summary, which cites only a shared card and converts “consider delaying” into “will delay.” Citation ACL checks and a human review can both pass while confidentiality and decision status are wrong.

Adopt clean destination-scoped synthesis, preserve tentative/rejected/accepted states, and authorize exact content when confirming or publishing it. Do not claim that review detects every leak or that these policies prove security. A person can still paste restricted prose into an already shared source; the product can enforce access and explicit publication, not guarantee leak-proof semantics.

**Second consultation, after both reference inspections:** The oracle endorsed automatic private working revisions under explicit onboarding delegation and corrected its earlier broad review recommendation. Exact authorization belongs at confirmation and disclosure transitions, not every private semantic edit. Crucially, protect confirmed content in retrieval as well as storage: a draft cannot silently become the user's endorsed position merely because it is newer. Working/confirmed revision and personal/shared audience are separate dimensions; triage acceptance is neither confirmation nor publication. This policy is a proposed native-app refinement, not a claim that the reference scripts already enforce it.

## Validation and sequence

**Exercise the spatial promise too:** within the same task, deliberately change a pin, annotation, or meaningful relationship and inspect how the next brief and agent response reflect that curation. Compare with the uncurated result. Do not count a changed board layout alone as evidence of better agent behavior, or interpret incidental camera motion as a command.

1. **Now: test the knowledge loop without building hosting.** Use one small wiki and two named conceptual boards across three real non-canvas PM sessions. Delegate private maintenance once; let the assistant update source-linked working pages during tasks without compulsory review. Separate personal/shared source packets manually. Include a synthetic private fact, a completed decision, a rejected option, and contradictory newer evidence. Use a clean agent to answer fixed questions in the next session from labeled drafts plus confirmed/shared context.
2. **Measure usefulness and failure.** Compare maintenance, interruptions, corrections, undo, and next-session reconstruction time against the current workflow. Do not require reviewing accumulated drafts before measuring value. Require the private fact not to appear or influence shared recommendations; tentative/rejected options not to become decisions; completed decisions to be retrieved; confirmed claims to retain exact source/revision references. Test the conditional-launch example through summaries and structured relations, undo followed by a fresh read, and an embedded source instruction falsely claiming approval. Separately verify that triage acceptance does not publish, authorization for revision A/destination X does not cover B/Y, and a released outcome exposes no private source metadata. These are product-policy experiments, not proof of implemented authorization.
3. **Local foundation:** preserve and explicitly target multiple boards, unify mutation policy, add durable identity/revisions, and deliver a useful budgeted read. Prototype private evidence/digest/proposal behavior only after the experiment shows value. No hosted platform prerequisite.
4. **Hosted pilot, later:** implement authenticated roles and source-scoped retrieval, publication, revocation, retention, backups, and isolated rendering. Test with at least two principals, private and shared boards, denied reads, cached results, history, and malicious source instructions. A single-tenant pilot still needs internal permissions.
5. **Cross-cutting workspace context:** derive shared dependencies and conflicting decisions from authorized shared entities. Start with explicit links and proposed reconciliations, not invisible aggregation of employee context. Expand only if another user benefits without maintaining a second wiki manually.

If maintenance plus reconstruction is not cheaper than reconstruction alone, simplify automatic memory and reduce the confirmed surface. Keep useful labeled drafts rather than forcing a larger review queue. Do not lower the publication threshold merely to make the metric look better.

### Open decisions for the next discussion

- Is the initial wiki primarily a personal continuity tool, with sharing later, or must the first hosted pilot demonstrate team reuse? Recommendation: personal value first, permission-safe team reuse as the pilot gate.
- Should personal space belong to the individual or employer tenant, and what survives leaving a workspace? This materially affects portability and deletion; do not infer the answer from a filesystem workspace.
- Who may publish workspace knowledge: every contributor, an entity owner, or a role? Start with explicit roles and avoid mandatory review by a second person unless the team needs it.
- What does a board's wiki entry show by default: a source listing, a working digest, or both? Recommendation: both, clearly distinguished from accepted pages.
- Which private sources may the assistant maintain from by default, and what consequential replacements must it ask about? Recommendation: explicit onboarding delegation, reversible working revisions, no silent replacement of confirmed content, and a distinct share action.

## Local evidence inspected

- [SQLite schema and persistence](../src/server/canvas-db.ts): durable layout, node data, snapshots, and AX tables.
- [Node provenance](../src/server/canvas-provenance.ts): source kind, URI, refresh strategy, and snapshot metadata; not authenticated writer identity.
- [AX context builder](../src/server/ax-context.ts): current previews and bounded pending-steering selection, not the proposed unified permission-aware brief.
- [HTTP operation adapter](../src/server/operations/http.ts): workbench classification from a caller-supplied header.
- [Registry](../src/server/operations/registry.ts) and [SDK](../src/server/index.ts): mutation policy and direct state-call paths relevant to trusted history.
