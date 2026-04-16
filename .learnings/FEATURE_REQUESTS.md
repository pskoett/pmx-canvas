# Feature Requests

Missing capabilities and repeated user asks captured for future consideration.

Use the `self-improvement` skill format for new entries.

## [FEAT-20260415-001] group-create-preserve-child-positions

**Logged**: 2026-04-15T00:00:00Z
**Priority**: medium
**Status**: pending
**Area**: backend

### Requested Capability
`group create` should support preserving child node world positions instead of silently shifting them when the group frame is created.

### User Context
During a full canvas rebuild with pixel-placed OKR cards, grouping moved a node from `x=680` to `x=768` because group padding and containment logic repositioned children. This is surprising when layouts are being placed deliberately.

### Complexity Estimate
medium

### Suggested Implementation
Add an option such as `preserveChildPositions: true` / `--preserve-positions` so group creation computes the frame around existing children without translating them. If current behavior remains default, document it explicitly in CLI help and the PMX Canvas skill.

### Metadata
- Frequency: first_time
- Related Features: group create, placement, auto-layout

---

## [FEAT-20260415-002] batch-canvas-operations

**Logged**: 2026-04-15T00:00:00Z
**Priority**: high
**Status**: pending
**Area**: backend

### Requested Capability
Add a batch canvas operation entrypoint so agents can submit an ordered list of node, edge, pin, snapshot, and update operations in one call.

### User Context
A clean rebuild required 31 sequential CLI calls: 16 `node add`, 3 `group create`, 6 `edge add`, 2 `pin`, 1 `snapshot save`, and 3 `node update --lock-arrange`. This is slow and increases coordination overhead for agents constructing dashboards or investigation boards.

### Complexity Estimate
complex

### Suggested Implementation
Add `pmx-canvas batch --file spec.json` and a matching HTTP/MCP operation that accepts an ordered array of operations with optional result references. Support at least: `node.add`, `node.update`, `edge.add`, `group.create`, `pin.set`, `snapshot.save`, and `arrange`.

### Metadata
- Frequency: recurring
- Related Features: node add, edge add, group create, pin, snapshot save

---

## [FEAT-20260415-003] node-add-return-geometry

**Logged**: 2026-04-15T00:00:00Z
**Priority**: high
**Status**: pending
**Area**: backend

### Requested Capability
`node add` should return created node geometry, not just `{ ok, id }`.

### User Context
When stacking nodes vertically, agents need the actual post-create `position` and `size` to place the next node accurately. Today they must guess heights and then call `node get` to confirm, which adds an extra round-trip for every node in a composed layout.

### Complexity Estimate
simple

### Suggested Implementation
Return `{ ok, id, position, size }` from node creation endpoints and CLI/MCP wrappers. For auto-sized node types, return the final stored size after creation rather than only the requested size.

### Metadata
- Frequency: recurring
- Related Features: node add, node get, layout authoring

---

## [FEAT-20260415-004] search-based-edge-creation

**Logged**: 2026-04-15T00:00:00Z
**Priority**: medium
**Status**: pending
**Area**: backend

### Requested Capability
Allow edge creation by node search rather than only explicit node IDs.

### User Context
While constructing a board, the agent had to track IDs manually to connect semantically related nodes. A command like `edge add --from-search "DVT O2" --to-search "deep work"` would reduce bookkeeping and simplify agent scripts.

### Complexity Estimate
medium

### Suggested Implementation
Add CLI and MCP support for `fromSearch` / `toSearch` or `--from-search` / `--to-search`. Resolve to a unique node by title/content search and fail fast when matches are ambiguous or missing.

### Metadata
- Frequency: first_time
- Related Features: edge add, search, normalized title/content

---

## [FEAT-20260415-005] settable-group-frame

**Logged**: 2026-04-15T00:00:00Z
**Priority**: medium
**Status**: pending
**Area**: backend

### Requested Capability
Support manually positioning and sizing a group frame independently from current child bounds.

### User Context
Current groups are fully computed from children plus padding. The user wanted the ability to place a group frame deliberately and then arrange children within it, rather than having children entirely determine the group geometry.

### Complexity Estimate
complex

### Suggested Implementation
Add a mode where group `x`, `y`, `width`, and `height` are authoritative, and optionally provide an `arrange-children` operation that packs member nodes inside the frame. Preserve current auto-fit behavior as a default mode.

### Metadata
- Frequency: first_time
- Related Features: group create, group add, arrange, lock-arrange

---

## [FEAT-20260415-006] containment-aware-validate

**Logged**: 2026-04-15T00:00:00Z
**Priority**: medium
**Status**: pending
**Area**: backend

### Requested Capability
Add a `validate` command that distinguishes intentional group containment from accidental node collisions.

### User Context
A layout validator reported 15 overlaps, but they were all expected parent-group containment cases. This makes overlap checks noisy and reduces trust in validation output for grouped canvases.

### Complexity Estimate
medium

### Suggested Implementation
Add `pmx-canvas validate` with checks for overlaps, off-canvas placement, missing edge endpoints, and arrange-locked conflicts. Treat child-inside-parent containment as valid and report true sibling collisions separately.

### Metadata
- Frequency: first_time
- Related Features: groups, layout validation, auto-arrange

---
