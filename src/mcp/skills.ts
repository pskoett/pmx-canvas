import { type McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { createBundledSkillCatalog } from '../server/bundled-skills.js';

/** SEP-2640 methods are protocol requests, not model-facing canvas tools. */
export function registerSkillExtension(server: McpServer, catalog = createBundledSkillCatalog()): void {
  // The v1 SDK accepts custom methods and transmits capabilities unchanged,
  // but its ServerCapabilities type predates the extensions field.
  const capabilities = { resources: {}, extensions: { 'io.modelcontextprotocol/skills': {} } };
  server.server.registerCapabilities(capabilities);
  server.server.setRequestHandler(
    z.object({ method: z.literal('skills/list'), params: z.object({ cursor: z.string().optional() }).optional() }),
    async ({ params }) => {
      // The bounded package catalog is a single page, so no cursor is issued.
      if (params?.cursor !== undefined) throw new McpError(ErrorCode.InvalidParams, 'Unknown skills cursor');
      return { resultType: 'complete', skills: catalog.skills };
    },
  );
  server.server.setRequestHandler(
    z.object({ method: z.literal('skills/get'), params: z.object({ uri: z.string() }) }),
    async ({ params }) => {
      const skill = catalog.skills.find((entry) => entry.uri === params.uri);
      if (!skill) throw new McpError(ErrorCode.InvalidParams, `No skill is served at ${params.uri}`);
      return { resultType: 'complete', skill };
    },
  );
  server.registerResource(
    'skill-files',
    new ResourceTemplate('skill://{name}/{+path}', { list: undefined }),
    { description: 'Packaged skill files. Discover complete manifests through skills/list or skills/get.' },
    async (uri) => {
      // Exact catalog lookup: a URI never becomes a filesystem path.
      const content = catalog.files.get(uri.href);
      if (!content) throw new McpError(ErrorCode.InvalidParams, `No skill file is served at ${uri.href}`);
      return { contents: [content] };
    },
  );
  for (const skill of catalog.skills) {
    server.registerResource(
      skill.frontmatter.name,
      skill.uri,
      { mimeType: 'text/markdown', description: skill.frontmatter.description },
      async () => ({ contents: [catalog.files.get(skill.uri)!] }),
    );
  }
}
