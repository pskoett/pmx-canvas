# ADR-001: Bun-only runtime, MCP + HTTP as the universal surfaces

**Status:** Accepted
**Date:** 2026-06-12
**Context for:** v0.2 stability release (docs/tech-debt-assessment-2026-06.md, Phase 2)

## Context

pmx-canvas ships as TypeScript source executed directly by Bun. `package.json` points `main`/`exports` at `src/server/index.ts`, the `bin` entry is `src/cli/index.ts` with a `#!/usr/bin/env bun` shebang, and `engines` requires `bun >= 1.3.14`. There is no compiled JS distribution; `dist/` carries only the client bundle, the json-render viewer, and type declarations.

The runtime dependence on Bun is not incidental. `Bun.serve` is the HTTP + SSE server, `bun:sqlite` is the persistence layer, `Bun.WebView` backs the screenshot/evaluate automation tools, and `bun test` is the test runner. These are load-bearing APIs across `src/server/`, not shims that a bundler could paper over.

The recurring question is whether v0.2 should add a Node-compatible dual build (ESM + CJS dist, ported server internals) so Node projects can `import 'pmx-canvas'`. The tech debt assessment already leaned no; this ADR makes the decision explicit and binding.

The decisive observation: nobody integrates with pmx-canvas by importing it. Agents connect over MCP (stdio). Everything else (scripts, harnesses, CI, other languages) talks HTTP + SSE on localhost. The in-process SDK is a convenience for Bun-native tooling and our own CLI, not the distribution channel. A Node build would be sustained effort (porting `Bun.serve`, replacing `bun:sqlite`, a second test matrix, a real build step where today there is none) spent on the least differentiated integration path, while the operation registry refactor is actively consolidating the surfaces that do matter.

## Decision

pmx-canvas stays Bun-only for the SDK and runtime.

1. MCP (stdio) and the HTTP API are the universal integration surfaces. They are runtime-agnostic by construction: any client that can spawn a process or open a socket can use them.
2. No Node dual-build (ESM + CJS dist of the server/SDK) will be produced. The package continues to ship TypeScript source executed by Bun.
3. The programmatic SDK (`import { createCanvas } from 'pmx-canvas'`) is documented as Bun-runtime-only.
4. Bun-specific APIs (`Bun.serve`, `bun:sqlite`, `Bun.WebView`, `bun test`) remain first-class; no compatibility shims are added for hypothetical Node hosting.

## Consequences

The honest costs:

- **Node-based programmatic consumers cannot import the package.** A Node project that wants canvas access must run the server (any of: `bunx pmx-canvas`, a daemon, MCP auto-start) and integrate over HTTP or MCP. This is a real limitation for anyone wanting in-process embedding from Node, and we are accepting it deliberately.
- **`bin` requires bun on PATH.** The CLI shebang is `#!/usr/bin/env bun`. `npm install -g pmx-canvas` succeeds but the binary fails at invocation on a machine without bun.
- **npx-style installation has a sharp edge.** `npx pmx-canvas` fetches the package fine but execution still resolves the bun shebang; without bun installed it fails with a confusing error rather than a clear "install bun" message. `bunx pmx-canvas` is the canonical one-shot command and docs must lead with it. The README and CLI install docs should state the bun prerequisite up front, and a fast preflight check in `src/cli/index.ts` that prints an actionable message when bun is missing is cheap insurance (worth doing, not required by this ADR).
- **MCP client configs must spawn bun.** MCP server entries point at `bunx pmx-canvas --mcp` (or a bun invocation), not `node`/`npx`. Example configs in docs must be consistent about this.
- **We forgo the npm-ecosystem long tail.** Some integrations will never happen because `import` was the only path their authors would take. We judge that tail small relative to the agents-over-MCP center of mass.

What we gain: zero build step for the server, one runtime to test against, continued free use of `bun:sqlite` and `Bun.serve` without abstraction layers, and engineering time pointed at the operation registry and AX surface instead of distribution plumbing.

## Alternatives considered

- **Full Node dual-build (ESM + CJS dist).** Requires replacing `Bun.serve` (Hono/Express adapter), `bun:sqlite` (better-sqlite3, a native dependency with its own install pain), and dropping or forking `Bun.WebView`. Doubles the test matrix permanently. Rejected: high sustained cost on the path with the least demand.
- **Node-compatible SDK client only (thin HTTP wrapper published for Node).** Cheaper, but it is just a typed fetch client; any consumer can write one in an afternoon, and an official one creates a second public surface to version and freeze. Rejected for v0.2; can be revisited if real demand appears, without violating this ADR (the server stays Bun-only either way).
- **Compile-to-single-binary (`bun build --compile`).** Solves "bun on PATH" for the CLI but not programmatic import, adds per-platform release artifacts, and complicates the MCP spawn story. Out of scope for v0.2; does not change this decision.

## Revisit triggers

Reopen this ADR if (a) a major MCP host platform cannot spawn bun, or (b) repeated, concrete integration requests arrive that HTTP/MCP genuinely cannot serve (in-process embedding with shared memory, for example). Absent those, Bun-only stands.
