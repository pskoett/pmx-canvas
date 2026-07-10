// Group commands: group create|add|remove.

import {
  cmd,
  die,
  invokeOperation,
  optionalFiniteFlag,
  optionalPositiveFiniteFlag,
  output,
  parseFlags,
  requireFlag,
  showCommandHelp,
} from '../shared.js';

// ── group create ─────────────────────────────────────────────
cmd(
  'group create',
  'Create a group node',
  [
    'pmx-canvas group create --title "API Layer" node1 node2',
    'pmx-canvas group create --title "Quarterly board" --x 40 --y 60 --width 1600 --height 900 --child-layout column node1 node2',
    'pmx-canvas group create --title "Frontend" --color "#ff6b6b"',
  ],
  async (args) => {
    const { positional, flags } = parseFlags(args);
    if (flags.help || flags.h) return showCommandHelp('group create');

    const body: Record<string, unknown> = {};
    if (flags.title && flags.title !== true) body.title = flags.title;
    if (flags.color && flags.color !== true) body.color = flags.color;
    const x = optionalFiniteFlag(flags, 'x', 'Use a finite number, e.g. --x 40');
    const y = optionalFiniteFlag(flags, 'y', 'Use a finite number, e.g. --y 60');
    const width = optionalPositiveFiniteFlag(flags, 'width', 'Use a positive number, e.g. --width 1600');
    const height = optionalPositiveFiniteFlag(flags, 'height', 'Use a positive number, e.g. --height 900');
    if (x !== undefined) body.x = x;
    if (y !== undefined) body.y = y;
    if (width !== undefined) body.width = width;
    if (height !== undefined) body.height = height;
    if (typeof flags['child-layout'] === 'string') body.childLayout = flags['child-layout'];
    if (positional.length > 0) body.childIds = positional;

    const result = await invokeOperation('group.create', body);
    output(result);
  },
);

// ── group add ────────────────────────────────────────────────
cmd(
  'group add',
  'Add nodes to an existing group',
  [
    'pmx-canvas group add --group <group-id> node1 node2',
    'pmx-canvas group add --group <group-id> --child-layout flow node1 node2',
  ],
  async (args) => {
    const { positional, flags } = parseFlags(args);
    if (flags.help || flags.h) return showCommandHelp('group add');

    const groupId = requireFlag(flags, 'group', 'pmx-canvas group add --group <group-id> node1 node2');
    if (positional.length === 0) die('No node IDs provided', 'pmx-canvas group add --group <group-id> node1 node2');

    const result = await invokeOperation('group.add', {
      groupId,
      childIds: positional,
      ...(typeof flags['child-layout'] === 'string' ? { childLayout: flags['child-layout'] } : {}),
    });
    output(result);
  },
);

// ── group remove ─────────────────────────────────────────────
cmd('group remove', 'Ungroup all children from a group', ['pmx-canvas group remove <group-id>'], async (args) => {
  const { positional, flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('group remove');

  const id = positional[0];
  if (!id) die('Missing group ID', 'pmx-canvas group remove <group-id>');

  const result = await invokeOperation('group.remove', { groupId: id });
  output(result);
});
