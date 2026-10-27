---
name: published-consumer-e2e
description: Re-run PMX Canvas like an external user by packing the repo, installing the tarball into a clean temp workspace, seeding the SDLC demo, and validating it in a browser. Use when asked to verify the published-package workflow, artifact/json-render coverage, or the full outside-in demo.
---

# Published Consumer E2E

Use this skill when the goal is to test PMX Canvas from the outside instead of the repo dev path.

This helper requires a **source checkout**, Bun, Python 3, curl, and (for browser checks) Node
and the repo's Playwright dependencies/browser. The npm package ships this skill but not
`examples/`, `tests/`, or the source test runner. Installing the skill alone is not sufficient.
For an installed-only consumer, verify public CLI/MCP/HTTP/SDK operations in a disposable
workspace instead; do not claim this source helper ran.

## Default Path

From the source checkout, install dependencies and build the publishable assets first:

```bash
bun install
bun run build
bash skills/published-consumer-e2e/scripts/run-published-consumer-e2e.sh
```

That script will:

1. run `bun pm pack` against the real `package.json` publish surface, including skills,
   docs, plugins and TypeScript declarations,
2. create a clean temp consumer workspace,
3. install the tarball with Bun,
4. copy `examples/published-consumer-sdlc/` into that workspace,
5. start the seeded demo through the package's public SDK,
6. run the existing `tests/e2e/published-consumer.pw.ts` through the Node Playwright runner,
   headed by default, asserting visible artifact/JSON/graph content, context pins, node types
   and the saved baseline snapshot.

This proves a local packed install, not the identity or integrity of a registry release.

## Flags

- `--port=4600` to change the server port
- `--skip-playwright` to stop after pack/install + HTTP smoke
- `--headless` only when explicitly requested
- `--keep-running` to leave the temp consumer server alive after the script exits
- `--workdir=/tmp/custom-dir` to choose an empty temp location (existing files are never replaced)

## Notes

- Install the repo's matching browser with `bun run test:install-browsers` if needed.
- Default to headed browser validation so the human can watch the run.
- Prefer the script over manually rebuilding the temp consumer.
- If you change the example assets or this browser test, rerun the full script instead of repo-only tests.
- Run on a dedicated port. In Amp orbs the server uses a supervised service; otherwise it reports
  a process ID. With `--keep-running`, stop the printed `PMX_SERVER_SERVICE` using
  `amp orb service stop <name>`, or terminate the printed `PMX_SERVER_PID` outside an orb.
- The browser runner also starts the repo config's separate fixture server. Set
  `PMX_PLAYWRIGHT_PORT` to a free port when running alongside another browser suite.
- Logs, tarball and browser failure artifacts remain in the printed temp workspace for inspection.
- On failure, inspect the temp workspace log path printed by the script before changing code.
