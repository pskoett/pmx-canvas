---
name: published-consumer-e2e
description: Re-run PMX Canvas like an external user by packing the repo, installing the tarball into a clean temp workspace, seeding the SDLC demo, and validating it in a browser. Use when asked to verify the published-package workflow, artifact/json-render coverage, or the full outside-in demo.
---

# Published Consumer E2E

Use this skill when the goal is to test PMX Canvas from the outside instead of the repo dev path.

## Default Path

Run:

```bash
bash skills/published-consumer-e2e/scripts/run-published-consumer-e2e.sh
```

That script will:

1. pack the current repo as a tarball,
2. create a clean temp consumer workspace,
3. install the tarball with Bun,
4. copy `examples/published-consumer-sdlc/` into that workspace,
5. start the seeded demo through the package's public SDK,
6. run a headed `playwright-cli` browser pass that snapshots the live workbench and asserts the article, artifact, json-render, graph, trace, and context surfaces are present.

## Flags

- `--port=4600` to change the server port
- `--skip-playwright` to stop after pack/install + HTTP smoke
- `--headless` if a visible browser is impossible
- `--keep-running` to leave the temp consumer server alive after the script exits
- `--workdir=/tmp/custom-dir` to reuse a known temp location

## Notes

- Install the browser tool once with `bun add -g @playwright/cli@latest`.
- Default to headed browser validation so the human can watch the run.
- Prefer the script over manually rebuilding the temp consumer.
- If you change the example assets or this browser test, rerun the full script instead of repo-only tests.
- The script assembles the tarball manually instead of relying on `npm pack` or `bun pm pack`, because pack/build commands can hang in this workspace.
- The skill uses `playwright-cli` instead of the repo-local `playwright test` path because the local Playwright CLI is currently incompatible with the Bun/Node mix in this environment.
- On failure, inspect the temp workspace log path printed by the script before changing code.
