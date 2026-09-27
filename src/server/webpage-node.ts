import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { Readable } from 'node:stream';

const FETCH_TIMEOUT_MS = 10000;
const MAX_HTML_LENGTH = 1_000_000;
const MAX_TEXT_LENGTH = 50_000;
const EXCERPT_LENGTH = 420;
const MAX_REDIRECTS = 5;

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
  frameBlocked: boolean;
  frameBlockedReason: string | null;
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
  for (const match of tag.matchAll(pattern)) {
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

function extractFrameAncestorsDirective(contentSecurityPolicy: string | null): string | null {
  if (!contentSecurityPolicy) return null;
  const directives = contentSecurityPolicy
    .split(';')
    .map((directive) => directive.trim())
    .filter(Boolean);
  for (const directive of directives) {
    if (!directive.toLowerCase().startsWith('frame-ancestors')) continue;
    return directive;
  }
  return null;
}

function inferFrameBlocking(headers: Headers): {
  frameBlocked: boolean;
  frameBlockedReason: string | null;
} {
  const xFrameOptions = headers.get('x-frame-options')?.trim() ?? null;
  if (xFrameOptions) {
    const normalized = xFrameOptions.toLowerCase();
    if (normalized === 'deny') {
      return {
        frameBlocked: true,
        frameBlockedReason: 'Live preview blocked by X-Frame-Options: DENY.',
      };
    }
    if (normalized === 'sameorigin') {
      return {
        frameBlocked: true,
        frameBlockedReason: 'Live preview blocked by X-Frame-Options: SAMEORIGIN.',
      };
    }
  }

  const frameAncestors = extractFrameAncestorsDirective(headers.get('content-security-policy'));
  if (frameAncestors) {
    const sources = frameAncestors
      .split(/\s+/)
      .slice(1)
      .map((source) => source.trim().toLowerCase())
      .filter(Boolean);

    if (sources.includes("'none'")) {
      return {
        frameBlocked: true,
        frameBlockedReason: "Live preview blocked by Content-Security-Policy: frame-ancestors 'none'.",
      };
    }

    if (
      sources.length > 0 &&
      !sources.includes('*') &&
      !sources.includes('http:') &&
      !sources.includes('https:') &&
      !sources.some((source) => source.includes('localhost') || source.includes('127.0.0.1'))
    ) {
      return {
        frameBlocked: true,
        frameBlockedReason: `Live preview likely blocked by Content-Security-Policy: ${frameAncestors}.`,
      };
    }
  }

  return {
    frameBlocked: false,
    frameBlockedReason: null,
  };
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
  const excerpt =
    typeof data.excerpt === 'string' ? data.excerpt : typeof data.content === 'string' ? data.content : '';

  if (url) parts.push(`URL: ${url}`);
  if (pageTitle) parts.push(`Title: ${pageTitle}`);
  if (description) parts.push(`Description: ${description}`);
  if (excerpt) parts.push(excerpt.slice(0, maxLength));

  return parts.join('\n').trim();
}

export type AddressScope = 'public' | 'private' | 'link-local';

/**
 * Where an IP literal points. `private` covers loopback, RFC 1918, CGNAT and
 * IPv6 ULA; `link-local` is kept apart because it holds cloud metadata
 * (169.254.169.254) and is refused on every hop.
 */
export function classifyAddress(address: string): AddressScope {
  let ip = address.toLowerCase().replace(/^\[|\]$/g, '');
  // URL canonicalization also covers expanded IPv6 and dotted mapped IPv4.
  // Checking only ::ffff:a.b.c.d misses the hex form used by URL.hostname.
  if (isIP(ip) === 6) ip = new URL(`http://[${ip}]/`).hostname.slice(1, -1);
  const mapped = ip.match(/^::ffff:([\da-f]+):([\da-f]+)$/);
  if (mapped) {
    const high = Number.parseInt(mapped[1], 16);
    const low = Number.parseInt(mapped[2], 16);
    return classifyAddress(`${high >>> 8}.${high & 255}.${low >>> 8}.${low & 255}`);
  }
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 169 && b === 254) return 'link-local';
    if (a === 127 || a === 10 || a === 0) return 'private';
    if (a === 172 && b >= 16 && b <= 31) return 'private';
    if (a === 192 && b === 168) return 'private';
    if (a === 100 && b >= 64 && b <= 127) return 'private';
    return 'public';
  }
  if (/^fe[89ab]/.test(ip)) return 'link-local';
  if (ip === '::1' || ip === '::' || /^f[cd]/.test(ip)) return 'private';
  return 'public';
}

interface ResolvedHop {
  addresses: string[];
  scope: AddressScope;
}

type ResolveHost = (hostname: string) => Promise<Array<{ address: string; family: number }>>;

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException('The operation was aborted.', 'AbortError'));
    if (signal.aborted) return abort();
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

/** Resolves a hop once, retaining the narrowest scope any returned address reaches. */
async function resolveHop(url: URL, resolveHost: ResolveHost): Promise<ResolvedHop> {
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await resolveHost(host);
  const selected = addresses[0];
  if (!selected || (selected.family !== 4 && selected.family !== 6)) {
    throw new WebpageFetchError(`Could not resolve ${host}.`);
  }
  const scopes = addresses.map((entry) => classifyAddress(entry.address));
  const scope = scopes.includes('link-local') ? 'link-local' : scopes.includes('private') ? 'private' : 'public';
  return { addresses: addresses.map((entry) => entry.address), scope };
}

