import { useCallback, useEffect, useState } from 'preact/hooks';
import { updateNodeData } from '../state/canvas-store';
import { fetchFile, updateNodeFromClient } from '../state/intent-bridge';
import type { CanvasNodeState } from '../types';

/** Guess a language label from a file extension for display. */
function langFromPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    ts: 'TypeScript', tsx: 'TSX', js: 'JavaScript', jsx: 'JSX',
    py: 'Python', rs: 'Rust', go: 'Go', rb: 'Ruby',
    java: 'Java', kt: 'Kotlin', swift: 'Swift', c: 'C', cpp: 'C++', h: 'C/C++',
    css: 'CSS', html: 'HTML', json: 'JSON', yaml: 'YAML', yml: 'YAML',
    md: 'Markdown', toml: 'TOML', sql: 'SQL', sh: 'Shell', bash: 'Shell',
    xml: 'XML', graphql: 'GraphQL', proto: 'Protobuf',
  };
  return map[ext] ?? (ext.toUpperCase() || 'Text');
}

export function FileNode({
  node,
  expanded = false,
}: { node: CanvasNodeState; expanded?: boolean }) {
  const filePath = (node.data.path as string) || (node.data.content as string) || '';
  const title = (node.data.title as string) || filePath.split('/').pop() || 'File';
  const cachedContent = node.data.fileContent as string | undefined;
  const updatedAt = node.data.updatedAt as string | undefined;
  const lineCount = node.data.lineCount as number | undefined;

  const [content, setContent] = useState<string>(cachedContent ?? '');
  const [loading, setLoading] = useState(!cachedContent && !!filePath);
  const [error, setError] = useState<string | null>(null);

  // Load file content on mount or when path changes
  useEffect(() => {
    if (!filePath) return;
    // If we already have cached content from SSE, use it
    if (cachedContent !== undefined) {
      setContent(cachedContent);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchFile(filePath).then(({ content: fileText }) => {
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
    }).catch(() => {
      if (!cancelled) {
        setError('Failed to load file');
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [filePath, cachedContent]);

  // Sync content when server pushes updates via SSE
  useEffect(() => {
    if (cachedContent !== undefined && cachedContent !== content) {
      setContent(cachedContent);
    }
  }, [cachedContent]);

  const handleReload = useCallback(() => {
    if (!filePath) return;
    setLoading(true);
    setError(null);
    // Clear cached content to force a fresh fetch
    updateNodeData(node.id, { fileContent: undefined });
    void updateNodeFromClient(node.id, { data: { fileContent: undefined } });
    fetchFile(filePath).then(({ content: fileText }) => {
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
    }).catch(() => {
      setError('Failed to reload');
      setLoading(false);
    });
  }, [filePath, node.id]);

  const lang = langFromPath(filePath);
  const lines = content.split('\n');
  const gutterWidth = `${String(lines.length).length + 1}ch`;

  if (!filePath) {
    return (
      <div style={{ color: 'var(--c-dim)', fontStyle: 'italic', padding: '12px' }}>
        No file path set
      </div>
    );
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
          <span style={{ color: 'var(--c-dim)', fontSize: '10px', flexShrink: 0 }}>
            {lineCount} lines
          </span>
        )}
        {updatedAt && (
          <span style={{ color: 'var(--c-dim)', fontSize: '10px', flexShrink: 0 }}>
            {new Date(updatedAt).toLocaleTimeString()}
          </span>
        )}
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
          overflow: 'auto',
          padding: '8px 0',
          background: expanded ? 'var(--c-panel-soft)' : undefined,
          borderRadius: expanded ? '0 0 8px 8px' : undefined,
        }}
      >
        {loading && (
          <div style={{ color: 'var(--c-dim)', padding: '12px', fontStyle: 'italic' }}>
            Loading…
          </div>
        )}
        {error && (
          <div style={{ color: 'var(--c-danger)', padding: '12px' }}>{error}</div>
        )}
        {!loading && !error && (
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
        )}
      </div>
    </div>
  );
}
