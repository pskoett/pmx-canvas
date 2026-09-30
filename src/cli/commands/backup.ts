// Library backup commands (plan 012): backup, backup status, backup schedule, restore.

import { resolve } from 'node:path';
import {
  cmd,
  die,
  getStringFlag,
  invokeOperation,
  optionalNumberFlag,
  output,
  parseFlags,
  showCommandHelp,
} from '../shared.js';

function backupArgs(command: string, args: string[], supported: string[]) {
  const parsed = parseFlags(args, { boolFlags: ['off'] });
  const allowed = new Set(['help', 'h', ...supported]);
  const unknown = Object.keys(parsed.flags).find((flag) => !allowed.has(flag));
  if (unknown) die(`Unknown ${command} flag: --${unknown}`, `Run: pmx-canvas ${command} --help`);
  for (const name of ['to', 'keep', 'every']) {
    if (parsed.flags[name] === true) die(`Missing value for --${name}`, `Run: pmx-canvas ${command} --help`);
  }
  return parsed;
}

cmd(
  'backup',
  'Back up every board to a folder (safe while the server runs)',
  ['pmx-canvas backup', 'pmx-canvas backup --to ~/Backups/pmx --keep 14'],
  async (args) => {
    const { flags } = backupArgs('backup', args, ['to', 'keep']);
    if (flags.help || flags.h) return showCommandHelp('backup');
    const to = getStringFlag(flags, 'to');
    const keep = optionalNumberFlag(flags, 'keep', 'pmx-canvas backup --keep <n>');
    output(await invokeOperation('backup.run', { ...(to ? { to: resolve(to) } : {}), ...(keep ? { keep } : {}) }));
  },
);

cmd('backup status', 'Show the backup folder, schedule and backups', ['pmx-canvas backup status'], async (args) => {
  const { flags } = backupArgs('backup status', args, []);
  if (flags.help || flags.h) return showCommandHelp('backup status');
  output(await invokeOperation('backup.status', {}));
});

cmd(
  'backup schedule',
  'Back up on a schedule, run by the server',
  ['pmx-canvas backup schedule --every 24h --keep 14 --to ~/Backups/pmx', 'pmx-canvas backup schedule --off'],
  async (args) => {
    const { flags } = backupArgs('backup schedule', args, ['every', 'off', 'to', 'keep']);
    if (flags.help || flags.h) return showCommandHelp('backup schedule');
    const every = flags.off ? 'off' : getStringFlag(flags, 'every');
    if (!every) die('Usage: pmx-canvas backup schedule --every <30m|24h|7d> [--keep <n>] [--to <folder>] | --off');
    const to = getStringFlag(flags, 'to');
    const keep = optionalNumberFlag(flags, 'keep', 'pmx-canvas backup schedule --keep <n>');
    output(
      await invokeOperation('backup.schedule', {
        every,
        ...(to ? { to: resolve(to) } : {}),
        ...(keep ? { keep } : {}),
      }),
    );
  },
);

cmd(
  'restore',
  'Replace every board with a backup (the current file is kept as canvas.db.before-restore)',
  ['pmx-canvas restore ~/Backups/pmx/canvas-20260927T090000000Z.db'],
  async (args) => {
    const { positional, flags } = backupArgs('restore', args, []);
    if (flags.help || flags.h) return showCommandHelp('restore');
    const file = positional[0];
    if (!file) die('Usage: pmx-canvas restore <backup-file>');
    output(await invokeOperation('backup.restore', { file: resolve(file) }));
  },
);
