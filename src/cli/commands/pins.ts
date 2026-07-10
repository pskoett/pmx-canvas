// Context pin commands: pin.

import { cmd, invokeOperation, output, parseFlags, showCommandHelp } from '../shared.js';

// ── pin ──────────────────────────────────────────────────────
cmd(
  'pin',
  'Manage context pins',
  [
    'pmx-canvas pin node1 node2 node3',
    'pmx-canvas pin --set node1 node2 node3',
    'pmx-canvas pin --list',
    'pmx-canvas pin --clear',
  ],
  async (args) => {
    const { positional, flags } = parseFlags(args);
    if (flags.help || flags.h) return showCommandHelp('pin');

    if (flags.list) {
      const result = await invokeOperation('pinned-context.get', {});
      output(result);
      return;
    }

    if (flags.clear) {
      const result = await invokeOperation('pin.set', { nodeIds: [] });
      output(result);
      return;
    }

    // --set: positional args are node IDs
    if (positional.length > 0 || flags.set) {
      const result = await invokeOperation('pin.set', { nodeIds: positional });
      output(result);
      return;
    }

    // Default: list
    const result = await invokeOperation('pinned-context.get', {});
    output(result);
  },
);
