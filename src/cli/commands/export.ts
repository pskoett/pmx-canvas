// Static board export (plan 013): export.

import { copyFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cmd, getStringFlag, invokeOperation, output, parseFlags, showCommandHelp } from '../shared.js';

cmd(
  'export',
  'Export a board as one self-contained HTML file anyone can open',
  [
    'pmx-canvas export',
    'pmx-canvas export --board board-abc123 --out ~/Desktop/okrs.html',
    'pmx-canvas export --include-files',
  ],
  async (args) => {
    const { flags } = parseFlags(args);
    if (flags.help || flags.h) return showCommandHelp('export');
    const board = getStringFlag(flags, 'board');
    const out = getStringFlag(flags, 'out');
    const result = (await invokeOperation('export.run', {
      ...(board ? { board } : {}),
      includeFiles: flags['include-files'] === true,
    })) as { path: string };
    if (out) {
      copyFileSync(result.path, resolve(out));
      result.path = resolve(out);
    }
    output(result);
  },
);
