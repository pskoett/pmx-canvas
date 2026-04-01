# Errors

- 2026-03-31: When mirroring a skill into `.agents/`, audit the canonical `skills/.../SKILL.md` against the current CLI and HTTP/MCP surface first. Do not assume copying the existing skill is sufficient.
- 2026-03-31: When setting up PMX Canvas for manual testing, verify the browser entry URL itself. Do not assume `localhost:<port>/` works just because the API and `/workbench` do.
- 2026-03-31: When verifying canvas connections, check browser-visible edge rendering, not just stored edge count. An absolute-positioned SVG with `width: 100%; height: 100%` can disappear if its parent has no explicit size.
- 2026-03-31: Verify context-menu actions against live handlers. `Open in browser` and `Copy path` were exposed for markdown nodes without a real path, while `/artifact?path=...` was also stale.
- 2026-03-31: Resolve web-artifact paths and skill lookups against the active canvas workspace root, not `process.cwd()`. Otherwise `/api/canvas/web-artifact` can build files outside the server workspace and `/artifact?path=...` will 404 in tests or non-default workspaces.
