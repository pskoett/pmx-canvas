import { type ViewerSource } from './ViewerFrame';
export declare function createIframeDocumentUrl(html: string, sandbox: string, signal?: AbortSignal): Promise<string>;
export declare function useIframeDocument(html: string, sandbox: string): ViewerSource;
