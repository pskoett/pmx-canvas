import { useMemo } from 'preact/hooks';
import type { CanvasNodeState } from '../types';

export interface ParsedDiffLine {
  kind: 'add' | 'remove' | 'context' | 'hunk';
  text: string;
}

export interface ParsedDiffSection {
  /** Display path derived from the +++/--- headers or the `diff --git` line; null for headerless diffs. */
  path: string | null;
  lines: ParsedDiffLine[];
}

function stripDiffPathPrefix(path: string): string {
  return path.replace(/^[ab]\//, '');
}

/** Derive a display path from a `--- old` / `+++ new` header pair. */
function headerPairPath(oldPath: string, newPath: string): string | null {
  if (newPath && newPath !== '/dev/null') return stripDiffPathPrefix(newPath);
  if (oldPath && oldPath !== '/dev/null') return stripDiffPathPrefix(oldPath);
  return null;
}

/**
 * Split unified diff text into file sections, hunk headers, and classified
 * lines. Recognizes `diff --git` boundaries and `---`/`+++` header pairs
 * (never misclassifying them as remove/add); diffs without any file headers
 * parse as a single anonymous section.
 */
export function parseUnifiedDiff(text: string): ParsedDiffSection[] {
  if (!text.trim()) return [];
  const rawLines = text.split('\n');
  // Drop the trailing empty string produced by a terminating newline.
  if (rawLines.length > 0 && rawLines[rawLines.length - 1] === '') rawLines.pop();

  const sections: ParsedDiffSection[] = [];
  let current: ParsedDiffSection | null = null;
  let currentHasHunk = false;

  const startSection = (path: string | null): ParsedDiffSection => {
    const section: ParsedDiffSection = { path, lines: [] };
    currentHasHunk = false;
    sections.push(section);
    return section;
  };

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i] ?? '';

    const gitHeader = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (gitHeader) {
      current = startSection(gitHeader[2] ?? null);
      continue;
    }

    const next = rawLines[i + 1] ?? '';
    if (line.startsWith('--- ') && next.startsWith('+++ ')) {
      const path = headerPairPath(line.slice(4).trim(), next.slice(4).trim());
      if (current && !currentHasHunk) {
        // Header pair inside a `diff --git` preamble refines that section.
        if (!current.path) current.path = path;
      } else {
        current = startSection(path);
      }
      i++; // Consume the `+++` line too — neither header is an add/remove line.
      continue;
    }

    if (!current) current = startSection(null);
    const section = current;

    if (line.startsWith('@@')) {
      currentHasHunk = true;
      section.lines.push({ kind: 'hunk', text: line });
    } else if (line.startsWith('+')) {
      section.lines.push({ kind: 'add', text: line });
    } else if (line.startsWith('-')) {
      section.lines.push({ kind: 'remove', text: line });
    } else {
      // Includes `\ No newline at end of file` and git meta lines (index, mode).
      section.lines.push({ kind: 'context', text: line });
    }
  }

  return sections;
}

export function DiffNode({ node }: { node: CanvasNodeState }) {
  const content = typeof node.data.content === 'string' ? node.data.content : '';
  const sections = useMemo(() => parseUnifiedDiff(content), [content]);

  if (sections.length === 0) {
    return <div class="diff-node diff-node-empty">Empty diff</div>;
  }

  return (
    <div class="diff-node">
      {sections.map((section, sectionIndex) => (
        <div class="diff-file" key={`${section.path ?? 'anonymous'}-${sectionIndex}`}>
          {section.path && <div class="diff-file-header">{section.path}</div>}
          <pre class="diff-lines">
            {section.lines.map((line, lineIndex) => (
              <div key={lineIndex} class={line.kind === 'hunk' ? 'diff-hunk' : `diff-line-${line.kind}`}>
                {line.text || ' '}
              </div>
            ))}
          </pre>
        </div>
      ))}
    </div>
  );
}
