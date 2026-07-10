// Query/analysis commands: search, validate, validate spec, code-graph,
// spatial, and watch.

import {
  buildGraphRequestBody,
  buildHtmlPrimitiveRequestBody,
  buildJsonRenderRequestBody,
  cmd,
  die,
  getBaseUrl,
  getStringFlag,
  invokeOperation,
  isRecord,
  optionalNumberFlag,
  output,
  parseFlags,
  showCommandHelp,
} from '../shared.js';
import {
  ALL_SEMANTIC_WATCH_EVENT_TYPES,
  formatCompactWatchEvent,
  parseSemanticEventFilter,
  parseSseStream,
  SemanticWatchReducer,
} from '../watch.js';

// ── search ───────────────────────────────────────────────────
cmd(
  'search',
  'Search nodes by title or content',
  ['pmx-canvas search "design doc"', 'pmx-canvas search --query "TODO"'],
  async (args) => {
    const { positional, flags } = parseFlags(args);
    if (flags.help || flags.h) return showCommandHelp('search');

    const query = positional[0] || (typeof flags.query === 'string' ? flags.query : '');
    if (!query) die('Missing search query', 'pmx-canvas search "query"');

    const result = await invokeOperation('search', { q: query });
    output(result);
  },
);

// ── validate ─────────────────────────────────────────────────
cmd(
  'validate',
  'Validate the current layout for collisions and missing edge endpoints',
  ['pmx-canvas validate'],
  async (args) => {
    const { flags } = parseFlags(args);
    if (flags.help || flags.h) return showCommandHelp('validate');

    const result = await invokeOperation('validate.get', {});
    output(result);
  },
);

cmd(
  'validate spec',
  'Validate a json-render spec or graph payload without creating a node',
  [
    'pmx-canvas validate spec --type json-render --spec-file ./dashboard.json',
    'pmx-canvas validate spec --type graph --graph-type bar --data-file ./metrics.json --x-key label --y-key value',
    'pmx-canvas validate spec --type html-primitive --kind choice-grid --data-file ./options.json',
    'pmx-canvas validate spec --type json-render --spec-file ./dashboard.json --summary',
  ],
  async (args) => {
    const { flags } = parseFlags(args);
    if (flags.help || flags.h) return showCommandHelp('validate spec');

    const type = getStringFlag(flags, 'type');
    if (type !== 'json-render' && type !== 'graph' && type !== 'html-primitive') {
      die('validate spec requires --type json-render, --type graph, or --type html-primitive.');
    }

    let body: Record<string, unknown>;
    if (type === 'json-render') {
      body = {
        type,
        spec: (await buildJsonRenderRequestBody({ ...flags, title: String(flags.title ?? 'Validation') })).spec,
      };
    } else if (type === 'html-primitive') {
      const primitiveBody = await buildHtmlPrimitiveRequestBody(flags);
      body = {
        type,
        kind: primitiveBody.primitive,
        ...(typeof primitiveBody.title === 'string' ? { title: primitiveBody.title } : {}),
        ...(isRecord(primitiveBody.data) ? { data: primitiveBody.data } : {}),
      };
    } else {
      body = { type, ...(await buildGraphRequestBody(flags)) };
    }

    const result = (await invokeOperation('spec.validate', body)) as Record<string, unknown>;
    if (flags.summary) {
      output({
        ok: result.ok,
        type: result.type,
        summary: result.summary,
      });
      return;
    }
    output(result);
  },
);

// ── code-graph ───────────────────────────────────────────────
cmd('code-graph', 'Show auto-detected file dependency graph', ['pmx-canvas code-graph'], async (args) => {
  const { flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('code-graph');

  const result = await invokeOperation('code-graph.get', {});
  output(result);
});

// ── spatial ──────────────────────────────────────────────────
cmd('spatial', 'Spatial analysis: clusters, reading order, neighborhoods', ['pmx-canvas spatial'], async (args) => {
  const { flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('spatial');

  const result = await invokeOperation('spatial.get', {});
  output(result);
});

// ── watch ────────────────────────────────────────────────────
cmd(
  'watch',
  'Watch low-token semantic canvas changes over the existing SSE stream',
  [
    'pmx-canvas watch',
    'pmx-canvas watch --json',
    'pmx-canvas watch --events context-pin,move-end',
    'pmx-canvas watch --json --events connect --max-events 1',
  ],
  async (args) => {
    const { flags } = parseFlags(args);
    if (flags.help || flags.h) return showCommandHelp('watch');

    if (flags.json && flags.compact) {
      die('Use either --json or --compact, not both.');
    }

    const filtersRaw = typeof flags.events === 'string' ? flags.events : undefined;
    const requestedFilters = filtersRaw
      ? Array.from(
          new Set(
            filtersRaw
              .split(',')
              .map((value) => value.trim())
              .filter((value) => value.length > 0),
          ),
        )
      : [];
    const invalidFilter = requestedFilters.find(
      (value) => !ALL_SEMANTIC_WATCH_EVENT_TYPES.includes(value as (typeof ALL_SEMANTIC_WATCH_EVENT_TYPES)[number]),
    );
    if (invalidFilter) {
      die(
        `Invalid value in --events: ${invalidFilter}`,
        'Use a comma-separated subset of: context-pin,move-end,group,connect,remove',
      );
    }
    const filters = parseSemanticEventFilter(filtersRaw);
    if (filtersRaw && filters.size === 0) {
      die(
        `Invalid value for --events: ${filtersRaw}`,
        'Use a comma-separated subset of: context-pin,move-end,group,connect,remove',
      );
    }

    const maxEvents = optionalNumberFlag(flags, 'max-events', 'Use a positive integer, e.g. --max-events 1');
    const jsonMode = Boolean(flags.json);
    const reducer = new SemanticWatchReducer();
    const pinned = (await invokeOperation('pinned-context.get', {})) as { nodeIds?: string[] };
    reducer.setInitialPins(Array.isArray(pinned.nodeIds) ? pinned.nodeIds : []);

    const base = getBaseUrl();
    const controller = new AbortController();
    let response: Response;
    try {
      response = await fetch(`${base}/api/workbench/events`, {
        method: 'GET',
        headers: { Accept: 'text/event-stream' },
        signal: controller.signal,
      });
    } catch (error) {
      die(
        `Cannot connect to pmx-canvas event stream at ${base}: ${error instanceof Error ? error.message : String(error)}`,
        'Start the server first: pmx-canvas --no-open',
      );
    }

    if (!response.ok) {
      const text = await response.text();
      die(`Failed to open event stream: HTTP ${response.status}`, text);
    }
    if (!response.body) {
      die('Workbench event stream did not return a readable body.');
    }

    let emitted = 0;
    try {
      for await (const message of parseSseStream(response.body)) {
        const semanticEvents = reducer.handleMessage(message).filter((event) => filters.has(event.type));

        for (const event of semanticEvents) {
          console.log(jsonMode ? JSON.stringify(event) : formatCompactWatchEvent(event));
          emitted++;
          if (maxEvents !== undefined && emitted >= maxEvents) {
            controller.abort();
            return;
          }
        }
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      die(
        `Watch stream failed: ${error instanceof Error ? error.message : String(error)}`,
        'Ensure the server is still running and reachable.',
      );
    }
  },
);
