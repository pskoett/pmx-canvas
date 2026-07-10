// App/composite commands: external-app add, diagram add, batch, and
// web-artifact build.

import { readFileSync } from 'node:fs';
import { DEFAULT_EXCALIDRAW_ELEMENTS } from '../../server/diagram-presets.js';
import {
  applyCommonGeometryFlags,
  cmd,
  COMMANDS,
  die,
  getStringFlag,
  invokeOperation,
  optionalPositiveFiniteFlag,
  output,
  parseFlags,
  parseJsonValue,
  readStdin,
  runWebArtifactBuildCommand,
  showCommandHelp,
} from '../shared.js';

// ── external-app add ─────────────────────────────────────────
cmd(
  'external-app add',
  'Create a hosted external app node',
  ['pmx-canvas external-app add --kind excalidraw --title "Diagram"'],
  async (args) => {
    const { flags } = parseFlags(args);
    if (flags.help || flags.h) return showCommandHelp('external-app add');

    const kind = typeof flags.kind === 'string' ? flags.kind.trim() : '';
    if (kind !== 'excalidraw') {
      die('Unsupported external app kind.', 'Use: pmx-canvas external-app add --kind excalidraw --title "Diagram"');
    }

    const body: Record<string, unknown> = {
      title: typeof flags.title === 'string' ? flags.title : 'Excalidraw Diagram',
      elements: DEFAULT_EXCALIDRAW_ELEMENTS,
    };
    const nodeId = getStringFlag(flags, 'node-id', 'nodeId', 'id');
    if (nodeId) body.nodeId = nodeId;
    const elementsJson = getStringFlag(flags, 'elements-json', 'elements');
    if (elementsJson !== undefined)
      body.elements = parseJsonValue(
        elementsJson,
        'Excalidraw elements',
        'Use --elements-json \'[{"type":"rectangle","id":"r1","x":0,"y":0,"width":120,"height":80}]\'',
      );
    const elementsFile = getStringFlag(flags, 'elements-file', 'initial-file');
    if (elementsFile)
      body.elements = parseJsonValue(
        readFileSync(elementsFile, 'utf-8'),
        'Excalidraw elements file',
        'Use --elements-file ./scene.excalidraw',
      );
    applyCommonGeometryFlags(body, flags, {
      x: 'Use a finite number, e.g. --x 500',
      y: 'Use a finite number, e.g. --y 300',
      width: 'Use a positive number, e.g. --width 960',
      height: 'Use a positive number, e.g. --height 720',
    });
    const timeoutMs = optionalPositiveFiniteFlag(
      flags,
      'timeout-ms',
      'Use a positive number, e.g. --timeout-ms 120000',
    );
    if (timeoutMs !== undefined) body.timeoutMs = timeoutMs;

    const result = await invokeOperation('diagram.open', body);
    output(
      result && typeof result === 'object' && !Array.isArray(result) && 'nodeId' in result && !('id' in result)
        ? { id: (result as { nodeId?: unknown }).nodeId, ...result }
        : result,
    );
  },
);

cmd(
  'diagram add',
  'Create an Excalidraw diagram node',
  [
    'pmx-canvas diagram add --title "Architecture"',
    'pmx-canvas diagram add --title "Architecture" --elements \'[{"type":"rectangle","id":"r1","x":0,"y":0,"width":120,"height":80}]\'',
  ],
  async (args) => {
    const { flags } = parseFlags(args);
    if (flags.help || flags.h) return showCommandHelp('diagram add');
    const externalAppAdd = COMMANDS['external-app add'];
    await externalAppAdd.run([...args, '--kind', 'excalidraw']);
  },
);

// ── batch ────────────────────────────────────────────────────
cmd(
  'batch',
  'Run a batch of canvas operations from JSON',
  [
    'pmx-canvas batch --file ./canvas-ops.json',
    'pmx-canvas batch --json \'[{"op":"node.add","assign":"a","args":{"type":"markdown","title":"A"}}]\'',
    'pmx-canvas batch --json \'[{"op":"graph.add","assign":"g","args":{"graphType":"bar","data":[{"label":"Docs","value":5}],"xKey":"label","yKey":"value"}}]\'',
    'cat ops.json | pmx-canvas batch --stdin',
  ],
  async (args) => {
    const { flags } = parseFlags(args);
    if (flags.help || flags.h) return showCommandHelp('batch');

    let raw = '';
    if (typeof flags.file === 'string') {
      try {
        raw = readFileSync(flags.file, 'utf-8');
      } catch (error) {
        die(
          `Unable to read --file: ${error instanceof Error ? error.message : String(error)}`,
          'Use: pmx-canvas batch --file ./canvas-ops.json',
        );
      }
    } else if (typeof flags.json === 'string') {
      raw = flags.json;
    } else if (flags.stdin) {
      raw = await readStdin();
    } else {
      die('Batch operations require --file, --json, or --stdin.', 'Use: pmx-canvas batch --file ./canvas-ops.json');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      die(
        `Invalid batch JSON: ${error instanceof Error ? error.message : String(error)}`,
        'Use a JSON array of operations or an object with an "operations" array.',
      );
    }

    // A parsed `null` (--json 'null') must become an empty batch — the invoker
    // iterates Object.entries(input), which throws on null. The raw route
    // coerced it to { ok:true, results: [] } server-side; keep that behavior.
    const result = await invokeOperation(
      'canvas.batch',
      Array.isArray(parsed) ? { operations: parsed } : ((parsed ?? { operations: [] }) as Record<string, unknown>),
    );
    output(result);
    // canvas.batch declares errorBodyAsResult, so a failed batch is RETURNED as
    // its full { ok:false, results, refs, failedIndex, error } envelope instead
    // of throwing. Print it (above), then exit 1 — a deliberate change from the
    // old bare stderr die: richer failure output, same non-zero exit.
    if ((result as { ok?: boolean }).ok === false) process.exit(1);
  },
);

// ── web-artifact build ───────────────────────────────────────
cmd(
  'web-artifact build',
  'Build a bundled HTML web artifact and optionally open it on the canvas',
  [
    'pmx-canvas web-artifact build --title "Dashboard" --app-file ./App.tsx',
    'pmx-canvas web-artifact build --title "Dashboard" --app-file ./App.tsx --index-css-file ./index.css',
    'pmx-canvas web-artifact build --title "Dashboard" --app-file ./App.tsx --include-logs',
  ],
  async (args) => {
    const { flags } = parseFlags(args);
    if (flags.help || flags.h) return showCommandHelp('web-artifact build');
    await runWebArtifactBuildCommand(flags);
  },
);
