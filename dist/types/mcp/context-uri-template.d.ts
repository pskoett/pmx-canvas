import { UriTemplate } from '@modelcontextprotocol/sdk/shared/uriTemplate.js';
/** SDK v1 matches {?a,b} as two required, ordered parameters, unlike its expansion. */
export declare class ContextUriTemplate extends UriTemplate {
    private readonly host;
    private readonly parameters;
    constructor(host?: string, parameters?: string[]);
    match(uri: string): Record<string, string> | null;
}
