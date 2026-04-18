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
}
export declare function normalizeWebpageUrl(rawUrl: string): string;
export declare function summarizeWebpageContent(data: Record<string, unknown>, maxLength?: number): string;
export declare function fetchWebpageSnapshot(inputUrl: string): Promise<WebpageSnapshot>;
export declare function getWebpageFetchErrorDetails(error: unknown): {
    message: string;
    statusCode: number | null;
    contentType: string | null;
};
