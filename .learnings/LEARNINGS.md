# Learnings

Corrections, insights, and knowledge gaps captured during development.

**Categories**: correction | insight | knowledge_gap | best_practice
**Areas**: frontend | backend | infra | tests | docs | config
**Statuses**: pending | in_progress | resolved | wont_fix | promoted | promoted_to_skill

## Status Definitions

| Status | Meaning |
|--------|---------|
| `pending` | Not yet addressed |
| `in_progress` | Actively being worked on |
| `resolved` | Issue fixed or knowledge integrated |
| `wont_fix` | Decided not to address (reason in Resolution) |
| `promoted` | Elevated to CLAUDE.md, AGENTS.md, or copilot-instructions.md |
| `promoted_to_skill` | Extracted as a reusable skill |

## Skill Extraction Fields

When a learning is promoted to a skill, add these fields:

```markdown
**Status**: promoted_to_skill
**Skill-Path**: skills/skill-name
```

Example:
```markdown
## [LRN-20250115-001] best_practice

**Logged**: 2025-01-15T10:00:00Z
**Priority**: high
**Status**: promoted_to_skill
**Skill-Path**: skills/docker-m1-fixes
**Area**: infra

### Summary
Docker build fails on Apple Silicon due to platform mismatch
...
```

---

## [LRN-20260412-001] correction

**Logged**: 2026-04-12T00:00:00Z
**Priority**: medium
**Status**: resolved
**Area**: config

### Summary
Do not import upstream shared skills into this repo just because they exist upstream; keep only repo-relevant skills in the mirrored agent skill set.

### Details
An upstream refresh from `pskoett/pskoett-ai-skills` pulled in `dx-data-navigator`, but that skill is not relevant to `pmx-canvas`. For future syncs, compare upstream additions against repo scope before adding them to `.agents/skills`, `.claude/skills`, `.opencode/skills`, or the local mirror validator.

---

## [LRN-20260415-001] correction

**Logged**: 2026-04-15T00:00:00Z
**Priority**: medium
**Status**: pending
**Area**: docs

### Summary
Do not equate CLI/MCP parity with smooth end-to-end canvas authoring; full rebuild testing still surfaces workflow friction that API parity checks miss.

### Details
An audit concluded that CLI and MCP had parity for the overlapping canvas operations, which was true at the API surface level. A subsequent full board rebuild still exposed authoring friction around grouping behavior, batch creation, geometry visibility on create, search-based edge creation, group-frame control, and containment-aware validation. Future “parity complete” claims should be scoped explicitly to shared operations, not broader authoring ergonomics.

### Suggested Action
When closing parity work, separate:
1. shared-surface parity,
2. end-to-end workflow ergonomics,
3. known wishlist items from real rebuilds.

### Metadata
- Source: user_feedback
- Related Files: .learnings/FEATURE_REQUESTS.md
- Tags: parity, workflow, canvas, authoring

---
