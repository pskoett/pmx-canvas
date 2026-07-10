// Copilot adapter commands: copilot install-extension.

import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
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

    const sourcePath = fileURLToPath(new URL('../../../.github/extensions/pmx-canvas/extension.mjs', import.meta.url));
    if (!existsSync(sourcePath)) {
      die('Bundled Copilot extension adapter not found.', `Expected at ${sourcePath}`);
    }

    const targetPath =
      getStringFlag(flags, 'target') ?? join(process.cwd(), '.github', 'extensions', 'pmx-canvas', 'extension.mjs');
    const dryRun = flags['dry-run'] === true;
    const targetExists = existsSync(targetPath);

    if (dryRun) {
      output({ ok: true, dryRun: true, sourcePath, targetPath, targetExists, wrote: false });
      return;
    }

    if (targetExists && flags.yes !== true) {
      die('Target already exists. Re-run with --yes to overwrite.', `Target: ${targetPath}`);
    }

    mkdirSync(dirname(targetPath), { recursive: true });
    copyFileSync(sourcePath, targetPath);
    output({ ok: true, dryRun: false, sourcePath, targetPath, wrote: true });
  },
);
