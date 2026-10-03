import { AppBridge, PostMessageTransport } from '@modelcontextprotocol/ext-apps/app-bridge';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

// Real MCP Apps SDK host used by the browser tests. This is not ChatGPT.
const contexts: unknown[] = [];
const acknowledgedContexts: unknown[] = [];
const messages: unknown[] = [];
const downloads: unknown[] = [];
let initialResult: CallToolResult | undefined;
const state = {
  contexts,
  acknowledgedContexts,
  messages,
  downloads,
  failReads: false,
  rejectMessages: false,
  rejectContext: false,
  holdContext: false,
  releaseContext: () => {},
  initialReady: false,
  deliverInitial: async () => {
    if (!initialResult) throw new Error('Initial result not captured');
    await bridge.sendToolResult(initialResult);
    // Ordered round trip: tests know the earlier notification was processed.
    await bridge.request({ method: 'ping' }, z.object({}));
  },
};
declare global {
  interface Window {
    pmxTestHost: typeof state;
  }
}
window.pmxTestHost = state;
const params = new URLSearchParams(location.search);
const toolsOnly = params.has('toolsOnly');
const bridge = new AppBridge(
  null,
  { name: 'PMX test host', version: '1' },
  {
    serverTools: {},
    ...(toolsOnly ? {} : { downloadFile: {} }),
    ...(toolsOnly ? {} : { updateModelContext: { text: {} }, message: { text: {} } }),
  },
  {
    hostContext: {
      theme: params.has('light') ? 'light' : 'dark',
      displayMode: 'fullscreen',
      availableDisplayModes: ['inline', 'fullscreen'],
      platform: 'web',
    },
  },
);
bridge.oncalltool = async (input) => {
  if (state.failReads) return { isError: true, content: [{ type: 'text', text: 'Test read failure' }] };
  return (await (
    await fetch('/test-tool', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
  ).json()) as CallToolResult;
};
bridge.onupdatemodelcontext = async (input) => {
  contexts.push(input);
  if (state.holdContext)
    await new Promise<void>((resolve) => {
      state.releaseContext = resolve;
    });
  if (state.rejectContext) throw new Error('Test context refusal');
  acknowledgedContexts.push(input);
  return {};
};
bridge.onmessage = async (input) => {
  messages.push(input);
  return state.rejectMessages ? { isError: true } : {};
};
bridge.ondownloadfile = async (input) => {
  downloads.push(input);
  return {};
};
bridge.oninitialized = async () => {
  await bridge.sendToolInput({ arguments: {} });
  initialResult = (await (
    await fetch('/test-tool', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'pmx_open_canvas', arguments: {} }),
    })
  ).json()) as CallToolResult;
  state.initialReady = true;
  if (!params.has('holdInitial')) await state.deliverInitial();
};
const iframe = document.createElement('iframe');
iframe.title = 'PMX Canvas App';
iframe.setAttribute('sandbox', 'allow-scripts');
iframe.style.cssText = 'border:0;width:100%;height:100dvh;display:block';
document.body.style.margin = '0';
document.body.append(iframe);
await bridge.connect(new PostMessageTransport(iframe.contentWindow!, iframe.contentWindow!));
const html = await (await fetch('/test-resource')).text();
iframe.srcdoc = html.replace(
  '<head>',
  `<head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; frame-src ${params.has('localFrames') ? "'self' blob: data:" : "'none'"}">`,
);
