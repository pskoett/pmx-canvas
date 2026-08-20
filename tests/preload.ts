// Loaded by bunfig.toml [test].preload for EVERY `bun test` invocation.
//
// The unit suite exercises the real open-as-site path, and
// `openUrlInExternalBrowser` genuinely launches the user's browser unless
// PMX_CANVAS_DISABLE_BROWSER_OPEN=1. That guard used to live only in the
// package.json script wrappers, so any direct `bun test tests/unit/...`
// run (agents and humans both do this constantly) turned the suite into a
// browser-tab cannon aimed at the developer's real Chrome — reported twice
// before it was root-caused. Defaults only (??=): an explicit caller value
// still wins.
process.env.PMX_CANVAS_DISABLE_BROWSER_OPEN ??= '1';
process.env.PMX_MCP_APP_HOST_STATE_FILE ??= '/tmp/pmx-canvas-test-app-host-state.json';
