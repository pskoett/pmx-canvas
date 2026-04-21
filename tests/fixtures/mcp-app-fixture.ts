import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

let counter = 0;

const resourceUri = 'ui://fixture/counter.html';
const fixtureDir = dirname(fileURLToPath(import.meta.url));
const extAppsRuntimePath = join(
  fixtureDir,
  '..',
  '..',
  'node_modules',
  '@modelcontextprotocol',
  'ext-apps',
  'dist',
  'src',
  'app-with-deps.js',
);
const extAppsRuntimeSource = readFileSync(extAppsRuntimePath, 'utf-8');
const appBindingMatch = extAppsRuntimeSource.match(/([A-Za-z_$][\w$]*) as App/);
const transportBindingMatch = extAppsRuntimeSource.match(/([A-Za-z_$][\w$]*) as PostMessageTransport/);

if (!appBindingMatch || !transportBindingMatch) {
  throw new Error('Failed to locate App or PostMessageTransport export bindings in app-with-deps.js');
}

const extAppsBootstrapSource = `${extAppsRuntimeSource}
const App = ${appBindingMatch[1]};
const PostMessageTransport = ${transportBindingMatch[1]};`;

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Fixture Counter</title>
    <style>
      html, body {
        margin: 0;
        font: 14px/1.4 system-ui, sans-serif;
        background: #101828;
        color: #e5eef8;
      }
      main {
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 16px;
      }
      .card {
        width: min(320px, 100%);
        border: 1px solid rgba(148, 163, 184, 0.25);
        border-radius: 16px;
        background: rgba(15, 23, 42, 0.96);
        padding: 18px;
      }
      .count {
        font-size: 32px;
        font-weight: 700;
        margin: 8px 0 16px;
      }
      button {
        border: 0;
        border-radius: 999px;
        padding: 10px 14px;
        background: #38bdf8;
        color: #082f49;
        font-weight: 700;
        cursor: pointer;
      }
    </style>
  </head>
  <body>
    <main>
      <section class="card">
        <div>Fixture Counter</div>
        <div id="count" class="count">0</div>
        <button id="increment" type="button">Increment</button>
      </section>
    </main>
    <script type="module">
      ${extAppsBootstrapSource}

      const countEl = document.getElementById('count');
      const incrementButton = document.getElementById('increment');

      const render = (value) => {
        countEl.textContent = String(value ?? 0);
      };

      const app = new App({ name: 'fixture-counter', version: '1.0.0' }, {});
      app.ontoolresult = (result) => {
        render(result?.structuredContent?.count ?? 0);
      };

      incrementButton.addEventListener('click', async () => {
        const result = await app.callServerTool({
          name: 'increment',
          arguments: {},
        });
        const nextCount = result?.structuredContent?.count ?? 0;
        render(nextCount);
        await app.updateModelContext({
          structuredContent: { count: nextCount },
        });
      });

      await app.connect(new PostMessageTransport(window.parent, window.parent));
    </script>
  </body>
</html>`;

async function main(): Promise<void> {
  const server = new McpServer({
    name: 'fixture-counter',
    version: '1.0.0',
  });

  registerAppTool(
    server,
    'show_counter',
    {
      title: 'Counter App',
      description: 'Render a counter app inside the host.',
      inputSchema: {
        initial: z.number().optional(),
      },
      _meta: {
        ui: {
          resourceUri,
        },
      },
    },
    async ({ initial }) => {
      counter = typeof initial === 'number' ? initial : 0;
      return {
        content: [{ type: 'text', text: `Counter ready at ${counter}.` }],
        structuredContent: { count: counter },
      };
    },
  );

  registerAppTool(
    server,
    'increment',
    {
      description: 'Increment the counter from the app.',
      inputSchema: {},
      _meta: {
        ui: {
          resourceUri,
          visibility: ['app'],
        },
      },
    },
    async () => {
      counter += 1;
      return {
        content: [{ type: 'text', text: `Counter incremented to ${counter}.` }],
        structuredContent: { count: counter },
      };
    },
  );

  registerAppResource(
    server,
    'Fixture Counter',
    resourceUri,
    {
      mimeType: RESOURCE_MIME_TYPE,
    },
    async () => ({
      contents: [{
        uri: resourceUri,
        mimeType: RESOURCE_MIME_TYPE,
        text: html,
        _meta: {
          ui: {
            prefersBorder: true,
            csp: {
              resourceDomains: ['https://esm.sh'],
              connectDomains: ['https://esm.sh'],
            },
          },
        },
      }],
    }),
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
