export declare function createIframeDocumentUrl(html: string, sandbox: string): Promise<string>;
export declare function useIframeDocument(html: string, sandbox: string): {
    attributes: {
        src?: string;
        srcdoc?: string;
    };
    ready: boolean;
    key: string;
};
