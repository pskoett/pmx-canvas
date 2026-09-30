export interface DelimitedTable {
  header: string[];
  /** Rectangular: every row padded (short) or truncated (long) to the header width. */
  rows: string[][];
}

/** Column delimiter for a delimited-data path, or null when the file is not one. */
export function delimiterForPath(path: string): string | null {
  const lower = path.toLowerCase();
  if (lower.endsWith('.csv')) return ',';
  if (lower.endsWith('.tsv')) return '\t';
  return null;
}

/**
 * RFC4180-ish delimited-text parser. Quoted fields may contain the delimiter,
 * newlines, and `""` escapes; CRLF, LF and lone CR all end a record; a trailing
 * newline produces no phantom empty row. Ragged records are squared off against
 * the header width instead of throwing.
 */
export function parseDelimitedText(text: string, delimiter: string): DelimitedTable {
  const records: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  // Tracks whether the current record consumed anything — distinguishes a real
  // empty-quoted record from the dangling state after a terminating newline.
  let started = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    started = true;
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else if (char === '\r' && text[i + 1] === '\n') {
        field += '\n';
        i++;
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"' && field === '') {
      quoted = true;
    } else if (char === delimiter) {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      records.push(row);
      row = [];
      started = false;
    } else {
      field += char;
    }
  }
  if (started) {
    row.push(field);
    records.push(row);
  }

  const header = records.shift() ?? [];
  return {
    header,
    rows: records.map((record) => Array.from({ length: header.length }, (_, i) => record[i] ?? '')),
  };
}
