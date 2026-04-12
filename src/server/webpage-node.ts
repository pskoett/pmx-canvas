const FETCH_TIMEOUT_MS = 10000;
const MAX_HTML_LENGTH = 1_000_000;
const MAX_TEXT_LENGTH = 50_000;
const EXCERPT_LENGTH = 420;

export const WEBPAGE_NODE_DEFAULT_SIZE = {
  width: 520,
  height: 420,
} as const;

export interface WebpageSnapshot {
  url: string;
  pageTitle: string | null;
  description: string | null;
  imageUrl: string | null;
  content: string;
  excerpt: string;
  fetchedAt: string;
  statusCode: number;
  contentType: string | null;
}

class WebpageFetchError extends Error {
  readonly statusCode: number | null;
  readonly contentType: string | null;

  constructor(message: string, options?: { statusCode?: number; contentType?: string | null }) {
    super(message);
    this.name = 'WebpageFetchError';
    this.statusCode = options?.statusCode ?? null;
    this.contentType = options?.contentType ?? null;
  }
}

function decodeHtmlEntities(text: string): string {
  const named: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
  };

  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (entity, token: string) => {
    const lower = token.toLowerCase();
    if (lower in named) return named[lower] ?? entity;
    if (lower.startsWith('#x')) {
      const codePoint = Number.parseInt(lower.slice(2), 16);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : entity;
    }
    if (lower.startsWith('#')) {
      const codePoint = Number.parseInt(lower.slice(1), 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : entity;
    }
    return entity;
  });
}

function normalizeText(text: string): string {
  return decodeHtmlEntities(text)
    .replace(/\r\n?/g, '\n')
    .replace(/[\t\f\v ]+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .replace(/\s+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function parseTagAttributes(tag: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const pattern = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  let match: RegExpExecArray | null = null;
  while ((match = pattern.exec(tag)) !== null) {
    const [, name, doubleQuoted, singleQuoted, unquoted] = match;
    attributes[name.toLowerCase()] = doubleQuoted ?? singleQuoted ?? unquoted ?? '';
  }
  return attributes;
}

function extractMetaContent(html: string, key: string): string | null {
  const metaTags = html.match(/<meta\b[^>]*>/gi) ?? [];
  const target = key.toLowerCase();
  for (const tag of metaTags) {
    const attributes = parseTagAttributes(tag);
    const property = attributes.property?.toLowerCase();
    const name = attributes.name?.toLowerCase();
    if (property === target || name === target) {
      const content = attributes.content?.trim();
      if (content) return normalizeText(content);
    }
  }
  return null;
}

function extractTitle(html: string): string | null {
  const title = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? null;
  if (!title) return null;
  const normalized = normalizeText(title);
  return normalized.length > 0 ? normalized : null;
}

function resolveMaybeRelativeUrl(baseUrl: string, rawUrl: string | null): string | null {
  if (!rawUrl) return null;
  try {
    return new URL(rawUrl, baseUrl).toString();
  } catch {
    return null;
  }
}

function extractReadableText(html: string): string {
  const body = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? html;
  const primary =
    body.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] ??
    body.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1] ??
    body;

  const text = primary
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<template\b[^>]*>[\s\S]*?<\/template>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|section|article|header|footer|aside|main|nav|li|ul|ol|h[1-6]|tr|td|blockquote|pre)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');

  return normalizeText(text).slice(0, MAX_TEXT_LENGTH);
}

export function normalizeWebpageUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    throw new Error('Webpage nodes require a non-empty URL.');
  }

  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error('Webpage nodes require a valid http(s) URL.');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Webpage nodes only support http(s) URLs.');
  }

  return url.toString();
}

export function summarizeWebpageContent(data: Record<string, unknown>, maxLength = 500): string {
  const parts: string[] = [];
  const url = typeof data.url === 'string' ? data.url : '';
  const pageTitle = typeof data.pageTitle === 'string' ? data.pageTitle : '';
  const description = typeof data.description === 'string' ? data.description : '';
  const excerpt = typeof data.excerpt === 'string'
    ? data.excerpt
    : typeof data.content === 'string'
      ? data.content
      : '';

  if (url) parts.push(`URL: ${url}`);
  if (pageTitle) parts.push(`Title: ${pageTitle}`);
  if (description) parts.push(`Description: ${description}`);
  if (excerpt) parts.push(excerpt.slice(0, maxLength));

  return parts.join('\n').trim();
}

export async function fetchWebpageSnapshot(inputUrl: string): Promise<WebpageSnapshot> {
  const url = normalizeWebpageUrl(inputUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1',
        'User-Agent': 'pmx-canvas webpage node',
      },
    });

    const contentType = response.headers.get('content-type');
    const responseUrl = normalizeWebpageUrl(response.url || url);
    const body = (await response.text()).slice(0, MAX_HTML_LENGTH);

    if (!response.ok) {
      throw new WebpageFetchError(`Request failed with ${response.status} ${response.statusText}`.trim(), {
        statusCode: response.status,
        contentType,
      });
    }

    const pageTitle =
      extractMetaContent(body, 'og:title') ??
      extractMetaContent(body, 'twitter:title') ??
      extractTitle(body);
    const description =
      extractMetaContent(body, 'description') ??
      extractMetaContent(body, 'og:description') ??
      extractMetaContent(body, 'twitter:description');
    const imageUrl = resolveMaybeRelativeUrl(
      responseUrl,
      extractMetaContent(body, 'og:image') ?? extractMetaContent(body, 'twitter:image'),
    );
    const content = extractReadableText(body);
    const excerpt = content.slice(0, EXCERPT_LENGTH);

    return {
      url: responseUrl,
      pageTitle,
      description,
      imageUrl,
      content,
      excerpt,
      fetchedAt: new Date().toISOString(),
      statusCode: response.status,
      contentType,
    };
  } catch (error) {
    if (error instanceof WebpageFetchError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new WebpageFetchError(`Timed out after ${FETCH_TIMEOUT_MS}ms while fetching ${url}.`);
    }
    throw new WebpageFetchError(
      error instanceof Error ? error.message : `Failed to fetch ${url}.`,
    );
  } finally {
    clearTimeout(timeout);
  }
}

export function getWebpageFetchErrorDetails(error: unknown): {
  message: string;
  statusCode: number | null;
  contentType: string | null;
} {
  if (error instanceof WebpageFetchError) {
    return {
      message: error.message,
      statusCode: error.statusCode,
      contentType: error.contentType,
    };
  }
  return {
    message: error instanceof Error ? error.message : 'Unknown webpage fetch failure.',
    statusCode: null,
    contentType: null,
  };
}
