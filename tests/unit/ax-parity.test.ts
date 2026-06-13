import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

// Core trees that must remain host-agnostic (no @github/copilot-sdk import).
const CORE_TREES = ['src/server', 'src/mcp', 'src/cli', 'src/shared', 'src/json-render', 'src/client'];

function walkFiles(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walkFiles(full));
    } else if (/\.(ts|tsx|js|mjs|cjs)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

function readFile(relPath: string): string {
  return readFileSync(join(repoRoot, relPath), 'utf-8');
}

/** Concatenate every source file under a directory (for registry op lookups). */
function readDir(relPath: string): string {
  return walkFiles(join(repoRoot, relPath))
    .map((file) => readFileSync(file, 'utf-8'))
    .join('\n');
}

describe('AX neutral-primitive parity and host isolation', () => {
  test('no core source imports @github/copilot-sdk', () => {
    const offenders: string[] = [];
    for (const tree of CORE_TREES) {
      for (const file of walkFiles(join(repoRoot, tree))) {
        const source = readFileSync(file, 'utf-8');
        if (source.includes('@github/copilot-sdk')) {
          offenders.push(file.slice(repoRoot.length));
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test('every AX operation is wired across SDK, HTTP, MCP, CLI, and CanvasAccess', () => {
    const sdk = readFile('src/server/index.ts');
    // As AX ops migrate into the operation registry (plan-007 Slice B), the HTTP
    // route + MCP tool literals move from server.ts / mcp/server.ts into
    // src/server/operations/ops/ax-*.ts, and the per-op CanvasAccess method is
    // deleted (the invoker replaces it — that is the registry's whole point). So
    // the HTTP/MCP corpus includes the registry op files, and a `migrated` op
    // skips the now-removed CanvasAccess-method assertion (its single definition
    // site is the registry op, verified by the HTTP/MCP checks + the mcp-tool
    // freeze + operation-parity suites).
    const opsRegistry = readDir('src/server/operations/ops');
    const httpServer = readFile('src/server/server.ts') + opsRegistry;
    const mcp = readFile('src/mcp/server.ts') + opsRegistry;
    const cli = readFile('src/cli/agent.ts');
    const access = readFile('src/mcp/canvas-access.ts');

    // Each AX operation: the SDK method name, the HTTP route fragment, the MCP
    // tool name, the CLI command registration, and the CanvasAccess method.
    // `migrated: true` marks ops that now live in the operation registry — their
    // CanvasAccess method has been deleted by design.
    const ops: Array<{
      label: string;
      sdkMethod: string;
      httpRoute: string;
      mcpTool: string;
      cliCommand: string;
      accessMethod: string;
      migrated?: boolean;
    }> = [
      {
        label: 'agent-event',
        sdkMethod: 'recordAxEvent(',
        httpRoute: '/api/canvas/ax/event',
        mcpTool: "'canvas_record_ax_event'",
        cliCommand: "cmd('ax event add'",
        accessMethod: 'recordAxEvent(',
      },
      {
        label: 'steering-message',
        sdkMethod: 'sendSteering(',
        httpRoute: '/api/canvas/ax/steer',
        mcpTool: "'canvas_send_steering'",
        cliCommand: "cmd('ax steer'",
        accessMethod: 'sendSteering(',
      },
      {
        label: 'timeline-read',
        sdkMethod: 'getAxTimeline(',
        httpRoute: '/api/canvas/ax/timeline',
        mcpTool: "'canvas_get_ax_timeline'",
        cliCommand: "cmd('ax timeline'",
        accessMethod: 'getAxTimeline(',
      },
      {
        label: 'work-item-add',
        sdkMethod: 'addWorkItem(',
        httpRoute: '/api/canvas/ax/work',
        mcpTool: "'canvas_add_work_item'",
        cliCommand: "cmd('ax work add'",
        accessMethod: 'addWorkItem(',
        migrated: true,
      },
      {
        label: 'work-item-update',
        sdkMethod: 'updateWorkItem(',
        httpRoute: '/api/canvas/ax/work/',
        mcpTool: "'canvas_update_work_item'",
        cliCommand: "cmd('ax work update'",
        accessMethod: 'updateWorkItem(',
        migrated: true,
      },
      {
        label: 'approval-request',
        sdkMethod: 'requestApproval(',
        httpRoute: '/api/canvas/ax/approval',
        mcpTool: "'canvas_request_approval'",
        cliCommand: "cmd('ax approval request'",
        accessMethod: 'requestApproval(',
        migrated: true,
      },
      {
        label: 'approval-resolve',
        sdkMethod: 'resolveApproval(',
        httpRoute: '/api/canvas/ax/approval/',
        mcpTool: "'canvas_resolve_approval'",
        cliCommand: "cmd('ax approval resolve'",
        accessMethod: 'resolveApproval(',
        migrated: true,
      },
      {
        label: 'evidence-item',
        sdkMethod: 'addEvidence(',
        httpRoute: '/api/canvas/ax/evidence',
        mcpTool: "'canvas_add_evidence'",
        cliCommand: "cmd('ax evidence add'",
        accessMethod: 'addEvidence(',
      },
      {
        label: 'review-annotation',
        sdkMethod: 'addReviewAnnotation(',
        httpRoute: '/api/canvas/ax/review',
        mcpTool: "'canvas_add_review_annotation'",
        cliCommand: "cmd('ax review add'",
        accessMethod: 'addReviewAnnotation(',
        migrated: true,
      },
      {
        label: 'host-capability',
        sdkMethod: 'reportHostCapability(',
        httpRoute: '/api/canvas/ax/host-capability',
        mcpTool: "'canvas_report_host_capability'",
        cliCommand: "cmd('ax host report'",
        accessMethod: 'reportHostCapability(',
        migrated: true,
      },
      {
        label: 'node-interaction',
        sdkMethod: 'submitAxInteraction(',
        httpRoute: '/api/canvas/ax/interaction',
        mcpTool: "'canvas_ax_interaction'",
        cliCommand: "cmd('ax interaction'",
        accessMethod: 'submitAxInteraction(',
      },
      {
        label: 'steering-delivery',
        sdkMethod: 'getPendingSteering(',
        httpRoute: '/api/canvas/ax/delivery/',
        mcpTool: "'canvas_claim_ax_delivery'",
        cliCommand: "cmd('ax delivery list'",
        accessMethod: 'getPendingSteering(',
      },
      {
        label: 'elicitation',
        sdkMethod: 'requestElicitation(',
        httpRoute: '/api/canvas/ax/elicitation',
        mcpTool: "'canvas_request_elicitation'",
        cliCommand: "cmd('ax elicitation request'",
        accessMethod: 'requestElicitation(',
        migrated: true,
      },
      {
        label: 'mode-request',
        sdkMethod: 'requestMode(',
        httpRoute: '/api/canvas/ax/mode',
        mcpTool: "'canvas_request_mode'",
        cliCommand: "cmd('ax mode request'",
        accessMethod: 'requestMode(',
        migrated: true,
      },
      {
        label: 'command',
        sdkMethod: 'invokeCommand(',
        httpRoute: '/api/canvas/ax/command',
        mcpTool: "'canvas_invoke_command'",
        cliCommand: "cmd('ax command invoke'",
        accessMethod: 'invokeCommand(',
      },
      {
        label: 'policy',
        sdkMethod: 'setPolicy(',
        httpRoute: '/api/canvas/ax/policy',
        mcpTool: "'canvas_set_ax_policy'",
        cliCommand: "cmd('ax policy set'",
        accessMethod: 'setPolicy(',
        migrated: true,
      },
    ];

    const missing: string[] = [];
    for (const op of ops) {
      if (!sdk.includes(op.sdkMethod)) missing.push(`${op.label}: SDK ${op.sdkMethod}`);
      if (!httpServer.includes(op.httpRoute)) missing.push(`${op.label}: HTTP ${op.httpRoute}`);
      if (!mcp.includes(op.mcpTool)) missing.push(`${op.label}: MCP ${op.mcpTool}`);
      if (!cli.includes(op.cliCommand)) missing.push(`${op.label}: CLI ${op.cliCommand}`);
      // Migrated ops have one definition site (the registry op) — their legacy
      // per-surface CanvasAccess method is deleted by design.
      if (!op.migrated && !access.includes(op.accessMethod)) {
        missing.push(`${op.label}: CanvasAccess ${op.accessMethod}`);
      }
    }
    expect(missing).toEqual([]);
  });

  test('the new AX resources are registered on the MCP server', () => {
    const mcp = readFile('src/mcp/server.ts');
    expect(mcp).toContain("'canvas://ax-timeline'");
    expect(mcp).toContain("'canvas://ax-work'");
  });

  test('package.json files include the bundled Copilot adapter', () => {
    const pkg = JSON.parse(readFile('package.json')) as { files: string[] };
    expect(pkg.files).toContain('.github/extensions/pmx-canvas/');
  });

  test('the Copilot adapter only imports node:* and the Copilot extension SDK', () => {
    const source = readFile('.github/extensions/pmx-canvas/extension.mjs');
    const importLines = source
      .split('\n')
      .filter((line) => /^\s*import\s/.test(line));
    expect(importLines.length).toBeGreaterThan(0);
    for (const line of importLines) {
      const match = line.match(/from\s+["']([^"']+)["']/);
      expect(match).not.toBeNull();
      const specifier = match![1];
      const allowed = specifier.startsWith('node:') || specifier.startsWith('@github/copilot-sdk');
      expect(allowed).toBe(true);
    }
  });
});
