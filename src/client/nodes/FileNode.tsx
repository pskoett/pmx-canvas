import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';
import { updateNodeData } from '../state/canvas-store';
import { iframeMode } from '../state/iframe-mode';
import { fetchFile, updateNodeFromClient } from '../state/intent-bridge';
import type { CanvasNodeState } from '../types';
import { runNodeAxInteraction } from './ax-node-actions';

/** Guess a language label from a file extension for display. */
function langFromPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    ts: 'TypeScript',
    tsx: 'TSX',
    js: 'JavaScript',
    jsx: 'JSX',
    py: 'Python',
    rs: 'Rust',
    go: 'Go',
    rb: 'Ruby',
    java: 'Java',
    kt: 'Kotlin',
    swift: 'Swift',
    c: 'C',
    cpp: 'C++',
    h: 'C/C++',
    css: 'CSS',
    html: 'HTML',
    json: 'JSON',
    yaml: 'YAML',
    yml: 'YAML',
    md: 'Markdown',
    toml: 'TOML',
    sql: 'SQL',
    sh: 'Shell',
    bash: 'Shell',
    xml: 'XML',
    graphql: 'GraphQL',
    proto: 'Protobuf',
  };
  return map[ext] ?? (ext.toUpperCase() || 'Text');
}

/** Rendered-row ceiling for delimited files — a 200k-row CSV must not lock the browser. */
const MAX_TABLE_ROWS = 500;

export interface DelimitedTable {
  header: string[];
  /** Rectangular: every row padded (short) or truncated (long) to the header width. */
  rows: string[][];
}

