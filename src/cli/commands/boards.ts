// Board commands. Opening changes the shared workbench; deletion remains human-only.

import { cmd, die, getStringFlag, invokeOperation, output, parseFlags, showCommandHelp } from '../shared.js';

cmd(
  'board knowledge',
  'Workspace knowledge actions with a JSON payload',
  [
    'pmx-canvas board knowledge list',
    'pmx-canvas board knowledge folder-set \'{"path":"A","categoryId":null,"lifecycleOverride":null}\'',
  ],
  async (args) => {
    const [action, payload = '{}'] = args;
    if (!['list', 'category-set', 'folder-set'].includes(action ?? ''))
      die('Expected list, category-set or folder-set.');
    output(await invokeOperation(`knowledge.${action}`, JSON.parse(payload)));
  },
);

cmd(
  'board lifecycle',
  'Card lifecycle and audited reviews with a JSON payload',
  ['pmx-canvas board lifecycle get \'{"id":"card"}\''],
  async (args) => {
    const [action, payload = '{}'] = args;
    if (!['get', 'set', 'review', 'restore'].includes(action ?? '')) die('Expected get, set, review or restore.');
    output(
      await invokeOperation(action === 'review' ? 'node.review' : `node.lifecycle-${action}`, JSON.parse(payload)),
    );
  },
);

cmd('board list', 'List boards, most recently opened first', ['pmx-canvas board list'], async (args) => {
  const { flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('board list');
  output(await invokeOperation('board.list', {}));
});

cmd(
  'board open',
  'Open a board in the shared workbench, or return Home with --home',
  ['pmx-canvas board open <board-id>', 'pmx-canvas board open --home'],
  async (args) => {
    const { positional, flags } = parseFlags(args, { boolFlags: ['home'] });
    if (flags.help || flags.h) return showCommandHelp('board open');
    if (positional.length > 1 || (flags.home ? positional.length !== 0 : !positional[0])) {
      die('Usage: pmx-canvas board open <board-id> | --home');
    }
    output(await invokeOperation('board.open', { id: flags.home ? null : positional[0] }));
  },
);

cmd(
  'board from',
  'Preview or create a board from selected cards on another board',
  ['pmx-canvas board from <source-id> "Follow-up" --nodes id1,id2 --readme --structure'],
  async (args) => {
    const { positional, flags } = parseFlags(args, { boolFlags: ['preview', 'readme', 'structure'] });
    if (flags.help || flags.h) return showCommandHelp('board from');
    const [sourceBoardId, ...nameParts] = positional;
    const name = nameParts.join(' ').trim() || 'New board';
    if (!sourceBoardId) die('Usage: pmx-canvas board from <source-board-id> <name>');
    const nodes = getStringFlag(flags, 'nodes');
    output(
      await invokeOperation('board.create-from', {
        sourceBoardId,
        name,
        ...(nodes ? { nodeIds: nodes.split(',').filter(Boolean) } : {}),
        includeReadme: !!flags.readme,
        includeStructure: !!flags.structure,
        preview: !!flags.preview,
      }),
    );
  },
);

cmd(
  'board create',
  'Create an empty board (use board open with its returned id before writing)',
  ['pmx-canvas board create "Q4 planning"', 'pmx-canvas board create "Q4 planning" --folder Planning'],
  async (args) => {
    const { positional, flags } = parseFlags(args);
    if (flags.help || flags.h) return showCommandHelp('board create');
    const name = positional.join(' ').trim();
    if (!name) die('Usage: pmx-canvas board create <name> [--folder <folder>]');
    const folder = getStringFlag(flags, 'folder');
    output(await invokeOperation('board.create', { name, ...(folder ? { folder } : {}) }));
  },
);

cmd(
  'board pin',
  "Pin a board into the agent's working set (its README and pinned cards reach every brief)",
  ['pmx-canvas board pin board-abc123', 'pmx-canvas board pin board-abc123 --reason "Q4 rests on it"'],
  async (args) => {
    const { positional, flags } = parseFlags(args);
    if (flags.help || flags.h) return showCommandHelp('board pin');
    const [id] = positional;
    if (!id || positional.length > 1) die('Usage: pmx-canvas board pin <board-id> [--reason <why>]');
    const reason = getStringFlag(flags, 'reason');
    output(await invokeOperation('board.pin', { id, ...(reason ? { reason } : {}) }));
  },
);

cmd(
  'board unpin',
  "Remove a board from the agent's working set",
  ['pmx-canvas board unpin board-abc123'],
  async (args) => {
    const { positional, flags } = parseFlags(args);
    if (flags.help || flags.h) return showCommandHelp('board unpin');
    const [id] = positional;
    if (!id || positional.length > 1) die('Usage: pmx-canvas board unpin <board-id>');
    output(await invokeOperation('board.unpin', { id }));
  },
);

cmd('board rename', 'Rename a board', ['pmx-canvas board rename board-abc123 "Q4 planning"'], async (args) => {
  const { positional, flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('board rename');
  const [id, ...rest] = positional;
  const name = rest.join(' ').trim();
  if (!id || !name) die('Usage: pmx-canvas board rename <board-id> <name>');
  output(await invokeOperation('board.update', { id, name }));
});

cmd(
  'board folder',
  'File a board under a folder on Home (--clear removes it)',
  ['pmx-canvas board folder board-abc123 "Planning"', 'pmx-canvas board folder board-abc123 --clear'],
  async (args) => {
    const { positional, flags } = parseFlags(args);
    if (flags.help || flags.h) return showCommandHelp('board folder');
    const [id, ...rest] = positional;
    const folder = flags.clear ? '' : rest.join(' ').trim();
    if (!id || (!folder && !flags.clear)) die('Usage: pmx-canvas board folder <board-id> <folder> | --clear');
    output(await invokeOperation('board.update', { id, folder }));
  },
);
