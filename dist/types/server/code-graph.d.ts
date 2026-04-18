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
    centralFiles: {
        path: string;
        title: string | null;
        inDegree: number;
    }[];
    /** Files with no dependencies in or out (isolated) */
    isolatedFiles: {
        path: string;
        title: string | null;
    }[];
}
/**
 * Extract import specifiers from file content based on file extension.
 */
export declare function parseImports(content: string, filePath: string): string[];
/**
 * Recompute all auto-edges for the code graph.
 * Called when file nodes are added/removed or file content changes.
 *
 * Returns the list of edges that were created/maintained.
 */
export declare function recomputeCodeGraph(): CodeGraphEdge[];
/**
 * Build a summary of the code graph for the MCP resource.
 */
export declare function buildCodeGraphSummary(): CodeGraphSummary;
/**
 * Format code graph summary as human-readable text for MCP.
 */
export declare function formatCodeGraph(summary: CodeGraphSummary): string;
