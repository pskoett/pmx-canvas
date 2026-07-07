const HTML_CONTENT_SUMMARY_MAX_LENGTH = 900;
const HTML_AGENT_SUMMARY_MAX_LENGTH = 1200;
const HTML_REFERENCE_LIMIT = 12;

function pickString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: '&',
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"',
    apos: "'",
  };
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity) => {
    const lower = entity.toLowerCase();
    if (lower.startsWith('#x')) {
      const codePoint = Number.parseInt(lower.slice(2), 16);
      return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : match;
    }
    if (lower.startsWith('#')) {
      const codePoint = Number.parseInt(lower.slice(1), 10);
      return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : match;
    }
    return named[lower] ?? match;
  });
}

export function summarizeHtmlText(html: string): string | null {
  const withoutNoise = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ');
  const text = withoutNoise
    .replace(
      /<(?:h[1-6]|p|li|br|div|section|article|header|footer|main|aside|summary|figcaption|blockquote|tr|td|th)\b[^>]*>/gi,
      '\n',
    )
    .replace(/<[^>]+>/g, ' ');
  const normalized = normalizeWhitespace(decodeHtmlEntities(text));
  return normalized.length > 0 ? truncateText(normalized, HTML_CONTENT_SUMMARY_MAX_LENGTH) : null;
}

function uniqueLimited(values: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    unique.push(trimmed);
    if (unique.length >= HTML_REFERENCE_LIMIT) break;
  }
  return unique;
}

function extractHtmlNodeIds(html: string): string[] {
  const ids: string[] = [];
  for (const match of html.matchAll(/\b(?:node|graph|json-render|web-artifact|mcp-app|group)-[a-z0-9-]+\b/gi)) {
    ids.push(match[0]);
  }
  return uniqueLimited(ids);
}

function extractHtmlUrls(html: string): string[] {
  const urls: string[] = [];
  for (const match of html.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)) {
    const url = match[1]?.trim();
    if (!url) continue;
    if (/^(?:https?:)?\/\//i.test(url) || url.startsWith('/') || url.startsWith('ui://')) {
      urls.push(url);
    }
  }
  return uniqueLimited(urls);
}

function joinSummaryParts(parts: string[]): string | null {
  const summary = parts
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part, index, all) => all.findIndex((candidate) => candidate === part) === index)
    .join('\n');
  return summary ? truncateText(summary, HTML_AGENT_SUMMARY_MAX_LENGTH) : null;
}

export function normalizeHtmlNodeSemanticData<T extends Record<string, unknown>>(data: T): T {
  const {
    agentSummary: _agentSummary,
    contentSummary: _contentSummary,
    embeddedNodeIds: _embeddedNodeIds,
    embeddedUrls: _embeddedUrls,
    embeddedNodeId: _embeddedNodeId,
    embeddedGraphId: _embeddedGraphId,
    sourceNodeId: _sourceNodeId,
    ...base
  } = data;

  const html = pickString(base.html);
  const explicitSummary = pickString(base.summary) ?? pickString(base.description);
  const primitive = pickString(base.htmlPrimitive);
  const contentSummary = html ? summarizeHtmlText(html) : null;
  const explicitNodeIds = [
    ...strings(data.embeddedNodeIds),
    pickString(data.embeddedNodeId),
    pickString(data.embeddedGraphId),
    pickString(data.sourceNodeId),
  ].filter((value): value is string => value !== null);
  const embeddedNodeIds = uniqueLimited([...explicitNodeIds, ...(html ? extractHtmlNodeIds(html) : [])]);
  const embeddedUrls = uniqueLimited([...strings(data.embeddedUrls), ...(html ? extractHtmlUrls(html) : [])]);
  const agentSummary =
    pickString(data.agentSummary) ??
    joinSummaryParts([
      primitive ? `HTML primitive: ${primitive}` : '',
      explicitSummary ?? '',
      contentSummary ?? '',
      embeddedNodeIds.length > 0 ? `Embedded canvas nodes: ${embeddedNodeIds.join(', ')}` : '',
      embeddedUrls.length > 0 ? `Embedded URLs: ${embeddedUrls.join(', ')}` : '',
    ]);

  return {
    ...base,
    ...(contentSummary ? { contentSummary } : {}),
    ...(agentSummary ? { agentSummary } : {}),
    ...(embeddedNodeIds.length > 0 ? { embeddedNodeIds } : {}),
    ...(embeddedUrls.length > 0 ? { embeddedUrls } : {}),
  } as T;
}
