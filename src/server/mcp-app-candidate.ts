/**
 * MCP app candidate detection — standalone version.
 *
 * Removed PMX-specific imports (inferServerNameFromToolName, excalidraw-url helpers).
 * Inlined the necessary URL detection logic.
 */

export interface McpAppToolCompletionInput {
  name: string;
  mcpServerName?: string;
  mcpToolName?: string;
  result: unknown;
  content?: string;
  detailedContent?: string;
}

export interface McpAppToolCandidate {
  url: string;
  inferredType: string;
  keyHint: string;
  sourceServer: string | null;
  sourceTool: string;
}

export function inferMcpAppType(url: string): string {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const href = parsed.toString().toLowerCase();
    if (host.includes('excalidraw')) return 'diagram';
    if (href.includes('figma')) return 'design';
    if (href.endsWith('.pdf')) return 'pdf-viewer';
    if (href.includes('/apps/')) return 'mcp-app';
    return 'app-surface';
  } catch {
    return 'app-surface';
  }
}

function isExcalidrawWebUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    return host.includes('excalidraw.com') || host.includes('excalidraw-mcp-app');
  } catch {
    return false;
  }
}

export function isLikelyMcpAppWebUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const href = parsed.toString().toLowerCase();
    if (host.includes('modelcontextprotocol')) return true;
    if (host.includes('mcp-app')) return true;
    if (host.includes('mcp') && host.includes('vercel.app')) return true;
    if (href.includes('/mcp/') || href.includes('/apps/')) return true;
    if (isExcalidrawWebUrl(url)) return true;
    return false;
  } catch {
    return false;
  }
}

function inferServerNameFromToolName(name: string): string | null {
  // Simple heuristic: if tool name has a prefix like "server__tool", extract server
  const match = name.match(/^([a-z0-9_-]+)__/i);
  return match ? match[1] : null;
}

export function inferMcpAppSourceServer(
  input: Pick<McpAppToolCompletionInput, 'name' | 'mcpServerName'>,
  url: string,
): string | null {
  const explicit = String(input.mcpServerName || '').trim();
  if (explicit) return explicit;

  const inferredFromName = inferServerNameFromToolName(String(input.name || '').trim());
  if (inferredFromName) return inferredFromName;

  if (isExcalidrawWebUrl(url)) return 'excalidraw';
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function collectToolResultTextFragments(result: unknown): string[] {
  const fragments: string[] = [];
  if (typeof result === 'string') {
    fragments.push(result);
  } else if (isRecord(result)) {
    for (const value of Object.values(result)) {
      if (typeof value === 'string') fragments.push(value);
    }
    if (Array.isArray(result.content)) {
      for (const item of result.content) {
        if (isRecord(item) && typeof item.text === 'string') {
          fragments.push(item.text);
        }
      }
    }
  }
  return fragments;
}

function collectToolResultUrlCandidates(result: unknown): Array<{ url: string; keyHint: string }> {
  const candidates: Array<{ url: string; keyHint: string }> = [];
  if (!isRecord(result)) return candidates;
  for (const [key, value] of Object.entries(result)) {
    if (typeof value === 'string' && /^https?:\/\//.test(value)) {
      candidates.push({ url: value, keyHint: key });
    }
  }
  if (Array.isArray(result.content)) {
    for (const item of result.content) {
      if (isRecord(item) && item.type === 'resource' && isRecord(item.resource)) {
        const uri = item.resource.uri;
        if (typeof uri === 'string' && /^https?:\/\//.test(uri)) {
          candidates.push({ url: uri, keyHint: 'resource' });
        }
      }
    }
  }
  return candidates;
}

function toSafeExternalUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export function getMcpAppCandidateFromToolCompletion(
  data: McpAppToolCompletionInput,
): McpAppToolCandidate | null {
  const inlineUrls = [
    ...(typeof data.content === 'string' ? [data.content] : []),
    ...(typeof data.detailedContent === 'string' ? [data.detailedContent] : []),
    ...collectToolResultTextFragments(data.result),
  ].flatMap((value) =>
    (value.match(/https?:\/\/[^\s<>"'`]+/gi) ?? []).map((url) => ({ url, keyHint: 'inline' })),
  );

  const nestedUrls = collectToolResultUrlCandidates(data.result);
  const candidates = [...inlineUrls, ...nestedUrls];
  const sourceHasMcp = [data.mcpServerName ?? '', data.mcpToolName ?? '', data.name]
    .join(' ')
    .toLowerCase()
    .includes('mcp');

  for (const entry of candidates) {
    const safe = toSafeExternalUrl(entry.url);
    if (!safe) continue;
    const key = entry.keyHint.toLowerCase();
    const hintedByKey =
      /resource|resource_link|resourceurl|resource_url|app|uri|url|link|viewer|preview|canvas/.test(
        key,
      );
    const hintedByUrl = isLikelyMcpAppWebUrl(safe);
    if (!hintedByKey && !hintedByUrl && !sourceHasMcp) continue;
    return {
      url: safe,
      inferredType: inferMcpAppType(safe),
      keyHint: entry.keyHint || 'unknown',
      sourceServer: inferMcpAppSourceServer(data, safe),
      sourceTool: String(data.mcpToolName || data.name || 'mcp-tool').trim() || 'mcp-tool',
    };
  }
  return null;
}
