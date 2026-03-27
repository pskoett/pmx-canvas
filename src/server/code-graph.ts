/**
 * Code Graph — Auto-dependency detection between file nodes.
 *
 * Parses imports from file node content and auto-creates `depends-on` edges
 * between file nodes that reference each other. Updates live when files change.
 *
 * Supported import patterns:
 * - JS/TS: import ... from '...', import('...'), require('...')
 * - Python: import ..., from ... import ...
 * - Go: import "...", import ( "..." )
 * - Rust: mod ..., use crate::...
 *
 * Auto-edges are tagged with `_autoCodeGraph: true` in their metadata so they
 * can be distinguished from manually created edges and cleaned up properly.
 */

import { resolve, dirname, basename, extname, relative } from 'node:path';
import { existsSync } from 'node:fs';
import { canvasState } from './canvas-state.js';
import type { CanvasNodeState, CanvasEdge } from './canvas-state.js';

// ── Types ────────────────────────────────────────────────────────────

export interface CodeGraphEdge {
  fromNodeId: string;
  toNodeId: string;
  fromPath: string;
  toPath: string;
  importSpecifier: string;
}

export interface CodeGraphSummary {
  totalFileNodes: number;
  totalAutoEdges: number;
  nodes: {
    id: string;
    path: string;
    title: string | null;
    imports: string[];
    importedBy: string[];
    /** Number of files this node depends on */
    outDegree: number;
    /** Number of files that depend on this node */
    inDegree: number;
  }[];
  /** Most-depended-on files (highest inDegree) */
  centralFiles: { path: string; title: string | null; inDegree: number }[];
  /** Files with no dependencies in or out (isolated) */
  isolatedFiles: { path: string; title: string | null }[];
}

// ── Import Parser ────────────────────────────────────────────────────

// JS/TS patterns
const JS_IMPORT_FROM = /(?:import|export)\s+(?:[\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g;
const JS_IMPORT_BARE = /import\s+['"]([^'"]+)['"]/g;
const JS_DYNAMIC_IMPORT = /import\(\s*['"]([^'"]+)['"]\s*\)/g;
const JS_REQUIRE = /require\(\s*['"]([^'"]+)['"]\s*\)/g;

// Python patterns
const PY_IMPORT = /^import\s+([\w.]+)/gm;
const PY_FROM_IMPORT = /^from\s+([\w.]+)\s+import/gm;

// Go patterns
const GO_IMPORT_SINGLE = /import\s+"([^"]+)"/g;
const GO_IMPORT_BLOCK = /import\s*\(\s*([\s\S]*?)\)/g;
const GO_IMPORT_LINE = /"([^"]+)"/g;

// Rust patterns
const RUST_MOD = /^mod\s+(\w+)\s*;/gm;
const RUST_USE_CRATE = /^use\s+crate::(\S+)/gm;

/**
 * Extract import specifiers from file content based on file extension.
 */
export function parseImports(content: string, filePath: string): string[] {
  const ext = extname(filePath).toLowerCase();
  const specifiers: string[] = [];

  if (['.ts', '.tsx', '.js', '.jsx', '.mjs', '.mts', '.cjs', '.cts'].includes(ext)) {
    for (const match of content.matchAll(JS_IMPORT_FROM)) specifiers.push(match[1]);
    for (const match of content.matchAll(JS_IMPORT_BARE)) specifiers.push(match[1]);
    for (const match of content.matchAll(JS_DYNAMIC_IMPORT)) specifiers.push(match[1]);
    for (const match of content.matchAll(JS_REQUIRE)) specifiers.push(match[1]);
  } else if (['.py', '.pyw'].includes(ext)) {
    for (const match of content.matchAll(PY_IMPORT)) specifiers.push(match[1]);
    for (const match of content.matchAll(PY_FROM_IMPORT)) specifiers.push(match[1]);
  } else if (ext === '.go') {
    for (const match of content.matchAll(GO_IMPORT_SINGLE)) specifiers.push(match[1]);
    for (const match of content.matchAll(GO_IMPORT_BLOCK)) {
      const block = match[1];
      for (const line of block.matchAll(GO_IMPORT_LINE)) specifiers.push(line[1]);
    }
  } else if (ext === '.rs') {
    for (const match of content.matchAll(RUST_MOD)) specifiers.push(match[1]);
    for (const match of content.matchAll(RUST_USE_CRATE)) specifiers.push(match[1]);
  }

  // Deduplicate
  return [...new Set(specifiers)];
}

// ── Path Resolution ──────────────────────────────────────────────────

/**
 * Resolve an import specifier to a file path, checking common extensions.
 * Returns null if the import can't be resolved to a file on disk.
 */
