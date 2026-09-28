import { UriTemplate } from '@modelcontextprotocol/sdk/shared/uriTemplate.js';

/** SDK v1 matches {?a,b} as two required, ordered parameters, unlike its expansion. */
export class ContextUriTemplate extends UriTemplate {
  constructor() {
    super('canvas://context{?budget,consumer,since}');
  }

  override match(uri: string): Record<string, string> | null {
    if (!URL.canParse(uri)) return null;
    const url = new URL(uri);
    if (
      url.protocol !== 'canvas:' ||
      url.host !== 'context' ||
      url.pathname ||
      url.hash ||
      url.username ||
      url.password
    )
      return null;
    const variables: Record<string, string> = {};
    for (const [key, value] of url.searchParams) {
      if (!['budget', 'consumer', 'since'].includes(key) || key in variables) return null;
      variables[key] = value;
    }
    return variables;
  }
}
