// Board commands (plan 012): board list, board create, board rename.
// Opening, switching and deleting boards is the human's, in the workbench.

import { cmd, die, invokeOperation, output, parseFlags, showCommandHelp } from '../shared.js';

cmd('board list', 'List boards, most recently opened first', ['pmx-canvas board list'], async (args) => {
  const { flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('board list');
  output(await invokeOperation('board.list', {}));
});

cmd(
  'board create',
  'Create an empty board (the human opens it in the workbench)',
  ['pmx-canvas board create "Q4 planning"'],
  async (args) => {
    const { positional, flags } = parseFlags(args);
    if (flags.help || flags.h) return showCommandHelp('board create');
    const name = positional.join(' ').trim();
    if (!name) die('Usage: pmx-canvas board create <name>');
    output(await invokeOperation('board.create', { name }));
  },
);

cmd('board rename', 'Rename a board', ['pmx-canvas board rename board-abc123 "Q4 planning"'], async (args) => {
  const { positional, flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('board rename');
  const [id, ...rest] = positional;
  const name = rest.join(' ').trim();
  if (!id || !name) die('Usage: pmx-canvas board rename <board-id> <name>');
  output(await invokeOperation('board.rename', { id, name }));
});
