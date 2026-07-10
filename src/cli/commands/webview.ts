// WebView automation commands: webview status|start|stop|evaluate|resize|
// screenshot and the top-level screenshot alias.

import { readFileSync, writeFileSync } from 'node:fs';
import { wrapCanvasAutomationScript } from '../../server/server.js';
import {
  cmd,
  COMMANDS,
  die,
  getBaseUrl,
  invokeOperation,
  optionalNumberFlag,
  output,
  parseFlags,
  requireFlag,
  showCommandHelp,
} from '../shared.js';

// ── webview status ────────────────────────────────────────────
cmd('webview status', 'Show Bun.WebView automation status', ['pmx-canvas webview status'], async (args) => {
  const { flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('webview status');

  const result = await invokeOperation('webview.status', {});
  output(result);
});

// ── webview start ─────────────────────────────────────────────
cmd(
  'webview start',
  'Start or replace the Bun.WebView automation session',
  [
    'pmx-canvas webview start',
    'pmx-canvas webview start --backend chrome --width 1440 --height 900',
    'pmx-canvas webview start --chrome-path /Applications/Google\\ Chrome.app/.../Google\\ Chrome',
  ],
  async (args) => {
    const { flags } = parseFlags(args);
    if (flags.help || flags.h) return showCommandHelp('webview start');

    const backend = flags.backend;
    if (backend && backend !== true && backend !== 'chrome' && backend !== 'webkit') {
      die('Invalid value for --backend', 'Use: --backend chrome or --backend webkit');
    }

    const body: Record<string, unknown> = {};
    if (backend && backend !== true) body.backend = backend;

    const width = optionalNumberFlag(flags, 'width', 'Use a positive integer width, e.g. --width 1440');
    const height = optionalNumberFlag(flags, 'height', 'Use a positive integer height, e.g. --height 900');
    if (width !== undefined) body.width = width;
    if (height !== undefined) body.height = height;

    if (flags['chrome-path'] && flags['chrome-path'] !== true) {
      body.chromePath = flags['chrome-path'];
    }

    if (flags['data-dir'] && flags['data-dir'] !== true) {
      body.dataStoreDir = flags['data-dir'];
    }

    if (flags['chrome-argv'] && flags['chrome-argv'] !== true) {
      const chromeArgv = String(flags['chrome-argv'])
        .split(',')
        .map((value) => value.trim())
        .filter((value) => value.length > 0);
      if (chromeArgv.length > 0) body.chromeArgv = chromeArgv;
    }

    // webview.start declares errorBodyAsResult, so failure envelopes
    // ({ ok:false, error, webview? }) are returned and printed like before.
    const result = await invokeOperation('webview.start', body);
    output(result);
  },
);

// ── webview stop ──────────────────────────────────────────────
cmd('webview stop', 'Stop the active Bun.WebView automation session', ['pmx-canvas webview stop'], async (args) => {
  const { flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('webview stop');

  const result = await invokeOperation('webview.stop', {});
  output(result);
});

// ── webview evaluate ──────────────────────────────────────────
cmd(
  'webview evaluate',
  'Evaluate JavaScript in the active Bun.WebView automation session',
  [
    'pmx-canvas webview evaluate --expression "document.title"',
    'pmx-canvas webview evaluate --script "const title = document.title; return title.toUpperCase()"',
    'pmx-canvas webview evaluate --file ./probe.js',
  ],
  async (args) => {
    const { flags } = parseFlags(args);
    if (flags.help || flags.h) return showCommandHelp('webview evaluate');

    const sourceCount = [flags.expression, flags.script, flags.file].filter(Boolean).length;
    if (sourceCount > 1) {
      die(
        'Use only one of --expression, --script, or --file.',
        'pmx-canvas webview evaluate --expression "document.title"',
      );
    }

    let expression = '';
    if (typeof flags.file === 'string') {
      let script = '';
      try {
        script = readFileSync(flags.file, 'utf-8');
      } catch (error) {
        die(
          `Unable to read --file: ${error instanceof Error ? error.message : String(error)}`,
          'pmx-canvas webview evaluate --file ./probe.js',
        );
      }
      expression = wrapCanvasAutomationScript(script);
    } else if (typeof flags.script === 'string') {
      expression = wrapCanvasAutomationScript(flags.script);
    } else {
      expression = requireFlag(flags, 'expression', 'pmx-canvas webview evaluate --expression "document.title"');
    }

    // Send ONLY expression — the CLI already wraps --script/--file into an
    // expression; passing the op's `script` input would double-wrap server-side.
    const result = await invokeOperation('webview.evaluate', { expression });
    output(result);
  },
);

// ── webview resize ────────────────────────────────────────────
cmd(
  'webview resize',
  'Resize the active Bun.WebView automation session viewport',
  ['pmx-canvas webview resize --width 1280 --height 800'],
  async (args) => {
    const { flags } = parseFlags(args);
    if (flags.help || flags.h) return showCommandHelp('webview resize');

    const width = optionalNumberFlag(flags, 'width', 'Use: pmx-canvas webview resize --width 1280 --height 800');
    const height = optionalNumberFlag(flags, 'height', 'Use: pmx-canvas webview resize --width 1280 --height 800');
    if (width === undefined || height === undefined) {
      die('Missing required flags: --width, --height', 'Use: pmx-canvas webview resize --width 1280 --height 800');
    }

    const result = await invokeOperation('webview.resize', { width, height });
    output(result);
  },
);

// ── webview screenshot ────────────────────────────────────────
cmd(
  'webview screenshot',
  'Capture a screenshot from the active Bun.WebView automation session',
  [
    'pmx-canvas webview screenshot --output ./canvas.png',
    'pmx-canvas webview screenshot --output ./canvas.webp --format webp --quality 80',
  ],
  async (args) => {
    const { flags } = parseFlags(args);
    if (flags.help || flags.h) return showCommandHelp('webview screenshot');

    const outputPath = requireFlag(flags, 'output', 'pmx-canvas webview screenshot --output ./canvas.png');

    const body: Record<string, unknown> = {};
    if (flags.format && flags.format !== true) {
      const format = String(flags.format);
      if (format !== 'png' && format !== 'jpeg' && format !== 'webp') {
        die('Invalid value for --format', 'Use: --format png, jpeg, or webp');
      }
      body.format = format;
    }

    if (flags.quality && flags.quality !== true) {
      const quality = Number(flags.quality);
      if (!Number.isFinite(quality)) {
        die(`Invalid value for --quality: ${String(flags.quality)}`, 'Use a numeric quality, e.g. --quality 80');
      }
      body.quality = quality;
    }

    const base = getBaseUrl();
    const response = await fetch(`${base}/api/workbench/webview/screenshot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      try {
        const json = JSON.parse(text) as Record<string, unknown>;
        die(
          json.error ? String(json.error) : `HTTP ${response.status}`,
          typeof json.hint === 'string' ? json.hint : undefined,
        );
      } catch {
        die(`HTTP ${response.status}: ${text}`);
      }
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    writeFileSync(outputPath, bytes);
    output({
      ok: true,
      output: outputPath,
      bytes: bytes.byteLength,
      mimeType: response.headers.get('Content-Type') ?? 'application/octet-stream',
    });
  },
);

cmd(
  'screenshot',
  'Capture a screenshot from the active Bun.WebView automation session',
  [
    'pmx-canvas screenshot --output ./canvas.png',
    'pmx-canvas screenshot --output ./canvas.webp --format webp --quality 80',
  ],
  async (args) => {
    if (args.includes('--help') || args.includes('-h')) return showCommandHelp('screenshot');
    const screenshotCommand = COMMANDS['webview screenshot'];
    if (!screenshotCommand) die('Internal error: webview screenshot command is unavailable.');
    await screenshotCommand.run(args);
  },
);
