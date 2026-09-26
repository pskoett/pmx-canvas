export declare const WEBPAGE_NODE_DEFAULT_SIZE: {
    readonly width: 520;
    readonly height: 420;
};
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
export declare function normalizeWebpageUrl(rawUrl: string): string;
export declare function summarizeWebpageContent(data: Record<string, unknown>, maxLength?: number): string;
export type AddressScope = 'public' | 'private' | 'link-local';
/**
 * Where an IP literal points. `private` covers loopback, RFC 1918, CGNAT and
 * IPv6 ULA; `link-local` is kept apart because it holds cloud metadata
 * (169.254.169.254) and is refused on every hop.
 */
export declare function classifyAddress(address: string): AddressScope;
/**
 * Refuses link-local on every hop, and a redirect that moves a public fetch
 * onto a loopback or private address. A URL the caller points at a local dev
 * server on purpose still loads, and may redirect within the local network.
 */
export declare function checkWebpageHop(originScope: AddressScope, hopScope: AddressScope, hopUrl: string): void;
export declare function fetchWebpageSnapshot(inputUrl: string): Promise<WebpageSnapshot>;
export declare function getWebpageFetchErrorDetails(error: unknown): {
    message: string;
    statusCode: number | null;
    contentType: string | null;
};
