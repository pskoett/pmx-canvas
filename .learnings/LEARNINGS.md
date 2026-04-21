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

## [LRN-20260420-001] best_practice

**Logged**: 2026-04-20T00:00:00Z
**Priority**: medium
**Status**: pending
**Area**: frontend

### Summary
Never hardcode `rgba()` or hex colors in component inline styles when the app supports multiple themes — always route through a CSS custom property so paper/dark/high-contrast all stay legible.

### Details
The `ExpandedNodeOverlay` title bar used `background: 'rgba(10,14,30,0.6)'` inline. In the dark theme this blends to a pleasing glassy navy; in the paper theme the same rule composites the dark navy at 60% over a cream panel to a muddy gray, and the action buttons (text `--c-muted` / border `--c-line`) lose contrast against it and appear blank. Same pattern applied to the `MD` pill's hardcoded `rgba(70,182,255,0.12)`. Fix was to swap to theme tokens (`var(--c-panel-glass)`, `var(--c-accent-12)`) that each theme defines.

### Suggested Action
When writing inline styles in TSX for chrome (bars, pills, chips, shadows, overlays):
1. Reach for a `--c-*` token; if none fits, add one per theme in `src/client/theme/global.css` first.
2. Treat a literal `rgba(…)` or `#` in an inline `style` as a smell — grep before submitting.
3. Verify visually in all three themes, not just the default one.

### Metadata
- Source: user_feedback
- Related Files: src/client/canvas/ExpandedNodeOverlay.tsx, src/client/theme/global.css
- Tags: theming, contrast, frontend, light-theme, paper

---

## [LRN-20260421-001] best_practice

**Logged**: 2026-04-21T00:00:00Z
**Priority**: high
**Status**: resolved
**Area**: frontend

### Summary
Debounced-save callbacks that read their latest content from React/Preact state close over a snapshot at callback-creation time — ⌘S, blur, and unmount cleanups must either (a) receive the fresh value from the emitter, or (b) read it from a ref kept in sync during the input path. Otherwise every "immediate save" silently persists a one-keystroke-stale version.

### Details
`MarkdownNode.handleInlineSave` originally called `persistContent(content)` where `content` was React state. The editor's `onSave` was invoked synchronously from `⌘S` / blur — before the pending `setContent(md)` from the just-prior `handleInlineChange` had flushed. Result: ⌘S saved the previous keystroke, not the current one. The editor's cleanup effect on unmount cancelled the debounce timer without flushing, so switching nodes mid-edit silently dropped the last 800 ms of work. Fix: `InlineMarkdownEditor` now serializes fresh markdown at each boundary and passes it through `onSave(md: string)` / `onChange(md: string)`. `MarkdownNode` mirrors the latest md into `latestMdRef` and `persistContent` into `persistFnRef`, so the unmount cleanup flushes with the authoritative values.

### Suggested Action
When adding a debounced-save path, assume the user will trigger "save now" (⌘S, blur, window-close, route-change) mid-debounce. Design the save signal to carry the payload, not re-read from state. Unmount cleanups that only `clearTimeout` the debounce without flushing should be treated as a bug by default.

### Metadata
- Source: audit_agent_finding (spec-auditor)
- Related Files: src/client/nodes/InlineMarkdownEditor.tsx, src/client/nodes/MarkdownNode.tsx
- Tags: debounce, save, state, stale-closure, data-loss

---

## [LRN-20260421-002] best_practice

**Logged**: 2026-04-21T00:00:00Z
**Priority**: high
**Status**: resolved
**Area**: frontend

### Summary
`document.execCommand('createLink', ...)` does not validate the URL scheme — `javascript:` payloads survive into the DOM and execute on click even when the app is localhost-only, because a malicious markdown file opened locally still runs in the page origin.

### Details
The floating-toolbar link action took `window.prompt('Link URL:')` and passed it straight to `execCommand('createLink')`. A user (or agent) pasting `javascript:alert(document.cookie)` would produce an anchor that executes on click in the page origin. Localhost does not neutralize this. Fix: trim + lowercase the URL and reject values starting with `javascript:` or `data:` before calling `execCommand`.

### Suggested Action
Treat any code path that writes arbitrary URL strings into `href` (or `src`) as requiring a scheme allowlist/denylist. Keep the check co-located with the insertion so it can't be bypassed by new call sites.

### Metadata
- Source: audit_agent_finding (harden-auditor)
- Related Files: src/client/nodes/inline-editor-commands.ts
- Tags: xss, contenteditable, execCommand, url-validation

---

## [LRN-20260420-002] insight

**Logged**: 2026-04-20T00:00:00Z
**Priority**: low
**Status**: resolved
**Area**: frontend

### Summary
For "seamless" inline editing inside an existing opinionated UI, a bare textarea styled from the clicked block's `getComputedStyle()` beats dropping in a library WYSIWYG editor (Milkdown Crepe / TipTap / Lexical).

### Details
Attempted to get Confluence-style inline editing by adding `@milkdown/crepe`. Bundle jumped 203KB → 2.96MB (Crepe bundles Vue + ProseMirror + CodeMirror + Katex). Crepe's floating widgets (slash menu, toolbar, link tooltip, table controls) rendered as stacked in-flow blocks inside our overlay instead of floating over the document, and list markers went missing — the Vue-mounted widgets assume a DOM/positioning context that conflicts with our custom overlay. Ripping it back out and polishing the existing click-a-block flow (strip textarea chrome, capture `window.getComputedStyle()` of the clicked block at click time, apply its font/size/weight/line-height/padding/margin inline to the textarea, auto-save on blur) delivered a genuinely seamless view→edit transition with zero new dependencies.

### Suggested Action
Default to custom when the host UI is already opinionated. Reach for a WYSIWYG library only if the feature set (slash menus, collaborative cursors, embeds) is the actual goal — not just "smoother editing."

### Metadata
- Source: implementation_attempt
- Related Files: src/client/nodes/MarkdownNode.tsx, src/client/theme/global.css
- Tags: editor, wysiwyg, inline-edit, library-choice, bundle-size

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
