import { canonicalWorkspace, ensurePmxServer as ensureServer } from './runtime.js';
export { canonicalWorkspace, probePmxServer, runtimeCommand, runtimeVersion } from './runtime.js';

// Amp launches local skill MCP commands in the project, unlike the plugin process itself.
const workspace = canonicalWorkspace(process.cwd());

export async function ensurePmxServer(root: string) {
  if (canonicalWorkspace(root) !== workspace) throw new Error('PMX workspace differs from this Amp MCP executor.');
  return ensureServer(workspace);
}
