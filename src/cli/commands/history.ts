// History commands: undo, redo, history, snapshot save|list|gc|restore|delete,
// snapshot diff, and diff.

import {
  cmd,
  die,
  getStringFlag,
  invokeOperation,
  isRecord,
  optionalNumberFlag,
  output,
  parseFlags,
  requireFlag,
  showCommandHelp,
} from '../shared.js';

function summarizeHistoryResult(result: Record<string, unknown>): Record<string, unknown> {
  const entries = Array.isArray(result.entries) ? result.entries.filter(isRecord) : [];
  const countsByOperation: Record<string, number> = {};
  let currentIndex = 0;

  entries.forEach((entry, index) => {
    const op = typeof entry.operationType === 'string' ? entry.operationType : 'unknown';
    countsByOperation[op] = (countsByOperation[op] ?? 0) + 1;
    if (entry.isCurrent === true) currentIndex = index + 1;
  });

  const recent = entries.slice(-10).map((entry, index) => ({
    index: entries.length - Math.min(entries.length, 10) + index + 1,
    operationType: entry.operationType,
    description: entry.description,
    status: entry.isCurrent === true ? 'current' : entry.isUndone === true ? 'undone' : 'applied',
  }));

  return {
    totalMutations: entries.length,
    currentIndex,
    canUndo: result.canUndo === true,
    canRedo: result.canRedo === true,
    countsByOperation,
    recent,
  };
}

function compactHistoryResult(result: Record<string, unknown>): Record<string, unknown> {
  const entries = Array.isArray(result.entries) ? result.entries.filter(isRecord) : [];
  return {
    totalMutations: entries.length,
    canUndo: result.canUndo === true,
    canRedo: result.canRedo === true,
    entries: entries.slice(-20).map((entry, index) => ({
      index: entries.length - Math.min(entries.length, 20) + index + 1,
      operationType: entry.operationType,
      description: entry.description,
      status: entry.isCurrent === true ? 'current' : entry.isUndone === true ? 'undone' : 'applied',
    })),
  };
}

