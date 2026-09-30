export interface DelimitedTable {
    header: string[];
    /** Rectangular: every row padded (short) or truncated (long) to the header width. */
    rows: string[][];
}
/** Column delimiter for a delimited-data path, or null when the file is not one. */
export declare function delimiterForPath(path: string): string | null;
/**
 * RFC4180-ish delimited-text parser. Quoted fields may contain the delimiter,
 * newlines, and `""` escapes; CRLF, LF and lone CR all end a record; a trailing
 * newline produces no phantom empty row. Ragged records are squared off against
 * the header width instead of throwing.
 */
export declare function parseDelimitedText(text: string, delimiter: string): DelimitedTable;