function resolveImportPath(specifier: string, fromFilePath: string): string | null {
  // Skip bare module specifiers (npm packages, node builtins)
  if (!specifier.startsWith('.') && !specifier.startsWith('/')) {
    // Could be a project-relative path or a package — skip packages
    // Check if it looks like a relative project path (contains / and no @)
    if (!specifier.includes('/') || specifier.startsWith('@')) return null;
    // For non-relative paths, try workspace-relative resolution
    const wsRoot = process.cwd();
    return tryResolveWithExtensions(resolve(wsRoot, specifier));
  }

  const dir = dirname(fromFilePath);
  const candidate = resolve(dir, specifier);
  return tryResolveWithExtensions(candidate);
}

const RESOLVE_EXTENSIONS = [
  '', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.mts',
  '/index.ts', '/index.tsx', '/index.js', '/index.jsx',
  '.py', '.go', '.rs',
];

function tryResolveWithExtensions(basePath: string): string | null {
  // Try exact path + extensions
  for (const ext of RESOLVE_EXTENSIONS) {
    const full = basePath + ext;
    if (existsSync(full)) return full;
  }

  // Handle TS/JS extension mapping: import './foo.js' → actual file is './foo.ts'
  const ext = extname(basePath);
  if (['.js', '.jsx', '.mjs', '.cjs'].includes(ext)) {
    const withoutExt = basePath.slice(0, -ext.length);
    const tsExtMap: Record<string, string[]> = {
      '.js': ['.ts', '.tsx'],
      '.jsx': ['.tsx'],
      '.mjs': ['.mts'],
      '.cjs': ['.cts'],
    };
    for (const tsExt of tsExtMap[ext] ?? []) {
      const candidate = withoutExt + tsExt;
      if (existsSync(candidate)) return candidate;
    }
    // Also try index files: import './foo.js' → './foo/index.ts'
    for (const idxExt of ['/index.ts', '/index.tsx', '/index.js']) {
      const candidate = withoutExt + idxExt;
      if (existsSync(candidate)) return candidate;
    }
  }

  return null;
}

// ── Auto-Edge Manager ────────────────────────────────────────────────

/** Prefix for auto-generated code graph edge IDs */
const AUTO_EDGE_PREFIX = 'codegraph-';

/** Cache of last recomputed edges for buildCodeGraphSummary() to reuse. */
let _lastDiscoveredEdges: CodeGraphEdge[] = [];

/**
 * Get all file nodes currently on the canvas.
 */
function getFileNodes(): CanvasNodeState[] {
  return canvasState.getLayout().nodes.filter((n) => n.type === 'file' && typeof n.data.path === 'string');
}

/**
 * Build a map of absolute file path → node ID for the given file nodes.
 */
function buildPathIndex(fileNodes?: CanvasNodeState[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const node of (fileNodes ?? getFileNodes())) {
    index.set(node.data.path as string, node.id);
  }
  return index;
}

/**
 * Recompute all auto-edges for the code graph.
 * Called when file nodes are added/removed or file content changes.
 *
 * Returns the list of edges that were created/maintained.
 */
