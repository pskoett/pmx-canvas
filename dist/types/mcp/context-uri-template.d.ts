import { UriTemplate } from '@modelcontextprotocol/sdk/shared/uriTemplate.js';
/** SDK v1 matches {?a,b} as two required, ordered parameters, unlike its expansion. */
export declare class ContextUriTemplate extends UriTemplate {
    constructor();
    match(uri: string): Record<string, string> | null;
}
