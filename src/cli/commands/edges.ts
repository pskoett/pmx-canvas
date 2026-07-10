// Edge commands: edge add|list|remove.

import { cmd, die, invokeOperation, output, parseFlags, showCommandHelp } from '../shared.js';

// ── edge add ─────────────────────────────────────────────────
cmd(
  'edge add',
  'Add an edge between two nodes',
  [
    'pmx-canvas edge add --from <node-id> --to <node-id> --type flow',
    'pmx-canvas edge add --from-search "DVT O3 — GitOps" --to-search "deep work trend" --type relation',
    'pmx-canvas edge add --from n1 --to n2 --type depends-on --label "imports"',
    'pmx-canvas edge add --from n1 --to n2 --type references --style dashed --animated',
  ],
  async (args) => {
    const { flags } = parseFlags(args);
    if (flags.help || flags.h) return showCommandHelp('edge add');

    const type = (flags.type as string) || 'flow';
    const from = typeof flags.from === 'string' ? flags.from : undefined;
    const to = typeof flags.to === 'string' ? flags.to : undefined;
    const fromSearch = typeof flags['from-search'] === 'string' ? flags['from-search'] : undefined;
    const toSearch = typeof flags['to-search'] === 'string' ? flags['to-search'] : undefined;

    if (!from && !fromSearch) {
      die(
        'Missing source selector',
        'Use --from <id> or --from-search "query". Search queries must resolve to exactly one node. Example: pmx-canvas edge add --from-search "DVT O3 — GitOps" --to-search "deep work trend" --type relation',
      );
    }
    if (!to && !toSearch) {
      die(
        'Missing target selector',
        'Use --to <id> or --to-search "query". Search queries must resolve to exactly one node. Example: pmx-canvas edge add --from-search "DVT O3 — GitOps" --to-search "deep work trend" --type relation',
      );
    }

    const body: Record<string, unknown> = {
      type,
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
      ...(fromSearch ? { fromSearch } : {}),
      ...(toSearch ? { toSearch } : {}),
    };
    if (flags.label && flags.label !== true) body.label = flags.label;
    if (typeof flags.style === 'string') body.style = flags.style;
    if (flags.animated) body.animated = true;

    const result = await invokeOperation('edge.add', body);
    output(result);
  },
);

// ── edge list ────────────────────────────────────────────────
cmd('edge list', 'List all edges on the canvas', ['pmx-canvas edge list'], async (args) => {
  const { flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('edge list');

  const layout = (await invokeOperation('layout.get', {})) as { edges: unknown[] };
  output(layout.edges);
});

// ── edge remove ──────────────────────────────────────────────
cmd('edge remove', 'Remove an edge by ID', ['pmx-canvas edge remove <edge-id>'], async (args) => {
  const { positional, flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('edge remove');

  const id = positional[0];
  if (!id) die('Missing edge ID', 'pmx-canvas edge remove <edge-id>');

  const result = await invokeOperation('edge.remove', { edge_id: id });
  output(result);
});
