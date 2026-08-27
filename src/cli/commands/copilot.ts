// Copilot adapter commands: copilot install-extension.

import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cmd, die, getStringFlag, output, parseFlags, showCommandHelp } from '../shared.js';

// ── copilot install-extension ────────────────────────────────
cmd(
  'copilot install-extension',
  'Install the bundled GitHub Copilot extension adapter',
  [
    'pmx-canvas copilot install-extension --dry-run',
    'pmx-canvas copilot install-extension --target .github/extensions/pmx-canvas/extension.mjs --yes',
  ],
  async (args) => {
    const { flags } = parseFlags(args);
    if (flags.help || flags.h) return showCommandHelp('copilot install-extension');

    const sourcePaths = [
      fileURLToPath(new URL('../../../.github/extensions/pmx-canvas/extension.mjs', import.meta.url)),
      fileURLToPath(new URL('../../../.github/extensions/pmx-canvas/steering-delivery.mjs', import.meta.url)),
    ];
    const missingSource = sourcePaths.find((sourcePath) => !existsSync(sourcePath));
    if (missingSource) {
      die('Bundled Copilot extension adapter not found.', `Expected at ${missingSource}`);
    }

    const targetPath =
      getStringFlag(flags, 'target') ?? join(process.cwd(), '.github', 'extensions', 'pmx-canvas', 'extension.mjs');
    const targetPaths = sourcePaths.map((sourcePath) => join(dirname(targetPath), basename(sourcePath)));
    const dryRun = flags['dry-run'] === true;
    const targetExists = targetPaths.some((candidate) => existsSync(candidate));

    if (dryRun) {
      output({ ok: true, dryRun: true, sourcePath: sourcePaths[0], targetPath, targetExists, wrote: false });
      return;
    }

    if (targetExists && flags.yes !== true) {
      die('Target already exists. Re-run with --yes to overwrite.', `Target: ${targetPath}`);
    }

    mkdirSync(dirname(targetPath), { recursive: true });
    for (let index = 0; index < sourcePaths.length; index += 1) {
      copyFileSync(sourcePaths[index], targetPaths[index]);
    }
    output({ ok: true, dryRun: false, sourcePath: sourcePaths[0], targetPath, wrote: true });
  },
);
