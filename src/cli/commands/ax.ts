// AX commands: every 'ax *' command (status, context, focus, event, steer,
// interaction, delivery, elicitation, mode, command, policy, timeline, work,
// approval, evidence, review, host).

import {
  cmd,
  die,
  getStringFlag,
  invokeOperation,
  optionalNumberFlag,
  output,
  parseFlags,
  requireFlag,
  resolveAxSource,
  showCommandHelp,
} from '../shared.js';

// ── AX ────────────────────────────────────────────────────────
cmd('ax status', 'Read host-agnostic PMX AX state', ['pmx-canvas ax status'], async (args) => {
  const { flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('ax status');

  output(await invokeOperation('ax.get', {}));
});

cmd('ax context', 'Read agent-ready PMX AX context', ['pmx-canvas ax context'], async (args) => {
  const { flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('ax context');

  output(await invokeOperation('ax.context.get', {}));
});

cmd(
  'ax focus',
  'Set or clear PMX AX focus without moving the viewport',
  ['pmx-canvas ax focus node1 node2', 'pmx-canvas ax focus --clear'],
  async (args) => {
    const { positional, flags } = parseFlags(args);
    if (flags.help || flags.h) return showCommandHelp('ax focus');

    const nodeIds = flags.clear ? [] : positional;
    if (!flags.clear && nodeIds.length === 0) {
      die('Missing node ID', 'pmx-canvas ax focus <node-id> [more-node-ids]');
    }

    output(await invokeOperation('ax.focus.set', { nodeIds, source: resolveAxSource(flags) }));
  },
);

cmd(
  'ax event add',
  'Record a normalized AX timeline event',
  [
    'pmx-canvas ax event add --kind tool-start --summary "ran tests"',
    'pmx-canvas ax event add --kind failure --summary "build broke" --detail "..." node1 node2',
    'pmx-canvas ax event add --kind tool-start --summary "ran tests" --agent-id builder-1',
  ],
  async (args) => {
    const { positional, flags } = parseFlags(args);
    if (flags.help || flags.h) return showCommandHelp('ax event add');

    const kind = requireFlag(flags, 'kind', 'pmx-canvas ax event add --kind <kind> --summary <text>');
    const summary = requireFlag(flags, 'summary', 'pmx-canvas ax event add --kind <kind> --summary <text>');
    const detail = getStringFlag(flags, 'detail');
    const agentId = getStringFlag(flags, 'agent-id');

    output(
      await invokeOperation('ax.event.record', {
        kind,
        summary,
        ...(detail ? { detail } : {}),
        ...(agentId ? { agentId } : {}),
        ...(positional.length > 0 ? { nodeIds: positional } : {}),
        source: resolveAxSource(flags),
      }),
    );
  },
);

cmd(
  'ax steer',
  'Send a steering message to the active agent session',
  [
    'pmx-canvas ax steer "focus on the failing test first"',
    'pmx-canvas ax steer --message "stop and re-plan"',
    'pmx-canvas ax steer "wave 2 is unblocked" --agent-id orchestrator --target builder-1',
  ],
  async (args) => {
    const { positional, flags } = parseFlags(args);
    if (flags.help || flags.h) return showCommandHelp('ax steer');

    const message = getStringFlag(flags, 'message') ?? positional.join(' ').trim();
    if (!message) {
      die('Missing steering message', 'pmx-canvas ax steer <message>');
    }
    const agentId = getStringFlag(flags, 'agent-id');
    const target = getStringFlag(flags, 'target');

    output(
      await invokeOperation('ax.steer', {
        message,
        ...(agentId ? { agentId } : {}),
        ...(target ? { target } : {}),
        source: resolveAxSource(flags),
      }),
    );
  },
);

cmd(
  'ax interaction',
  'Submit a node-originated AX interaction (capability-gated)',
  [
    'pmx-canvas ax interaction --type ax.work.create --node node-1 --payload \'{"title":"Wire auth"}\'',
    'pmx-canvas ax interaction --type ax.focus.set --node node-2',
  ],
  async (args) => {
    const { flags } = parseFlags(args);
    if (flags.help || flags.h) return showCommandHelp('ax interaction');

    const type = getStringFlag(flags, 'type');
    if (!type) die('Missing --type', 'pmx-canvas ax interaction --type <ax.*> --node <id> [--payload <json>]');
    const sourceNodeId = getStringFlag(flags, 'node');
    if (!sourceNodeId) die('Missing --node', 'pmx-canvas ax interaction --type <ax.*> --node <id>');

    let payload: unknown;
    const payloadRaw = getStringFlag(flags, 'payload');
    if (payloadRaw) {
      try {
        payload = JSON.parse(payloadRaw);
      } catch {
        die('Invalid --payload JSON', 'pmx-canvas ax interaction --payload \'{"title":"..."}\'');
      }
    }

    output(
      await invokeOperation('ax.interaction.submit', {
        type,
        sourceNodeId,
        ...(payload !== undefined ? { payload } : {}),
        source: resolveAxSource(flags),
      }),
    );
  },
);

cmd(
  'ax delivery list',
  'List pending AX steering for a consumer (loop-safe)',
  [
    'pmx-canvas ax delivery list',
    'pmx-canvas ax delivery list --consumer copilot --limit 20',
    'pmx-canvas ax delivery list --order newest   # latest browser steering first (#68)',
  ],
  async (args) => {
    const { flags } = parseFlags(args);
    if (flags.help || flags.h) return showCommandHelp('ax delivery list');
    const consumer = getStringFlag(flags, 'consumer');
    const limit = optionalNumberFlag(flags, 'limit', 'pmx-canvas ax delivery list --limit <n>');
    const order = getStringFlag(flags, 'order');
    if (order !== undefined && order !== 'newest' && order !== 'oldest') {
      die('Invalid --order', 'pmx-canvas ax delivery list --order newest|oldest');
    }
    output(await invokeOperation('ax.delivery.pending', { consumer, limit, order }));
  },
);

cmd(
  'ax delivery mark',
  'Mark an AX steering message as delivered',
  ['pmx-canvas ax delivery mark <steering-id>'],
  async (args) => {
    const { positional, flags } = parseFlags(args);
    if (flags.help || flags.h) return showCommandHelp('ax delivery mark');
    const id = getStringFlag(flags, 'id') ?? positional[0];
    if (!id) die('Missing steering id', 'pmx-canvas ax delivery mark <steering-id>');
    output(await invokeOperation('ax.delivery.mark', { id }));
  },
);

cmd(
  'ax elicitation request',
  'Request structured human input',
  [
    'pmx-canvas ax elicitation request --prompt "Who owns this migration?"',
    'pmx-canvas ax elicitation request --prompt "Pick a region" --fields region,owner',
  ],
  async (args) => {
    const { flags } = parseFlags(args);
    if (flags.help || flags.h) return showCommandHelp('ax elicitation request');
    const prompt = requireFlag(flags, 'prompt', 'pmx-canvas ax elicitation request --prompt <text>');
    const fields = getStringFlag(flags, 'fields');
    output(
      await invokeOperation('ax.elicitation.request', {
        prompt,
        ...(fields
          ? {
              fields: fields
                .split(',')
                .map((f) => f.trim())
                .filter(Boolean),
            }
          : {}),
        source: resolveAxSource(flags),
      }),
    );
  },
);

cmd(
  'ax elicitation respond',
  'Answer a pending elicitation',
  ['pmx-canvas ax elicitation respond <id> --response \'{"owner":"alice"}\''],
  async (args) => {
    const { positional, flags } = parseFlags(args);
    if (flags.help || flags.h) return showCommandHelp('ax elicitation respond');
    const id = getStringFlag(flags, 'id') ?? positional[0];
    if (!id) die('Missing elicitation id', 'pmx-canvas ax elicitation respond <id> --response <json>');
    let response: unknown = {};
    const raw = getStringFlag(flags, 'response');
    if (raw) {
      try {
        response = JSON.parse(raw);
      } catch {
        die('Invalid --response JSON', '--response \'{"k":"v"}\'');
      }
    }
    output(
      await invokeOperation('ax.elicitation.respond', {
        id,
        response,
        source: resolveAxSource(flags),
      }),
    );
  },
);

cmd('ax elicitation list', 'List elicitations', ['pmx-canvas ax elicitation list'], async (args) => {
  const { flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('ax elicitation list');
  output(await invokeOperation('ax.elicitation.list', {}));
});

cmd(
  'ax mode request',
  'Request a workflow mode transition (plan/execute/autonomous)',
  ['pmx-canvas ax mode request --mode execute --reason "plan approved"'],
  async (args) => {
    const { flags } = parseFlags(args);
    if (flags.help || flags.h) return showCommandHelp('ax mode request');
    const mode = requireFlag(flags, 'mode', 'pmx-canvas ax mode request --mode plan|execute|autonomous');
    const reason = getStringFlag(flags, 'reason');
    output(
      await invokeOperation('ax.mode.request', {
        mode,
        ...(reason ? { reason } : {}),
        source: resolveAxSource(flags),
      }),
    );
  },
);

cmd(
  'ax mode resolve',
  'Resolve a pending mode request',
  ['pmx-canvas ax mode resolve <id> --decision approved'],
  async (args) => {
    const { positional, flags } = parseFlags(args);
    if (flags.help || flags.h) return showCommandHelp('ax mode resolve');
    const id = getStringFlag(flags, 'id') ?? positional[0];
    if (!id) die('Missing mode request id', 'pmx-canvas ax mode resolve <id> --decision approved|rejected');
    const decision = getStringFlag(flags, 'decision');
    if (decision !== 'approved' && decision !== 'rejected') die('Invalid --decision', '--decision approved|rejected');
    const resolution = getStringFlag(flags, 'resolution');
    output(
      await invokeOperation('ax.mode.resolve', {
        id,
        decision,
        ...(resolution ? { resolution } : {}),
        source: resolveAxSource(flags),
      }),
    );
  },
);

cmd('ax mode list', 'List mode requests', ['pmx-canvas ax mode list'], async (args) => {
  const { flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('ax mode list');
  output(await invokeOperation('ax.mode.list', {}));
});

cmd('ax command list', 'List the PMX command registry', ['pmx-canvas ax command list'], async (args) => {
  const { flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('ax command list');
  output(await invokeOperation('ax.command.list', {}));
});

cmd(
  'ax command invoke',
  'Invoke a registry-gated PMX command intent',
  [
    'pmx-canvas ax command invoke pmx.plan',
    'pmx-canvas ax command invoke pmx.promote-context --args \'{"nodeIds":["n1"]}\'',
  ],
  async (args) => {
    const { positional, flags } = parseFlags(args);
    if (flags.help || flags.h) return showCommandHelp('ax command invoke');
    const name = getStringFlag(flags, 'name') ?? positional[0];
    if (!name) die('Missing command name', 'pmx-canvas ax command invoke <name>');
    let cmdArgs: unknown;
    const raw = getStringFlag(flags, 'args');
    if (raw) {
      try {
        cmdArgs = JSON.parse(raw);
      } catch {
        die('Invalid --args JSON', '--args \'{"k":"v"}\'');
      }
    }
    output(
      await invokeOperation('ax.command.invoke', {
        name,
        ...(cmdArgs !== undefined ? { args: cmdArgs } : {}),
        source: resolveAxSource(flags),
      }),
    );
  },
);

cmd('ax policy get', 'Show the current declarative AX policy', ['pmx-canvas ax policy get'], async (args) => {
  const { flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('ax policy get');
  output(await invokeOperation('ax.policy.get', {}));
});

cmd(
  'ax policy set',
  'Set the declarative AX policy (stored by PMX, enforced by adapters)',
  ['pmx-canvas ax policy set --excluded-tools shell,write --mode concise'],
  async (args) => {
    const { flags } = parseFlags(args);
    if (flags.help || flags.h) return showCommandHelp('ax policy set');
    const csv = (v?: string) =>
      v
        ? v
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : undefined;
    const allowed = csv(getStringFlag(flags, 'allowed-tools'));
    const excluded = csv(getStringFlag(flags, 'excluded-tools'));
    const approvalRequired = csv(getStringFlag(flags, 'approval-tools'));
    const mode = getStringFlag(flags, 'mode');
    const systemAppend = getStringFlag(flags, 'system-append');
    const tools =
      allowed || excluded || approvalRequired
        ? {
            ...(allowed ? { allowed } : {}),
            ...(excluded ? { excluded } : {}),
            ...(approvalRequired ? { approvalRequired } : {}),
          }
        : undefined;
    const prompt =
      mode || systemAppend ? { ...(mode ? { mode } : {}), ...(systemAppend ? { systemAppend } : {}) } : undefined;
    output(
      await invokeOperation('ax.policy.set', {
        ...(tools ? { tools } : {}),
        ...(prompt ? { prompt } : {}),
        source: resolveAxSource(flags),
      }),
    );
  },
);

cmd(
  'ax timeline',
  'Read the bounded AX timeline (events, evidence, steering)',
  ['pmx-canvas ax timeline', 'pmx-canvas ax timeline --limit 100'],
  async (args) => {
    const { flags } = parseFlags(args);
    if (flags.help || flags.h) return showCommandHelp('ax timeline');

    const limit = optionalNumberFlag(flags, 'limit', 'pmx-canvas ax timeline --limit <n>');
    output(await invokeOperation('ax.timeline.get', limit ? { limit } : {}));
  },
);

cmd(
  'ax work add',
  'Add a canvas-bound AX work item',
  [
    'pmx-canvas ax work add --title "Wire up auth" --status in-progress',
    'pmx-canvas ax work add --title "Review API" node1 node2',
    'pmx-canvas ax work add --title "Wire up auth" --agent-id builder-1',
  ],
  async (args) => {
    const { positional, flags } = parseFlags(args);
    if (flags.help || flags.h) return showCommandHelp('ax work add');

    const title = requireFlag(flags, 'title', 'pmx-canvas ax work add --title <text>');
    const status = getStringFlag(flags, 'status');
    const detail = getStringFlag(flags, 'detail');
    const agentId = getStringFlag(flags, 'agent-id');

    output(
      await invokeOperation('ax.work.create', {
        title,
        ...(status ? { status } : {}),
        ...(detail ? { detail } : {}),
        ...(agentId ? { agentId } : {}),
        ...(positional.length > 0 ? { nodeIds: positional } : {}),
        source: resolveAxSource(flags),
      }),
    );
  },
);

cmd(
  'ax work update',
  'Update a canvas-bound AX work item by ID',
  [
    'pmx-canvas ax work update <id> --status done',
    'pmx-canvas ax work update <id> --title "New title" --detail "..."',
    'pmx-canvas ax work update <id> --agent-id builder-2',
  ],
  async (args) => {
    const { positional, flags } = parseFlags(args);
    if (flags.help || flags.h) return showCommandHelp('ax work update');

    const id = positional[0];
    if (!id) die('Missing work item ID', 'pmx-canvas ax work update <id> --status <status>');
    const title = getStringFlag(flags, 'title');
    const status = getStringFlag(flags, 'status');
    const detail = getStringFlag(flags, 'detail');
    const agentId = getStringFlag(flags, 'agent-id');

    output(
      await invokeOperation('ax.work.update', {
        id,
        ...(title ? { title } : {}),
        ...(status ? { status } : {}),
        ...(detail ? { detail } : {}),
        ...(agentId ? { agentId } : {}),
        ...(positional.length > 1 ? { nodeIds: positional.slice(1) } : {}),
        source: resolveAxSource(flags),
      }),
    );
  },
);

cmd('ax work list', 'List canvas-bound AX work items', ['pmx-canvas ax work list'], async (args) => {
  const { flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('ax work list');

  output(await invokeOperation('ax.work.list', {}));
});

cmd(
  'ax approval request',
  'Request a canvas-bound AX approval gate',
  [
    'pmx-canvas ax approval request --title "Deploy to prod"',
    'pmx-canvas ax approval request --title "Drop table" --action db.drop node1',
  ],
  async (args) => {
    const { positional, flags } = parseFlags(args);
    if (flags.help || flags.h) return showCommandHelp('ax approval request');

    const title = requireFlag(flags, 'title', 'pmx-canvas ax approval request --title <text>');
    const detail = getStringFlag(flags, 'detail');
    const action = getStringFlag(flags, 'action');

    output(
      await invokeOperation('ax.approval.request', {
        title,
        ...(detail ? { detail } : {}),
        ...(action ? { action } : {}),
        ...(positional.length > 0 ? { nodeIds: positional } : {}),
        source: resolveAxSource(flags),
      }),
    );
  },
);

cmd(
  'ax approval resolve',
  'Resolve a pending AX approval gate by ID',
  [
    'pmx-canvas ax approval resolve <id> --decision approved',
    'pmx-canvas ax approval resolve <id> --decision rejected --resolution "too risky"',
  ],
  async (args) => {
    const { positional, flags } = parseFlags(args);
    if (flags.help || flags.h) return showCommandHelp('ax approval resolve');

    const id = positional[0];
    if (!id) die('Missing approval gate ID', 'pmx-canvas ax approval resolve <id> --decision <approved|rejected>');
    const decision = requireFlag(
      flags,
      'decision',
      'pmx-canvas ax approval resolve <id> --decision <approved|rejected>',
    );
    if (decision !== 'approved' && decision !== 'rejected') {
      die('Invalid decision', 'pmx-canvas ax approval resolve <id> --decision <approved|rejected>');
    }
    const resolution = getStringFlag(flags, 'resolution');

    output(
      await invokeOperation('ax.approval.resolve', {
        id,
        decision,
        ...(resolution ? { resolution } : {}),
        source: resolveAxSource(flags),
      }),
    );
  },
);

cmd('ax approval list', 'List canvas-bound AX approval gates', ['pmx-canvas ax approval list'], async (args) => {
  const { flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('ax approval list');

  output(await invokeOperation('ax.approval.list', {}));
});

cmd(
  'ax evidence add',
  'Record an AX evidence item on the timeline',
  [
    'pmx-canvas ax evidence add --kind test-output --title "unit pass" --body "..."',
    'pmx-canvas ax evidence add --kind screenshot --title "before" --ref /tmp/before.png node1',
  ],
  async (args) => {
    const { positional, flags } = parseFlags(args);
    if (flags.help || flags.h) return showCommandHelp('ax evidence add');

    const kind = requireFlag(flags, 'kind', 'pmx-canvas ax evidence add --kind <kind> --title <text>');
    const title = requireFlag(flags, 'title', 'pmx-canvas ax evidence add --kind <kind> --title <text>');
    const body = getStringFlag(flags, 'body');
    const ref = getStringFlag(flags, 'ref');

    output(
      await invokeOperation('ax.evidence.add', {
        kind,
        title,
        ...(body ? { body } : {}),
        ...(ref ? { ref } : {}),
        ...(positional.length > 0 ? { nodeIds: positional } : {}),
        source: resolveAxSource(flags),
      }),
    );
  },
);

cmd(
  'ax review add',
  'Add a canvas-bound AX review annotation',
  [
    'pmx-canvas ax review add --body "needs a test" --node node1',
    'pmx-canvas ax review add --body "off-by-one" --kind finding --severity error --file src/x.ts',
  ],
  async (args) => {
    const { flags } = parseFlags(args);
    if (flags.help || flags.h) return showCommandHelp('ax review add');

    const body = requireFlag(flags, 'body', 'pmx-canvas ax review add --body <text>');
    const kind = getStringFlag(flags, 'kind');
    const severity = getStringFlag(flags, 'severity');
    const anchorType = getStringFlag(flags, 'anchor');
    const nodeId = getStringFlag(flags, 'node');
    const file = getStringFlag(flags, 'file');
    const author = getStringFlag(flags, 'author');

    output(
      await invokeOperation('ax.review.add', {
        body,
        ...(kind ? { kind } : {}),
        ...(severity ? { severity } : {}),
        ...(anchorType ? { anchorType } : {}),
        ...(nodeId ? { nodeId } : {}),
        ...(file ? { file } : {}),
        ...(author ? { author } : {}),
        source: resolveAxSource(flags),
      }),
    );
  },
);

cmd('ax review list', 'List canvas-bound AX review annotations', ['pmx-canvas ax review list'], async (args) => {
  const { flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('ax review list');

  output(await invokeOperation('ax.review.list', {}));
});

cmd(
  'ax host report',
  'Report host/session capability to the canvas',
  [
    'pmx-canvas ax host report --host copilot --canvas --tools --session-messaging',
    'pmx-canvas ax host report --host codex --canvas --files',
  ],
  async (args) => {
    const { flags } = parseFlags(args);
    if (flags.help || flags.h) return showCommandHelp('ax host report');

    const host = getStringFlag(flags, 'host');

    output(
      await invokeOperation('ax.host-capability.report', {
        ...(host ? { host } : {}),
        canvas: flags.canvas === true,
        hooks: flags.hooks === true,
        tools: flags.tools === true,
        sessionMessaging: flags['session-messaging'] === true,
        permissions: flags.permissions === true,
        files: flags.files === true,
        uiPrompts: flags['ui-prompts'] === true,
        source: resolveAxSource(flags),
      }),
    );
  },
);

cmd('ax host status', 'Read the reported host/session capability', ['pmx-canvas ax host status'], async (args) => {
  const { flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('ax host status');

  output(await invokeOperation('ax.host-capability.get', {}));
});