async function requestHop(url: URL, resolved: ResolvedHop, signal: AbortSignal): Promise<Response> {
  let failure: unknown;
  for (const address of resolved.addresses) {
    try {
      return await requestAddress(url, address, signal);
    } catch (error) {
      if (signal.aborted) throw error;
      failure = error;
    }
  }
  throw failure;
}

function requestAddress(url: URL, address: string, signal: AbortSignal): Promise<Response> {
  return new Promise((resolve, reject) => {
    const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(
      url,
      {
        method: 'GET',
        hostname: address,
        servername: isIP(url.hostname.replace(/^\[|\]$/g, '')) ? undefined : url.hostname,
        signal,
        headers: {
          Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1',
          Host: url.host,
          'User-Agent': 'pmx-canvas webpage node',
        },
      },
      (incoming) => {
        const headers = new Headers();
        for (let index = 0; index < incoming.rawHeaders.length; index += 2) {
          headers.append(incoming.rawHeaders[index], incoming.rawHeaders[index + 1]);
        }
        const status = incoming.statusCode ?? 500;
        const empty = status === 204 || status === 205 || status === 304;
        // Node and DOM declare separate types for the same web-stream API.
        const body = empty ? null : (Readable.toWeb(incoming) as unknown as ReadableStream<Uint8Array>);
        if (empty) incoming.resume();
        resolve(new Response(body, { status, statusText: incoming.statusMessage, headers }));
      },
    );
    request.on('error', reject);
    request.end();
  });
}

async function readBoundedBody(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder();
  let body = '';
  let bytes = 0;
  while (bytes < MAX_HTML_LENGTH) {
    const { done, value } = await reader.read();
    if (done) break;
    const remaining = MAX_HTML_LENGTH - bytes;
    body += decoder.decode(value.subarray(0, remaining), { stream: value.byteLength <= remaining });
    bytes += Math.min(value.byteLength, remaining);
    if (value.byteLength > remaining || bytes === MAX_HTML_LENGTH) {
      await reader.cancel();
      break;
    }
  }
  return body + decoder.decode();
}

/**
 * Refuses link-local on every hop, and a redirect that moves a public fetch
 * onto a loopback or private address. A URL the caller points at a local dev
 * server on purpose still loads, and may redirect within the local network.
 */
export function checkWebpageHop(originScope: AddressScope, hopScope: AddressScope, hopUrl: string): void {
  if (hopScope === 'link-local') {
    throw new WebpageFetchError(`Refused to fetch ${hopUrl}: link-local addresses are not allowed.`);
  }
  if (originScope === 'public' && hopScope === 'private') {
    throw new WebpageFetchError(`Refused redirect to ${hopUrl}: a public page may not redirect to a private address.`);
  }
}

export async function fetchWebpageSnapshot(
  inputUrl: string,
  options: { resolveHost?: ResolveHost; timeoutMs?: number } = {},
): Promise<WebpageSnapshot> {
  const url = normalizeWebpageUrl(inputUrl);
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? FETCH_TIMEOUT_MS;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const resolveHost = options.resolveHost ?? ((host) => lookup(host, { all: true }));

  try {
    // Redirects are followed by hand so every hop's host is checked before it is fetched.
    let resolved = await abortable(resolveHop(new URL(url), resolveHost), controller.signal);
    const originScope = resolved.scope;
    let hopUrl = url;
    let response: Response;
    for (let hop = 0; ; hop++) {
      checkWebpageHop(originScope, resolved.scope, hopUrl);
      response = await requestHop(new URL(hopUrl), resolved, controller.signal);
      const location = response.headers.get('location');
      if (response.status < 300 || response.status >= 400 || !location) break;
      await response.body?.cancel();
      if (hop === MAX_REDIRECTS) throw new WebpageFetchError(`Too many redirects while fetching ${url}.`);
      hopUrl = normalizeWebpageUrl(new URL(location, hopUrl).toString());
      resolved = await abortable(resolveHop(new URL(hopUrl), resolveHost), controller.signal);
    }

    const contentType = response.headers.get('content-type');
    const responseUrl = hopUrl;
    const body = await readBoundedBody(response);

    if (!response.ok) {
      throw new WebpageFetchError(`Request failed with ${response.status} ${response.statusText}`.trim(), {
        statusCode: response.status,
        contentType,
      });
    }

    const pageTitle =
      extractMetaContent(body, 'og:title') ?? extractMetaContent(body, 'twitter:title') ?? extractTitle(body);
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
    const { frameBlocked, frameBlockedReason } = inferFrameBlocking(response.headers);

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
      frameBlocked,
      frameBlockedReason,
    };
  } catch (error) {
    if (error instanceof WebpageFetchError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new WebpageFetchError(`Timed out after ${timeoutMs}ms while fetching ${url}.`);
    }
    throw new WebpageFetchError(error instanceof Error ? error.message : `Failed to fetch ${url}.`);
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
