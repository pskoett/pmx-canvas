# Release process

Internal recipe for cutting a new `pmx-canvas` release. Lives in `docs/`
rather than the README so end-user agents and humans driving the canvas
aren't distracted by maintainer-only flow. Agents working **on** this
repo (improving the canvas itself) should treat this file as the
single source of truth for the release dance — see also
[`AGENTS.md`](../AGENTS.md) and [`CLAUDE.md`](../CLAUDE.md).

## TL;DR

1. Land all the changes you want in the release on `main` with green CI.
2. Bump `package.json` `version`.
3. Add a `## [X.Y.Z]` block to `CHANGELOG.md`.
4. Commit, push, wait for `test.yml` green.
5. `git tag -a vX.Y.Z -m "..." && git push origin vX.Y.Z` →
   `publish.yml` runs `npm publish --access public --provenance`.
6. `gh release create vX.Y.Z --notes-file <notes.md>`.
7. Smoke-test the published tarball: `bunx pmx-canvas@X.Y.Z --no-open`.

## Pre-flight gates

Run these locally before tagging. They mirror what `publish.yml`
re-runs in CI; a failure here means the publish workflow will also fail.

```bash
bun install --frozen-lockfile
bun run typecheck
bun run build
bun test tests/unit         # 200+ tests, all green
bun run test:web-canvas     # Playwright E2E, all green
bun run test:e2e-cli        # fresh-workspace CLI eval
bun run release:check       # bundles + lints
bun run release:smoke       # packs + boots from a clean dir
bun run pack:dry-run        # confirms the tarball shape
```

`bun run test:web-canvas` invokes Playwright through
`scripts/run-playwright.sh`, which runs the Playwright CLI under Node —
do not call `bun x playwright test` directly; it fails before test
discovery with a `.esm.preflight` loader error (ERR-20260508-001).

`bun run test:e2e-cli` starts a local server in a fresh temp workspace
and exercises the CLI flows from
[`docs/evals/e2e-cli-coverage.md`](evals/e2e-cli-coverage.md).

## Versioning

Semantic versioning, in 0.x semver honestly (see `docs/api-stability.md`).
We are pre-1.0, so minor versions — not just major — are the breaking-change
boundary:

- Patch (`0.x.y → 0.x.y+1`): bug fixes, hardening, internal cleanups,
  additive CLI flags / MCP fields with backwards-compat fallbacks. Never
  breaks a public surface.
- Minor (`0.x → 0.x+1`): documented breaking changes are allowed only here
  (e.g. the 0.2 → 0.3 removal of the 57 deprecated legacy single-purpose MCP
  tools in favor of their composite replacements). Every breaking change in
  a minor needs a `### Breaking` CHANGELOG entry naming the replacement —
  see the release-blocker gate below.
- Major (`0.x → 1.0`): production-stability commitment.

CLAUDE.md rule #5 (CanvasStateManager / PmxCanvas SDK / HTTP / MCP
four-layer parity) is the strongest hard rule for what counts as
non-breaking — a CLI/HTTP-only addition without MCP parity has
historically required a follow-up patch release to restore parity.

## CHANGELOG

`CHANGELOG.md` follows [Keep a Changelog](https://keepachangelog.com/).
Each release section uses these subheadings:

- **Added** — new public surface (HTTP endpoint, MCP tool/resource, CLI
  command/flag, SDK export, JSON shape).
- **Changed** — behavior changes that aren't strictly bug fixes
  (response shape additions, schema cleanups, stricter validation).
- **Breaking** — removed or incompatibly changed public surface (see
  `docs/api-stability.md`). Required at minor version boundaries whenever a
  public surface breaks; must name the replacement.
- **Deprecated** — public surface marked for removal in a future minor,
  per the `docs/api-stability.md` deprecation policy.
- **Fixed** — bug fixes.
- **Internal** — refactors, test additions, docs that don't affect
  the public surface.

Don't ship a release without a CHANGELOG entry. The GitHub release
notes file (`/tmp/pmx-canvas-vX.Y.Z-release-notes.md` by convention)
expands on the CHANGELOG with examples and migration notes.

**Release-blocker gate:** a breaking change without a `### Breaking`
CHANGELOG entry blocks the release (`docs/api-stability.md`). Check the
diff against the previous tag for removed/renamed public surface — MCP
tool names, HTTP routes, SDK exports, CLI flags — before tagging; if
anything broke and isn't named under `### Breaking`, add the entry first.

## Tag → publish

The publish workflow ([`/.github/workflows/publish.yml`](../.github/workflows/publish.yml))
triggers on tags matching `v*`:

```bash
git tag -a v0.1.6 -m "v0.1.6 — short summary"
git push origin v0.1.6
```

It will:

1. Verify the tag matches `package.json` version.
2. Re-run typecheck / build / unit / E2E / pack.
3. `npm publish --access public --provenance` using the `NPM_TOKEN`
   secret. Provenance attestations are signed via sigstore and visible
   on the npm package page.

Watch it complete:

```bash
gh run watch
```

If publish fails after npm has accepted the tarball, you cannot reuse
the same version number. Bump the patch and re-tag.

If this is the first release from your machine, run `bunx npm login`
once so Bun can reuse your npm credentials. CI does not need this —
it uses `NPM_TOKEN` directly.

## GitHub release

After `npm publish` succeeds:

```bash
gh release create v0.1.6 \
  --title "pmx-canvas 0.1.6 — short theme" \
  --notes-file /tmp/pmx-canvas-v0.1.6-release-notes.md \
  --verify-tag
```

`--verify-tag` makes the command fail if the local tag drifted from
the remote — a small but useful guard.

## Smoke test from npm

```bash
cd /tmp && rm -rf smoke && mkdir smoke && cd smoke
bunx --bun pmx-canvas@<version> --no-open --port=4926 > smoke.log &
SP=$!
for i in 1 2 3 4 5 6 7 8 9 10; do
  curl -sf http://localhost:4926/health >/dev/null 2>&1 && break
  sleep 1
done
curl -s http://localhost:4926/health      # → {"ok":true,"workspace":"…"}
bunx pmx-canvas@<version> --version       # → <version>
kill $SP
```

If `bunx pmx-canvas@<version>` resolves and the health endpoint replies
with `ok: true`, the published tarball is intact end-to-end.

## Common gotchas

- **`/.pmx-canvas/artifacts/.web-artifacts/sdlc-control-room/.parcel-cache/`**
  files always show as modified after running an artifact build. They
  are workspace-local cache and must not be committed; they're gitignored
  but still appear in `git status`. Use `git restore --staged` if they
  sneak into a `git add -A`.
- **`docs/screenshot.png`** updates whenever the showcase E2E runs.
  Don't bake those updates into a release commit unless the screenshot
  in `Readme.md` actually needs the refresh.
- **CHANGELOG dates**: use the actual publish date in the
  `## [version] - YYYY-MM-DD` header, not the day you wrote the entry.
- **Node 24 deprecation timeline**: GitHub Actions is migrating
  `actions/checkout`, `setup-node`, `upload-artifact` to Node 24 by
  June 2, 2026. The publish workflow already pins `@v5` of all three.