// ── undo ─────────────────────────────────────────────────────
cmd('undo', 'Undo the last canvas mutation', ['pmx-canvas undo'], async (args) => {
  const { flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('undo');

  const result = await invokeOperation('canvas.undo', {});
  output(result);
});

// ── redo ─────────────────────────────────────────────────────
cmd('redo', 'Redo the last undone mutation', ['pmx-canvas redo'], async (args) => {
  const { flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('redo');

  const result = await invokeOperation('canvas.redo', {});
  output(result);
});

// ── history ──────────────────────────────────────────────────
cmd(
  'history',
  'Show canvas mutation history',
  ['pmx-canvas history', 'pmx-canvas history --summary', 'pmx-canvas history --compact'],
  async (args) => {
    const { flags } = parseFlags(args, { boolFlags: ['summary'] });
    if (flags.help || flags.h) return showCommandHelp('history');

    const result = (await invokeOperation('history.get', {})) as Record<string, unknown>;
    if (flags.summary) {
      output(summarizeHistoryResult(result));
      return;
    }
    if (flags.compact) {
      output(compactHistoryResult(result));
      return;
    }
    output(result);
  },
);

// ── snapshot save ────────────────────────────────────────────
cmd(
  'snapshot save',
  'Save a named snapshot of the current canvas',
  ['pmx-canvas snapshot save --name "before-refactor"', 'pmx-canvas snapshot save --name checkpoint-1'],
  async (args) => {
    const { flags } = parseFlags(args);
    if (flags.help || flags.h) return showCommandHelp('snapshot save');

    const name = requireFlag(flags, 'name', 'pmx-canvas snapshot save --name "my-snapshot"');
    const result = await invokeOperation('snapshot.save', { name });
    output(result);
  },
);

// ── snapshot list ────────────────────────────────────────────
cmd(
  'snapshot list',
  'List saved snapshots',
  [
    'pmx-canvas snapshot list',
    'pmx-canvas snapshot list --limit 50 --query baseline',
    'pmx-canvas snapshot list --after 2026-05-01T00:00:00Z --before 2026-05-05T00:00:00Z',
    'pmx-canvas snapshot list --all',
  ],
  async (args) => {
    const { flags } = parseFlags(args);
    if (flags.help || flags.h) return showCommandHelp('snapshot list');

    const limit = optionalNumberFlag(flags, 'limit', 'Use a positive integer, e.g. --limit 50');
    const query = getStringFlag(flags, 'query', 'q');
    const before = getStringFlag(flags, 'before');
    const after = getStringFlag(flags, 'after');
    const result = await invokeOperation('snapshot.list', {
      ...(limit !== undefined ? { limit } : {}),
      ...(query ? { q: query } : {}),
      ...(before ? { before } : {}),
      ...(after ? { after } : {}),
      ...(flags.all ? { all: true } : {}),
    });
    output(result);
  },
);

// ── snapshot gc ──────────────────────────────────────────────
cmd(
  'snapshot gc',
  'Delete old snapshots, keeping the newest N',
  ['pmx-canvas snapshot gc --keep 20 --dry-run', 'pmx-canvas snapshot gc --keep 50 --yes'],
  async (args) => {
    const { flags } = parseFlags(args);
    if (flags.help || flags.h) return showCommandHelp('snapshot gc');

    const keep = optionalNumberFlag(flags, 'keep', 'Use a positive integer, e.g. --keep 20');
    const dryRun = flags['dry-run'] === true;
    if (!dryRun && !flags.yes) {
      die('Destructive operation requires --yes flag', 'Preview with: pmx-canvas snapshot gc --keep 20 --dry-run');
    }
    const result = await invokeOperation('snapshot.gc', {
      ...(keep !== undefined ? { keep } : {}),
      dryRun,
    });
    output(result);
  },
);

// ── snapshot restore ─────────────────────────────────────────
cmd(
  'snapshot restore',
  'Restore canvas from a snapshot',
  ['pmx-canvas snapshot restore <snapshot-id-or-name>'],
  async (args) => {
    const { positional, flags } = parseFlags(args);
    if (flags.help || flags.h) return showCommandHelp('snapshot restore');

    const id = positional[0];
    if (!id) die('Missing snapshot ID or name', 'pmx-canvas snapshot restore <snapshot-id-or-name>');

    const result = await invokeOperation('snapshot.restore', { id });
    output(result);
  },
);

// ── snapshot delete ──────────────────────────────────────────
cmd('snapshot delete', 'Delete a saved snapshot', ['pmx-canvas snapshot delete <snapshot-id>'], async (args) => {
  const { positional, flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('snapshot delete');

  const id = positional[0];
  if (!id) die('Missing snapshot ID', 'pmx-canvas snapshot delete <snapshot-id>');

  const result = await invokeOperation('snapshot.delete', { id });
  output(result);
});

async function runSnapshotDiff(args: string[]): Promise<void> {
  const { positional } = parseFlags(args);
  const snapshot = positional[0];
  if (!snapshot) die('Missing snapshot ID or name', 'pmx-canvas snapshot diff <snapshot-id-or-name>');
  const result = await invokeOperation('snapshot.diff', { id: snapshot });
  output(result);
}

// ── snapshot diff ────────────────────────────────────────────
cmd(
  'snapshot diff',
  'Compare current canvas against a saved snapshot',
  ['pmx-canvas snapshot diff <snapshot-id>', 'pmx-canvas snapshot diff "before-refactor"'],
  async (args) => {
    const { flags } = parseFlags(args);
    if (flags.help || flags.h) return showCommandHelp('snapshot diff');
    await runSnapshotDiff(args);
  },
);

// ── diff ─────────────────────────────────────────────────────
cmd('diff', 'Compare current canvas against a snapshot', ['pmx-canvas diff <snapshot-id>'], async (args) => {
  const { flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('diff');
  await runSnapshotDiff(args);
});
