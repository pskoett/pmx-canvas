# Eval: does each AGENTS.md section change what agents do?

Run 2026-10-26. Rerun it whenever a section is added or questioned; delete sections that change
nothing, rewrite sections that change behaviour in the wrong direction.

## Method

1. Copy `AGENTS.md` into neutrally named directories: the full file (control) and one copy per
   treatment with a single `##` section removed.
2. Start three subagents per variant. Each reads only its copy and writes the work plan it would
   follow for two fixed requests, without implementing:
   - "Wiki aliases inside fenced code blocks get turned into links on Markdown cards. Fix it."
   - "Add a lastSavedAt field to GET /health."
3. Score each plan on observable choices: skills named, plan mode, subagents, and the core
   verification steps (failing test first, `pmx_canvas_health`, live check, docs and changelog).

Plans, not implementations: this measures what the instructions steer, which is what a section
can change. Subagents may also see the real repository guidance, which would shrink differences.

## Results (n = 3 per variant)

| Variant | Pipeline skills named | Plan mode (request 1 / 2) | Plans using a subagent | Core verification |
|---|---|---|---|---|
| Full file | 3/3 | 2/3 · 3/3 | 5/6 | 3/3 |
| Without Agent Skill Pipeline | 0/3 | 3/3 · 3/3 | 3/6 | 3/3 |
| Without Workflow Orchestration | 3/3 | 0/3 · 0/3 | 1/6 | 3/3 |

`bun run acceptance` appeared in 2/3, 0/3 and 2/3 plans respectively; with n = 3 that is not
distinguishable from noise.

## Decisions

- **Workflow Orchestration: deleted.** Its only effect was plan mode and subagents for a one-file
  fix and a one-field change, which Amp's own guidance and Core Principles 1 and 4 already govern.
  Verification was identical without it.
- **Agent Skill Pipeline: kept, corrected.** Removing it drops the owner's pipeline skills from
  every plan, so it is load-bearing. It wrongly said the skills exist only in gitignored local
  trees; they are global user skills, available in every orb.
