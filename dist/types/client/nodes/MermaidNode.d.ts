import type { CanvasNodeState } from '../types';
/**
 * Mermaid diagram node — a display-only iframe surface. The server renders the
 * surface document (escaped diagram source + /canvas/mermaid-entry.js) at
 * /api/canvas/surface/:id; the iframe and "Open as site" share that one render
 * path, exactly like html nodes. Minimal subset of HtmlNode: theme push and
 * content-height growth, no AX bridge, no presentation mode.
 */
export declare function MermaidNode({ node, expanded }: {
    node: CanvasNodeState;
    expanded?: boolean;
}): import("preact/jsx-runtime").JSX.Element;
