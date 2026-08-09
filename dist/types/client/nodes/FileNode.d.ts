import type { CanvasNodeState } from '../types';
export interface DelimitedTable {
    header: string[];
    /** Rectangular: every row padded (short) or truncated (long) to the header width. */
    rows: string[][];
}
/**
 * RFC4180-ish delimited-text parser. Quoted fields may contain the delimiter,
 * newlines, and `""` escapes; CRLF, LF and lone CR all end a record; a trailing
 * newline produces no phantom empty row. Ragged records are squared off against
 * the header width instead of throwing.
 */
export declare function parseDelimitedText(text: string, delimiter: string): DelimitedTable;
/** Human-readable byte size, e.g. `4.2 MB`. */
export declare function formatBytes(bytes: number): string;
export declare function FileNode({ node, expanded }: {
    node: CanvasNodeState;
    expanded?: boolean;
}): import("preact/src").JSX.Element;