export function recomputeCodeGraph(): CodeGraphEdge[] {
  const fileNodes = getFileNodes();
  const pathIndex = buildPathIndex(fileNodes);
  const discoveredEdges: CodeGraphEdge[] = [];

  // Parse imports for each file node and resolve to other file nodes
  for (const node of fileNodes) {
    const filePath = node.data.path as string;
    const content = (node.data.fileContent as string) ?? '';
    if (!content) continue;

    const specifiers = parseImports(content, filePath);

    for (const spec of specifiers) {
      const resolvedPath = resolveImportPath(spec, filePath);
      if (!resolvedPath) continue;

      const targetNodeId = pathIndex.get(resolvedPath);
      if (!targetNodeId || targetNodeId === node.id) continue;

      discoveredEdges.push({
        fromNodeId: node.id,
        toNodeId: targetNodeId,
        fromPath: filePath,
        toPath: resolvedPath,
        importSpecifier: spec,
      });
    }
  }

  // Remove old auto-edges that no longer exist
  const existingAutoEdges = canvasState.getEdges().filter((e) => e.id.startsWith(AUTO_EDGE_PREFIX));
  const discoveredKeys = new Set(discoveredEdges.map((e) => `${e.fromNodeId}->${e.toNodeId}`));

  // Suppress mutation recording for auto-edge management (these are computed, not user actions)
  canvasState.withSuppressedRecording(() => {
    for (const edge of existingAutoEdges) {
      const key = `${edge.from}->${edge.to}`;
      if (!discoveredKeys.has(key)) {
        canvasState.removeEdge(edge.id);
      }
    }

    // Add new auto-edges that don't exist yet
    const existingKeys = new Set(existingAutoEdges.map((e) => `${e.from}->${e.to}`));
    for (const edge of discoveredEdges) {
      const key = `${edge.fromNodeId}->${edge.toNodeId}`;
      if (existingKeys.has(key)) continue;

      const edgeId = `${AUTO_EDGE_PREFIX}${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      canvasState.addEdge({
        id: edgeId,
        from: edge.fromNodeId,
        to: edge.toNodeId,
        type: 'depends-on',
        label: 'imports',
        style: 'dashed',
      });
    }
  });

  _lastDiscoveredEdges = discoveredEdges;
  return discoveredEdges;
}

/**
 * Build a summary of the code graph for the MCP resource.
 */
export function buildCodeGraphSummary(): CodeGraphSummary {
  const fileNodes = getFileNodes();
  const autoEdges = canvasState.getEdges().filter((e) => e.id.startsWith(AUTO_EDGE_PREFIX));

  // Build adjacency data
  const outgoing = new Map<string, Set<string>>(); // nodeId → set of target nodeIds
  const incoming = new Map<string, Set<string>>(); // nodeId → set of source nodeIds
  const importSpecs = new Map<string, string[]>(); // nodeId → import specifiers

  for (const node of fileNodes) {
    outgoing.set(node.id, new Set());
    incoming.set(node.id, new Set());
    importSpecs.set(node.id, []);
  }

  for (const edge of autoEdges) {
    outgoing.get(edge.from)?.add(edge.to);
    incoming.get(edge.to)?.add(edge.from);
  }

  // Use cached discovered edges from last recomputeCodeGraph() to avoid re-parsing
  const idToPath = new Map<string, string>();
  for (const node of fileNodes) idToPath.set(node.id, node.data.path as string);

  // Group import specifiers by source node from cached edges
  for (const edge of _lastDiscoveredEdges) {
    const specs = importSpecs.get(edge.fromNodeId);
    if (specs && !specs.includes(edge.importSpecifier)) {
      specs.push(edge.importSpecifier);
    }
  }

  const nodes = fileNodes.map((node) => {
    const out = outgoing.get(node.id) ?? new Set();
    const inc = incoming.get(node.id) ?? new Set();
    return {
      id: node.id,
      path: relative(process.cwd(), node.data.path as string) || (node.data.path as string),
      title: (node.data.title as string) ?? null,
      imports: importSpecs.get(node.id) ?? [],
      importedBy: [...(inc)].map((id) => {
        const path = idToPath.get(id);
        return path ? relative(process.cwd(), path) : id;
      }),
      outDegree: out.size,
      inDegree: inc.size,
    };
  });

  // Sort by inDegree descending for central files
  const centralFiles = nodes
    .filter((n) => n.inDegree > 0)
    .sort((a, b) => b.inDegree - a.inDegree)
    .slice(0, 10)
    .map((n) => ({ path: n.path, title: n.title, inDegree: n.inDegree }));

  const isolatedFiles = nodes
    .filter((n) => n.inDegree === 0 && n.outDegree === 0)
    .map((n) => ({ path: n.path, title: n.title }));

  return {
    totalFileNodes: fileNodes.length,
    totalAutoEdges: autoEdges.length,
    nodes,
    centralFiles,
    isolatedFiles,
  };
}

/**
 * Format code graph summary as human-readable text for MCP.
 */
export function formatCodeGraph(summary: CodeGraphSummary): string {
  if (summary.totalFileNodes === 0) {
    return 'Code Graph: no file nodes on canvas. Add file nodes to see auto-detected dependencies.';
  }

  const lines: string[] = [
    `Code Graph: ${summary.totalFileNodes} files, ${summary.totalAutoEdges} dependency edges`,
    '',
  ];

  if (summary.centralFiles.length > 0) {
    lines.push('Central files (most depended on):');
    for (const f of summary.centralFiles) {
      lines.push(`  ${f.title ?? f.path} — imported by ${f.inDegree} file(s)`);
    }
    lines.push('');
  }

  if (summary.isolatedFiles.length > 0) {
    lines.push(`Isolated files (${summary.isolatedFiles.length}): ${summary.isolatedFiles.map((f) => f.title ?? f.path).join(', ')}`);
    lines.push('');
  }

  lines.push('Dependencies:');
  for (const node of summary.nodes) {
    if (node.outDegree === 0 && node.inDegree === 0) continue;
    lines.push(`  ${node.title ?? node.path}`);
    if (node.imports.length > 0) {
      lines.push(`    imports: ${node.imports.join(', ')}`);
    }
    if (node.importedBy.length > 0) {
      lines.push(`    imported by: ${node.importedBy.join(', ')}`);
    }
  }

  return lines.join('\n');
}
