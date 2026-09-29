// Static board export (plan 013): export.

import { copyFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cmd, die, getStringFlag, invokeOperation, output, parseFlags, showCommandHelp } from '../shared.js';

cmd(
  'export',
  'Export a board as one self-contained HTML file anyone can open',
  [
    'pmx-canvas export',
    'pmx-canvas export --board board-abc123 --out ~/Desktop/okrs.html',
    'pmx-canvas export --include-files',
    'pmx-canvas export --include-derived-text',
  ],
  async (args) => {
    const { flags } = parseFlags(args, { boolFlags: ['include-files', 'include-derived-text'] });
    const supportedFlags = new Set(['help', 'h', 'board', 'out', 'include-files', 'include-derived-text']);
    const unknownFlag = Object.keys(flags).find((flag) => !supportedFlags.has(flag));
    if (unknownFlag) {
      die(`Unknown export flag: --${unknownFlag}`, 'Run: pmx-canvas export --help');
    }
    if (flags.help || flags.h) return showCommandHelp('export');
    const board = getStringFlag(flags, 'board');
    const out = getStringFlag(flags, 'out');
    const result = (await invokeOperation('export.run', {
      ...(board ? { board } : {}),
      includeFiles: flags['include-files'] === true,
      includeDerivedText: flags['include-derived-text'] === true,
    })) as { path: string };
    if (out) {
      copyFileSync(result.path, resolve(out));
      result.path = resolve(out);
    }
    output(result);
  },
);