/** Column delimiter for a delimited-data path, or null when the file is not one. */
function delimiterForPath(path: string): string | null {
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

/** Human-readable byte size, e.g. `4.2 MB`. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

export function FileNode({ node, expanded = false }: { node: CanvasNodeState; expanded?: boolean }) {
  const filePath = (node.data.path as string) || (node.data.content as string) || '';
  const title = (node.data.title as string) || filePath.split('/').pop() || 'File';
  const cachedContent = node.data.fileContent as string | undefined;
  const updatedAt = node.data.updatedAt as string | undefined;
  const lineCount = node.data.lineCount as number | undefined;
  const byteSize = node.data.byteSize as number | undefined;
  const isBinary = node.data.binary === true;
  const truncated = node.data.truncated === true;
  const mimeType = node.data.mimeType as string | undefined;
  const isPdf = mimeType === 'application/pdf' || filePath.toLowerCase().endsWith('.pdf');
  // Binary bytes and PDFs are served raw — never fetched or decoded as text.
  const servesBytes = isBinary || isPdf;

  const [content, setContent] = useState<string>(cachedContent ?? '');
  const [loading, setLoading] = useState(!cachedContent && !!filePath && !servesBytes);
  const [error, setError] = useState<string | null>(null);
  const [bytesVersion, setBytesVersion] = useState(0);

  // Load file content on mount or when path changes
  useEffect(() => {
    if (!filePath) return;
    if (servesBytes) {
      setLoading(false);
      return;
    }
    // If we already have cached content from SSE, use it
    if (cachedContent !== undefined) {
      setContent(cachedContent);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchFile(filePath)
      .then(({ content: fileText }) => {
        if (cancelled) return;
        if (!fileText && fileText !== '') {
          setError('File not found');
          setLoading(false);
          return;
        }
        setContent(fileText);
        setLoading(false);
        // Cache content in node data so it survives re-renders
        const lines = fileText.split('\n').length;
        updateNodeData(node.id, { fileContent: fileText, lineCount: lines });
        void updateNodeFromClient(node.id, { data: { fileContent: fileText, lineCount: lines } });
      })
      .catch(() => {
        if (!cancelled) {
          setError('Failed to load file');
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [filePath, cachedContent, servesBytes]);

  // Sync content when server pushes updates via SSE
  useEffect(() => {
    if (cachedContent !== undefined && cachedContent !== content) {
      setContent(cachedContent);
    }
  }, [cachedContent]);

  const handleReload = useCallback(() => {
    if (!filePath) return;
    if (servesBytes) {
      // Byte-served files have no cached text — bust the frame URL instead.
      setBytesVersion((v) => v + 1);
      return;
    }
    setLoading(true);
    setError(null);
    // Clear cached content to force a fresh fetch
    updateNodeData(node.id, { fileContent: undefined });
    void updateNodeFromClient(node.id, { data: { fileContent: undefined } });
    fetchFile(filePath)
      .then(({ content: fileText }) => {
        setContent(fileText);
        setLoading(false);
        const lines = fileText.split('\n').length;
        const updatedAt = new Date().toISOString();
        updateNodeData(node.id, {
          fileContent: fileText,
          lineCount: lines,
          updatedAt,
        });
        void updateNodeFromClient(node.id, {
          data: {
            fileContent: fileText,
            lineCount: lines,
            updatedAt,
          },
        });
      })
      .catch(() => {
        setError('Failed to reload');
        setLoading(false);
      });
  }, [filePath, node.id, servesBytes]);

  const lang = langFromPath(filePath);
  const lines = content.split('\n');
  const gutterWidth = `${String(lines.length).length + 1}ch`;
  const delimiter = delimiterForPath(filePath);
  // A .csv that is not actually delimited (single column) stays plain text.
  const table = useMemo(() => {
    if (!delimiter || servesBytes || !content) return null;
    const parsed = parseDelimitedText(content, delimiter);
    return parsed.header.length >= 2 ? parsed : null;
  }, [content, delimiter, servesBytes]);
  const bytesUrl = `/api/canvas/file-bytes?nodeId=${encodeURIComponent(node.id)}${
    bytesVersion ? `&v=${bytesVersion}` : ''
  }`;
  // Amp orb portals block src-URL child iframes and force srcdoc, which cannot
  // inline a PDF — offer the raw URL instead of a dead frame.
  const pdfFrameBlocked = iframeMode.value === 'srcdoc';
  const fillsBody = servesBytes || table !== null;

  const truncatedNotice = truncated ? (
    <div class="file-node-notice">
      Showing the first {formatBytes(content.length)} of {formatBytes(byteSize ?? content.length)}
    </div>
  ) : null;

  if (!filePath) {
    return <div style={{ color: 'var(--c-dim)', fontStyle: 'italic', padding: '12px' }}>No file path set</div>;
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        fontFamily: 'var(--mono)',
        fontSize: expanded ? '13px' : '11px',
      }}
    >
      {/* Header bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '6px 10px',
          borderBottom: '1px solid var(--c-line)',
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: '9px',
            padding: '1px 5px',
            background: 'var(--c-accent-12)',
            color: 'var(--c-accent)',
            borderRadius: '3px',
            fontWeight: 600,
          }}
        >
          {lang}
        </span>
        <span
          style={{
            color: 'var(--c-text-soft)',
            fontSize: expanded ? '12px' : '10px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
          }}
          title={filePath}
        >
          {filePath}
        </span>
        {lineCount !== undefined && (
          <span style={{ color: 'var(--c-dim)', fontSize: '10px', flexShrink: 0 }}>{lineCount} lines</span>
        )}
        {updatedAt && (
          <span style={{ color: 'var(--c-dim)', fontSize: '10px', flexShrink: 0 }}>
            {new Date(updatedAt).toLocaleTimeString()}
          </span>
        )}
        <button
          type="button"
          class="ax-node-action"
          title="Mark this file as AX evidence"
          onClick={(e) => {
            e.stopPropagation();
            void runNodeAxInteraction(
              node,
              'ax.evidence.add',
              { kind: 'file', title: filePath.split('/').pop() || filePath, ref: filePath },
              'Marked as evidence',
            );
          }}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--c-muted)',
            cursor: 'pointer',
            padding: '2px 4px',
            fontSize: '12px',
            flexShrink: 0,
          }}
        >
          ⊕
        </button>
        <button
          type="button"
          onClick={handleReload}
          title="Reload file"
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--c-muted)',
            cursor: 'pointer',
            padding: '2px 4px',
            fontSize: '12px',
            flexShrink: 0,
          }}
        >
          ↻
        </button>
      </div>

      {/* Content area */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: fillsBody ? 'hidden' : 'auto',
          padding: fillsBody ? 0 : '8px 0',
          background: expanded ? 'var(--c-panel-soft)' : undefined,
          borderRadius: expanded ? '0 0 8px 8px' : undefined,
        }}
      >
        {isPdf &&
          (pdfFrameBlocked ? (
            <div class="file-node-placeholder">
              <div>PDF preview is unavailable in this embedded host.</div>
              <a class="file-node-link" href={bytesUrl} target="_blank" rel="noreferrer">
                Open PDF
              </a>
            </div>
          ) : (
            <iframe
              src={bytesUrl}
              title={title}
              // SECURITY: same-origin URL, so it must be sandboxed like every
              // other iframe in the client. Without allow-same-origin the frame
              // gets an opaque origin and cannot reach the canvas API even if
              // the bytes turn out to be markup. The built-in PDF viewer needs
              // no script permissions from us.
              sandbox=""
              style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
            />
          ))}
        {!isPdf && isBinary && (
          <div class="file-node-placeholder">
            <div class="file-node-placeholder-name">{title}</div>
            <div>Binary file</div>
            {byteSize !== undefined && <div>{formatBytes(byteSize)}</div>}
          </div>
        )}
        {!servesBytes && (
          <>
            {loading && <div style={{ color: 'var(--c-dim)', padding: '12px', fontStyle: 'italic' }}>Loading…</div>}
            {error && <div style={{ color: 'var(--c-danger)', padding: '12px' }}>{error}</div>}
            {!loading &&
              !error &&
              (table ? (
                <div class="file-table-shell">
                  {truncatedNotice}
                  {table.rows.length > MAX_TABLE_ROWS && (
                    <div class="file-node-notice">
                      Showing {MAX_TABLE_ROWS} of {table.rows.length} rows
                    </div>
                  )}
                  <div class="file-table-wrap">
                    <table class="file-table">
                      <thead>
                        <tr>
                          {table.header.map((cell, i) => (
                            <th key={i}>{cell}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {table.rows.slice(0, MAX_TABLE_ROWS).map((row, rowIndex) => (
                          <tr key={rowIndex}>
                            {row.map((cell, cellIndex) => (
                              <td key={cellIndex}>{cell}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <>
                  {truncatedNotice}
                  <pre
                    style={{
                      margin: 0,
                      lineHeight: '1.55',
                      tabSize: 2,
                    }}
                  >
                    {lines.map((line, i) => (
                      <div
                        key={i}
                        style={{
                          display: 'flex',
                          minHeight: '1.55em',
                        }}
                      >
                        <span
                          style={{
                            width: gutterWidth,
                            minWidth: gutterWidth,
                            textAlign: 'right',
                            color: 'var(--c-dim)',
                            paddingRight: '12px',
                            paddingLeft: '10px',
                            userSelect: 'none',
                            flexShrink: 0,
                            opacity: 0.6,
                          }}
                        >
                          {i + 1}
                        </span>
                        <code
                          style={{
                            color: 'var(--c-text)',
                            whiteSpace: 'pre',
                            paddingRight: '10px',
                          }}
                        >
                          {line || '\n'}
                        </code>
                      </div>
                    ))}
                  </pre>
                </>
              ))}
          </>
        )}
      </div>
    </div>
  );
}
