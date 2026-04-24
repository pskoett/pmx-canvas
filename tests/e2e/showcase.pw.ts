/**
 * Comprehensive showcase test — creates a full SDLC dashboard using every
 * node type, edges, groups, and context pins, then captures a hero screenshot.
 */
import { expect, test } from '@playwright/test';

// ── Helpers ──────────────────────────────────────────────────

async function clear(request: { post: Function }): Promise<void> {
  await request.post('/api/canvas/clear');
  await request.post('/api/canvas/context-pins', { data: { nodeIds: [] } });
}

async function addNode(
  request: { post: Function },
  body: Record<string, unknown>,
): Promise<string> {
  const r = await request.post('/api/canvas/node', { data: body });
  return ((await r.json()) as { id: string }).id;
}

async function patchNode(
  request: { patch: Function },
  id: string,
  body: Record<string, unknown>,
): Promise<void> {
  await request.patch(`/api/canvas/node/${id}`, { data: body });
}

async function addEdge(
  request: { post: Function },
  body: Record<string, unknown>,
): Promise<string> {
  const r = await request.post('/api/canvas/edge', { data: body });
  const payload = (await r.json()) as { id?: string; ok?: boolean; error?: string };
  if (!r.ok() || !payload.id) {
    console.error(
      `[showcase] addEdge failed: status=${r.status()} body=${JSON.stringify(payload)} input=${JSON.stringify(body)}`,
    );
    throw new Error(`addEdge failed: ${payload.error ?? r.statusText()}`);
  }
  return payload.id;
}

async function createGroup(
  request: { post: Function },
  body: Record<string, unknown>,
): Promise<string> {
  const r = await request.post('/api/canvas/group', { data: body });
  return ((await r.json()) as { id: string }).id;
}

async function addGraph(
  request: { post: Function },
  body: Record<string, unknown>,
): Promise<string> {
  const r = await request.post('/api/canvas/graph', { data: body });
  return ((await r.json()) as { id: string }).id;
}

async function addJsonRender(
  request: { post: Function },
  body: Record<string, unknown>,
): Promise<string> {
  const r = await request.post('/api/canvas/json-render', { data: body });
  const payload = (await r.json()) as { id?: string; ok?: boolean; error?: string };
  if (!r.ok() || !payload.id) {
    const title = (body.title as string) ?? '<untitled>';
    console.error(
      `[showcase] addJsonRender failed (title="${title}"): status=${r.status()} body=${JSON.stringify(payload).slice(0, 500)}`,
    );
    throw new Error(`addJsonRender failed: ${payload.error ?? r.statusText()}`);
  }
  return payload.id;
}

async function buildArtifact(
  request: { post: Function },
  body: Record<string, unknown>,
): Promise<{ id: string; url: string }> {
  const r = await request.post('/api/canvas/web-artifact', { data: body });
  const result = (await r.json()) as { nodeId: string; url: string };
  return { id: result.nodeId, url: result.url };
}

// ── Test ─────────────────────────────────────────────────────

test('SDLC showcase with all node types', async ({ page, request }) => {
  test.setTimeout(120_000);
  await clear(request);

  // ═══════════════════════════════════════════════════════════
  // ROW 1 — Narrative column (left) + Status column (center) + Context (right)
  // ═══════════════════════════════════════════════════════════

  // ── Markdown: SDLC report article ──────────────────────────
  const article = await addNode(request, {
    type: 'markdown',
    title: 'SDLC Pipeline Report',
    content: [
      '## Weekly Pipeline Health — W15',
      '',
      'The deployment pipeline processed **22 releases** this week with a',
      'first-pass gate rate of **78%**. Lead time median dropped from 27h to 19h.',
      '',
      '### Key findings',
      '- Integration tests remain the primary bottleneck (38% of failures)',
      '- Canary analysis caught 2 regressions before production',
      '- Platform team absorbed 34% of operational load',
      '',
      '### Recommendations',
      '1. Parallelize integration test suites across 4 runners',
      '2. Add synthetic canary for checkout flow',
      '3. Redistribute on-call load from Platform to domain teams',
      '',
      '> "The best pipeline is one where humans focus on design',
      '> decisions and agents handle verification." — SRE handbook',
    ].join('\n'),
    x: 40, y: 40, width: 420, height: 480,
  });

  // ── Image: pipeline diagram (SVG data URI) ─────────────────
  const svgContent = `data:image/svg+xml;base64,${Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 120">
      <rect width="400" height="120" fill="#1a1a2e" rx="8"/>
      <text x="200" y="25" fill="#8888aa" text-anchor="middle" font-size="11" font-family="monospace">Pipeline Flow</text>
      <g transform="translate(20,45)">
        <rect width="70" height="30" rx="4" fill="#264653"/>
        <text x="35" y="19" fill="#e9c46a" text-anchor="middle" font-size="9" font-family="monospace">Build</text>
      </g>
      <line x1="95" y1="60" x2="115" y2="60" stroke="#555" stroke-width="2" marker-end="url(#arrow)"/>
      <g transform="translate(120,45)">
        <rect width="70" height="30" rx="4" fill="#264653"/>
        <text x="35" y="19" fill="#2a9d8f" text-anchor="middle" font-size="9" font-family="monospace">Test</text>
      </g>
      <line x1="195" y1="60" x2="215" y2="60" stroke="#555" stroke-width="2"/>
      <g transform="translate(220,45)">
        <rect width="70" height="30" rx="4" fill="#264653"/>
        <text x="35" y="19" fill="#e76f51" text-anchor="middle" font-size="9" font-family="monospace">Gate</text>
      </g>
      <line x1="295" y1="60" x2="315" y2="60" stroke="#555" stroke-width="2"/>
      <g transform="translate(320,45)">
        <rect width="60" height="30" rx="4" fill="#264653"/>
        <text x="30" y="19" fill="#a7c957" text-anchor="middle" font-size="9" font-family="monospace">Deploy</text>
      </g>
      <text x="200" y="105" fill="#555" text-anchor="middle" font-size="9" font-family="monospace">Build → Test → Gate → Deploy</text>
    </svg>
  `, 'utf-8').toString('base64')}`;

  const image = await addNode(request, {
    type: 'image',
    title: 'Pipeline Flow Diagram',
    content: svgContent,
    x: 40, y: 550, width: 420, height: 200,
  });

  // ── Status node: release train ─────────────────────────────
  const status = await addNode(request, {
    type: 'status',
    title: 'Release Train Status',
    data: {
      phase: 'active',
      detail: 'weekly train / synthetic telemetry',
      message: 'Integration tests are the current bottleneck. Build and rollback posture remain healthy.',
      level: 'warn',
      activeTool: 'pipeline.evaluate',
      subagent: { state: 'running', name: 'release-gate-check' },
    },
    x: 500, y: 40, width: 360, height: 180,
  });

  // ── Context node: agent briefing ───────────────────────────
  const context = await addNode(request, {
    type: 'context',
    title: 'Pinned Briefing',
    data: {
      cards: [
        { label: 'Sprint', value: 'W15 — Pipeline Hardening', category: 'planning', state: 'loaded' },
        { label: 'Focus', value: 'Integration test parallelization', category: 'profile', state: 'loaded' },
        { label: 'Risk', value: 'Canary coverage gap in checkout flow', category: 'memory', state: 'stale' },
      ],
      currentTokens: 42800,
      tokenLimit: 128000,
      utilization: 0.33,
      messagesLength: 28,
    },
    x: 500, y: 250, width: 360, height: 270,
  });

  // ── Ledger node: execution metrics ─────────────────────────
  const ledger = await addNode(request, {
    type: 'ledger',
    title: 'Execution Ledger',
    data: {
      deploymentsThisWeek: 22,
      firstPassGateRate: '78%',
      leadTimeMedian: '19h',
      mttrMedian: '36m',
      canaryPassRate: '96%',
      rollbackCount: 1,
    },
    x: 500, y: 550, width: 360, height: 200,
  });

  // ═══════════════════════════════════════════════════════════
  // ROW 2 — Trace nodes + file node
  // ═══════════════════════════════════════════════════════════

  // ── Trace nodes: agent activity ────────────────────────────
  const trace1 = await addNode(request, {
    type: 'trace',
    title: 'Trace: test-runner',
    data: {
      toolName: 'bun test',
      category: 'other',
      status: 'success',
      duration: '12.4s',
      resultSummary: '142 tests passed, 0 failed',
    },
    x: 900, y: 40, width: 340, height: 70,
  });

  const trace2 = await addNode(request, {
    type: 'trace',
    title: 'Trace: gate-eval',
    data: {
      toolName: 'pipeline.evaluate',
      category: 'mcp',
      status: 'success',
      duration: '3.8s',
      resultSummary: 'All 6 gates passing',
    },
    x: 900, y: 130, width: 340, height: 70,
  });

  const trace3 = await addNode(request, {
    type: 'trace',
    title: 'Trace: canary-deploy',
    data: {
      toolName: 'deploy.canary',
      category: 'subagent',
      status: 'running',
      duration: 'live',
    },
    x: 900, y: 220, width: 340, height: 70,
  });

  const trace4 = await addNode(request, {
    type: 'trace',
    title: 'Trace: coverage-check',
    data: {
      toolName: 'coverage.report',
      category: 'file',
      status: 'failed',
      duration: '1.2s',
      error: 'Coverage dropped below 90% threshold',
    },
    x: 900, y: 310, width: 340, height: 70,
  });

  // ── File node: source code ─────────────────────────────────
  // We'll use a markdown node styled like code since we can't guarantee a file exists
  const codeFile = await addNode(request, {
    type: 'markdown',
    title: 'src/pipeline/gate-evaluator.ts',
    content: [
      '```typescript',
      'import { GateResult, PipelineStage } from "./types";',
      '',
      'export async function evaluateGates(',
      '  stages: PipelineStage[],',
      '): Promise<GateResult[]> {',
      '  const results: GateResult[] = [];',
      '',
      '  for (const stage of stages) {',
      '    const passed = stage.failureRate < stage.threshold;',
      '    results.push({',
      '      gate: stage.name,',
      '      passed,',
      '      failureRate: stage.failureRate,',
      '      threshold: stage.threshold,',
      '    });',
      '  }',
      '',
      '  return results;',
      '}',
      '```',
    ].join('\n'),
    x: 900, y: 410, width: 340, height: 340,
  });

  // ═══════════════════════════════════════════════════════════
  // ROW 3 — Charts (line, bar, pie)
  // ═══════════════════════════════════════════════════════════

  const lineChart = await addGraph(request, {
    title: 'Lead Time Trend (hours)',
    graphType: 'line',
    data: [
      { week: 'W11', hours: 32 },
      { week: 'W12', hours: 28 },
      { week: 'W13', hours: 27 },
      { week: 'W14', hours: 24 },
      { week: 'W15', hours: 19 },
    ],
    xKey: 'week',
    yKey: 'hours',
    color: '#e9c46a',
    x: 40, y: 790, width: 420, height: 360,
  });

  const barChart = await addGraph(request, {
    title: 'Defects by Stage',
    graphType: 'bar',
    data: [
      { stage: 'Lint', defects: 4 },
      { stage: 'Unit', defects: 9 },
      { stage: 'Integration', defects: 18 },
      { stage: 'UI/E2E', defects: 7 },
      { stage: 'Canary', defects: 2 },
    ],
    xKey: 'stage',
    yKey: 'defects',
    color: '#e76f51',
    x: 500, y: 790, width: 420, height: 360,
  });

  const pieChart = await addGraph(request, {
    title: 'Operational Load by Team',
    graphType: 'pie',
    data: [
      { name: 'Platform', value: 34 },
      { name: 'Checkout', value: 22 },
      { name: 'Identity', value: 18 },
      { name: 'Catalog', value: 15 },
      { name: 'Observability', value: 11 },
    ],
    nameKey: 'name',
    valueKey: 'value',
    x: 960, y: 790, width: 420, height: 360,
  });

  // ═══════════════════════════════════════════════════════════
  // ROW 4 — JSON Render dashboards
  // ═══════════════════════════════════════════════════════════

  const gateBoard = await addJsonRender(request, {
    title: 'Release Gate Dashboard',
    spec: {
      root: 'card',
      elements: {
        card: {
          type: 'Card',
          props: { title: 'Release Gates', description: 'Current pipeline gate status' },
          children: ['stack'],
        },
        stack: {
          type: 'Stack',
          props: { direction: 'vertical', gap: 'md' },
          children: ['table', 'sep', 'alerts'],
        },
        table: {
          type: 'Table',
          props: {
            columns: ['Gate', 'Status', 'Failure Rate', 'Threshold'],
            rows: [
              ['Lint', 'Pass', '0.2%', '< 1%'],
              ['Unit Tests', 'Pass', '1.1%', '< 5%'],
              ['Integration', 'Warn', '4.8%', '< 5%'],
              ['UI/E2E', 'Pass', '2.1%', '< 5%'],
              ['Canary', 'Pass', '0.5%', '< 2%'],
              ['Security Scan', 'Pass', '0.0%', '< 1%'],
            ],
          },
          children: [],
        },
        sep: {
          type: 'Separator',
          props: {},
          children: [],
        },
        alerts: {
          type: 'Stack',
          props: { direction: 'vertical', gap: 'sm' },
          children: ['alert1', 'alert2'],
        },
        alert1: {
          type: 'Alert',
          props: {
            title: 'Integration gate near threshold',
            message: 'Failure rate 4.8% approaching 5% limit. Consider parallelizing test suites.',
            type: 'warning',
          },
          children: [],
        },
        alert2: {
          type: 'Alert',
          props: {
            title: 'Canary healthy',
            message: 'All canary metrics within bounds for the last 72 hours.',
            type: 'success',
          },
          children: [],
        },
      },
    },
    x: 40, y: 1190, width: 460, height: 520,
  });

  const serviceMatrix = await addJsonRender(request, {
    title: 'Service Readiness Matrix',
    spec: {
      root: 'card',
      elements: {
        card: {
          type: 'Card',
          props: { title: 'Service Readiness', description: 'Deploy confidence by service' },
          children: ['stack'],
        },
        stack: {
          type: 'Stack',
          props: { direction: 'vertical', gap: 'md' },
          children: ['svcTable', 'sep', 'progressStack'],
        },
        svcTable: {
          type: 'Table',
          props: {
            columns: ['Service', 'Version', 'Tests', 'Coverage', 'Ready'],
            rows: [
              ['auth-service', 'v2.4.1', '142/142', '94%', 'Yes'],
              ['checkout-api', 'v3.1.0', '89/91', '87%', 'Warn'],
              ['catalog-svc', 'v1.8.3', '204/204', '92%', 'Yes'],
              ['identity-gw', 'v4.0.0-rc', '67/68', '79%', 'No'],
            ],
          },
          children: [],
        },
        sep: {
          type: 'Separator',
          props: {},
          children: [],
        },
        progressStack: {
          type: 'Stack',
          props: { direction: 'vertical', gap: 'sm' },
          children: ['p1', 'p2', 'p3', 'p4'],
        },
        p1: {
          type: 'Progress',
          props: { value: 94, max: 100, label: 'auth-service coverage' },
          children: [],
        },
        p2: {
          type: 'Progress',
          props: { value: 87, max: 100, label: 'checkout-api coverage' },
          children: [],
        },
        p3: {
          type: 'Progress',
          props: { value: 92, max: 100, label: 'catalog-svc coverage' },
          children: [],
        },
        p4: {
          type: 'Progress',
          props: { value: 79, max: 100, label: 'identity-gw coverage' },
          children: [],
        },
      },
    },
    x: 540, y: 1190, width: 460, height: 520,
  });

  const operatorForm = await addJsonRender(request, {
    title: 'Release Gate Intake',
    spec: {
      root: 'card',
      elements: {
        card: {
          type: 'Card',
          props: { title: 'Gate Override Request', description: 'Submit a manual gate override' },
          children: ['form'],
        },
        form: {
          type: 'Stack',
          props: { direction: 'vertical', gap: 'md' },
          children: ['svcSelect', 'gateSelect', 'reason', 'riskRadio', 'approve', 'submit'],
        },
        svcSelect: {
          type: 'Select',
          props: {
            label: 'Service',
            name: 'service',
            options: ['auth-service', 'checkout-api', 'catalog-svc', 'identity-gw'],
            placeholder: 'Select a service',
          },
          children: [],
        },
        gateSelect: {
          type: 'Select',
          props: {
            label: 'Gate to Override',
            name: 'gate',
            options: ['Integration', 'UI/E2E', 'Canary', 'Security Scan'],
            placeholder: 'Select a gate',
          },
          children: [],
        },
        reason: {
          type: 'Textarea',
          props: {
            label: 'Justification',
            name: 'reason',
            placeholder: 'Why is this override needed?',
            rows: 3,
          },
          children: [],
        },
        riskRadio: {
          type: 'Radio',
          props: {
            label: 'Risk Level',
            name: 'risk',
            options: ['Low — cosmetic issue', 'Medium — workaround exists', 'High — blocking release'],
          },
          children: [],
        },
        approve: {
          type: 'Checkbox',
          props: {
            label: 'I confirm this override has been reviewed by the on-call SRE',
            name: 'approved',
          },
          children: [],
        },
        submit: {
          type: 'Button',
          props: { label: 'Submit Override', variant: 'primary' },
          children: [],
        },
      },
    },
    x: 1040, y: 1190, width: 380, height: 520,
  });

  const profileCard = await addJsonRender(request, {
    title: 'User Profile Card',
    spec: {
      root: 'card',
      elements: {
        card: {
          type: 'Card',
          props: { title: 'User Profile', description: null, maxWidth: 'full', centered: false },
          children: ['stack'],
        },
        stack: {
          type: 'Stack',
          props: { direction: 'vertical', gap: 'md', align: 'stretch', justify: 'start' },
          children: ['heading', 'copy', 'badges', 'sep', 'progress'],
        },
        heading: {
          type: 'Heading',
          props: { text: 'Jane Cooper', level: 'h2' },
          children: [],
        },
        copy: {
          type: 'Text',
          props: {
            text: 'Senior software engineer based in San Francisco. Passionate about building accessible, high-performance web applications.',
            variant: 'muted',
          },
          children: [],
        },
        badges: {
          type: 'Stack',
          props: { direction: 'horizontal', gap: 'sm', align: 'center', justify: 'start' },
          children: ['badge1', 'badge2', 'badge3'],
        },
        badge1: { type: 'Badge', props: { text: 'TypeScript', variant: 'default' }, children: [] },
        badge2: { type: 'Badge', props: { text: 'React', variant: 'secondary' }, children: [] },
        badge3: { type: 'Badge', props: { text: 'Node.js', variant: 'outline' }, children: [] },
        sep: { type: 'Separator', props: {}, children: [] },
        progress: {
          type: 'Progress',
          props: { value: 72, max: 100, label: 'Profile completion' },
          children: [],
        },
      },
    },
    x: 40, y: 1730, width: 420, height: 400,
  });

  const settingsSurface = await addJsonRender(request, {
    title: 'Account Settings',
    spec: {
      root: 'card',
      elements: {
        card: {
          type: 'Card',
          props: { title: 'Account Settings', description: 'Manage your preferences' },
          children: ['form'],
        },
        form: {
          type: 'Stack',
          props: { direction: 'vertical', gap: 'md' },
          children: ['name', 'email', 'role', 'sep1', 'notifications', 'darkMode', 'sep2', 'actions'],
        },
        name: {
          type: 'Input',
          props: { label: 'Full Name', name: 'name', type: 'text', placeholder: 'Your name', value: 'Ada Lovelace' },
          children: [],
        },
        email: {
          type: 'Input',
          props: { label: 'Email', name: 'email', type: 'email', placeholder: 'you@example.com', value: 'ada@example.com' },
          children: [],
        },
        role: {
          type: 'Select',
          props: {
            label: 'Role',
            name: 'role',
            options: ['Engineer', 'Designer', 'Product Manager', 'Data Scientist'],
            placeholder: 'Choose a role',
            value: 'Engineer',
          },
          children: [],
        },
        sep1: { type: 'Separator', props: {}, children: [] },
        notifications: {
          type: 'Switch',
          props: { label: 'Email notifications', name: 'notifications', checked: true },
          children: [],
        },
        darkMode: {
          type: 'Switch',
          props: { label: 'Dark mode', name: 'dark-mode', checked: true },
          children: [],
        },
        sep2: { type: 'Separator', props: {}, children: [] },
        actions: {
          type: 'Stack',
          props: { direction: 'horizontal', gap: 'sm', justify: 'end' },
          children: ['cancel', 'save'],
        },
        cancel: { type: 'Button', props: { label: 'Cancel', variant: 'secondary' }, children: [] },
        save: { type: 'Button', props: { label: 'Save Changes', variant: 'primary' }, children: [] },
      },
    },
    x: 500, y: 1730, width: 420, height: 460,
  });

  const pricingTable = await addJsonRender(request, {
    title: 'Pricing Table',
    spec: {
      root: 'outer',
      elements: {
        outer: {
          type: 'Stack',
          props: { direction: 'vertical', gap: 'lg', align: 'stretch', justify: 'start' },
          children: ['header', 'grid'],
        },
        header: {
          type: 'Stack',
          props: { direction: 'vertical', gap: 'sm', align: 'center', justify: 'start' },
          children: ['title', 'subtitle'],
        },
        title: { type: 'Heading', props: { text: 'Simple, transparent pricing', level: 'h1' }, children: [] },
        subtitle: {
          type: 'Text',
          props: { text: 'Choose the plan that fits your needs. Upgrade or downgrade at any time.', variant: 'muted' },
          children: [],
        },
        grid: {
          type: 'Grid',
          props: { columns: 3, gap: 'md' },
          children: ['free', 'pro', 'enterprise'],
        },
        free: {
          type: 'Card',
          props: { title: 'Free', description: '$0/month' },
          children: ['freeContent'],
        },
        freeContent: {
          type: 'Stack',
          props: { direction: 'vertical', gap: 'sm' },
          children: ['free1', 'free2', 'free3', 'freeButton'],
        },
        free1: { type: 'Text', props: { text: 'Up to 3 projects', variant: 'body' }, children: [] },
        free2: { type: 'Text', props: { text: '1 GB storage', variant: 'body' }, children: [] },
        free3: { type: 'Text', props: { text: 'Community support', variant: 'body' }, children: [] },
        freeButton: { type: 'Button', props: { label: 'Get Started', variant: 'secondary' }, children: [] },
        pro: {
          type: 'Card',
          props: { title: 'Pro', description: '$19/month' },
          children: ['proContent'],
        },
        proContent: {
          type: 'Stack',
          props: { direction: 'vertical', gap: 'sm' },
          children: ['pro1', 'pro2', 'pro3', 'pro4', 'proButton'],
        },
        pro1: { type: 'Text', props: { text: 'Unlimited projects', variant: 'body' }, children: [] },
        pro2: { type: 'Text', props: { text: '50 GB storage', variant: 'body' }, children: [] },
        pro3: { type: 'Text', props: { text: 'Priority support', variant: 'body' }, children: [] },
        pro4: { type: 'Text', props: { text: 'Custom domains', variant: 'body' }, children: [] },
        proButton: { type: 'Button', props: { label: 'Upgrade to Pro', variant: 'primary' }, children: [] },
        enterprise: {
          type: 'Card',
          props: { title: 'Enterprise', description: 'Custom pricing' },
          children: ['enterpriseContent'],
        },
        enterpriseContent: {
          type: 'Stack',
          props: { direction: 'vertical', gap: 'sm' },
          children: ['enterprise1', 'enterprise2', 'enterprise3', 'enterprise4', 'enterpriseButton'],
        },
        enterprise1: { type: 'Text', props: { text: 'Everything in Pro', variant: 'body' }, children: [] },
        enterprise2: { type: 'Text', props: { text: 'Unlimited storage', variant: 'body' }, children: [] },
        enterprise3: { type: 'Text', props: { text: 'Dedicated support', variant: 'body' }, children: [] },
        enterprise4: { type: 'Text', props: { text: 'SLA guarantees', variant: 'body' }, children: [] },
        enterpriseButton: { type: 'Button', props: { label: 'Contact Sales', variant: 'secondary' }, children: [] },
      },
    },
    x: 960, y: 1730, width: 840, height: 500,
  });

  const embeddedCharts = await addJsonRender(request, {
    title: 'Embedded Charts Dashboard',
    spec: {
      root: 'card',
      elements: {
        card: {
          type: 'Card',
          props: {
            title: 'Embedded Charts Dashboard',
            description: 'Upstream-style analytics panels rendered directly inside a json-render node',
          },
          children: ['stack'],
        },
        stack: {
          type: 'Stack',
          props: { direction: 'vertical', gap: 'md' },
          children: ['summary', 'sep', 'line', 'bar', 'pie'],
        },
        summary: {
          type: 'Text',
          props: { text: 'The same chart coverage can render inline inside one spec, not only as dedicated graph nodes.', variant: 'muted' },
          children: [],
        },
        sep: { type: 'Separator', props: {}, children: [] },
        line: {
          type: 'LineChart',
          props: {
            title: 'Lead Time Trend',
            data: [
              { week: 'W14', leadTimeHours: 27 },
              { week: 'W15', leadTimeHours: 24 },
              { week: 'W16', leadTimeHours: 22 },
              { week: 'W17', leadTimeHours: 20 },
              { week: 'W18', leadTimeHours: 19 },
            ],
            xKey: 'week',
            yKey: 'leadTimeHours',
            color: '#e9c46a',
            height: 220,
          },
          children: [],
        },
        bar: {
          type: 'BarChart',
          props: {
            title: 'Defects by Stage',
            data: [
              { stage: 'Lint', defects: 12 },
              { stage: 'Unit', defects: 9 },
              { stage: 'Integration', defects: 17 },
              { stage: 'UI Smoke', defects: 11 },
              { stage: 'Canary', defects: 4 },
            ],
            xKey: 'stage',
            yKey: 'defects',
            color: '#e76f51',
            height: 220,
          },
          children: [],
        },
        pie: {
          type: 'PieChart',
          props: {
            title: 'Operational Load by Team',
            data: [
              { name: 'Platform', value: 34 },
              { name: 'Checkout', value: 22 },
              { name: 'Identity', value: 18 },
              { name: 'Catalog', value: 15 },
              { name: 'Observability', value: 11 },
            ],
            nameKey: 'name',
            valueKey: 'value',
            height: 240,
          },
          children: [],
        },
      },
    },
    x: 40, y: 2260, width: 940, height: 900,
  });

  // ═══════════════════════════════════════════════════════════
  // Web artifact: SDLC control room
  // ═══════════════════════════════════════════════════════════

  let artifactId: string | undefined;
  try {
    const artifact = await buildArtifact(request, {
      title: 'SDLC Control Room',
      appTsx: `
import React from 'react';

const metrics = [
  { label: 'Deployments', value: '22', trend: '+3', color: '#2a9d8f' },
  { label: 'Lead Time', value: '19h', trend: '-5h', color: '#e9c46a' },
  { label: 'Gate Pass', value: '78%', trend: '+2%', color: '#e76f51' },
  { label: 'MTTR', value: '36m', trend: '-8m', color: '#a7c957' },
];

const stages = [
  { name: 'Build', status: 'pass', time: '3.2s' },
  { name: 'Lint', status: 'pass', time: '1.1s' },
  { name: 'Unit', status: 'pass', time: '12.4s' },
  { name: 'Integration', status: 'warn', time: '45.2s' },
  { name: 'Canary', status: 'pass', time: '2m 15s' },
  { name: 'Deploy', status: 'running', time: '...' },
];

const statusColors: Record<string, string> = {
  pass: '#2a9d8f',
  warn: '#e9c46a',
  fail: '#e76f51',
  running: '#4a9eff',
};

export default function App() {
  return (
    <div style={{ fontFamily: 'system-ui, -apple-system, sans-serif', background: '#0f0f1a', color: '#e0e0e0', padding: '24px', minHeight: '100vh' }}>
      <h2 style={{ margin: '0 0 20px', fontSize: '18px', color: '#fff' }}>SDLC Control Room</h2>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '24px' }}>
        {metrics.map(m => (
          <div key={m.label} style={{ background: '#1a1a2e', borderRadius: '8px', padding: '16px', borderLeft: '3px solid ' + m.color }}>
            <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>{m.label}</div>
            <div style={{ fontSize: '24px', fontWeight: 700 }}>{m.value}</div>
            <div style={{ fontSize: '11px', color: m.color }}>{m.trend}</div>
          </div>
        ))}
      </div>

      <h3 style={{ fontSize: '14px', color: '#888', marginBottom: '12px' }}>Pipeline Stages</h3>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        {stages.map((s, i) => (
          <div key={s.name} style={{ display: 'flex', alignItems: 'center', gap: '12px', background: '#1a1a2e', borderRadius: '6px', padding: '10px 16px', flex: '1 1 140px' }}>
            <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: statusColors[s.status] || '#555', boxShadow: s.status === 'running' ? '0 0 8px ' + statusColors.running : 'none' }} />
            <div>
              <div style={{ fontSize: '12px', fontWeight: 600 }}>{s.name}</div>
              <div style={{ fontSize: '10px', color: '#666' }}>{s.time}</div>
            </div>
            {i < stages.length - 1 && <span style={{ color: '#333', marginLeft: 'auto' }}>→</span>}
          </div>
        ))}
      </div>
    </div>
  );
}`,
      indexCss: `
body { margin: 0; background: #0f0f1a; }
* { box-sizing: border-box; }`,
      openInCanvas: true,
    });
    artifactId = artifact.id;

    // Reposition the artifact node
    if (artifactId) {
      await patchNode(request, artifactId, {
        position: { x: 1280, y: 40 },
        size: { width: 520, height: 420 },
      });
    }
  } catch {
    // Web artifact build can fail in CI — continue without it
    console.log('Web artifact build skipped (build tools may not be available)');
  }

  // ═══════════════════════════════════════════════════════════
  // Groups — organize by concern
  // ═══════════════════════════════════════════════════════════

  await createGroup(request, {
    title: 'Narrative & Evidence',
    childIds: [article, image],
    color: '#e76f51',
  });

  await createGroup(request, {
    title: 'Operational Telemetry',
    childIds: [status, context, ledger],
    color: '#2a9d8f',
  });

  await createGroup(request, {
    title: 'Agent Activity',
    childIds: [trace1, trace2, trace3, trace4, codeFile],
    color: '#4a9eff',
  });

  await createGroup(request, {
    title: 'Trend Analysis',
    childIds: [lineChart, barChart, pieChart],
    color: '#e9c46a',
  });

  await createGroup(request, {
    title: 'Structured UI Surfaces',
    childIds: [gateBoard, serviceMatrix, operatorForm, profileCard, settingsSurface, pricingTable, embeddedCharts],
    color: '#a7c957',
  });

  // ═══════════════════════════════════════════════════════════
  // Edges — connect the narrative
  // ═══════════════════════════════════════════════════════════

  await addEdge(request, { from: article, to: image, type: 'references', label: 'illustrates' });
  await addEdge(request, { from: article, to: status, type: 'flow' });
  await addEdge(request, { from: status, to: context, type: 'flow', label: 'informs' });
  await addEdge(request, { from: status, to: ledger, type: 'relation' });
  await addEdge(request, { from: ledger, to: lineChart, type: 'references', label: 'tracked by' });
  await addEdge(request, { from: ledger, to: barChart, type: 'references', label: 'broken down' });
  await addEdge(request, { from: ledger, to: pieChart, type: 'references', label: 'allocated' });
  await addEdge(request, { from: trace1, to: trace2, type: 'flow', label: 'then' });
  await addEdge(request, { from: trace2, to: trace3, type: 'flow', label: 'then' });
  await addEdge(request, { from: trace3, to: trace4, type: 'flow', label: 'then' });
  await addEdge(request, { from: codeFile, to: gateBoard, type: 'depends-on', label: 'evaluated by' });
  await addEdge(request, { from: gateBoard, to: serviceMatrix, type: 'flow', label: 'feeds' });
  await addEdge(request, { from: serviceMatrix, to: operatorForm, type: 'depends-on', label: 'override via' });
  await addEdge(request, { from: serviceMatrix, to: profileCard, type: 'flow', label: 'persona' });
  await addEdge(request, { from: profileCard, to: settingsSurface, type: 'depends-on', label: 'preferences' });
  await addEdge(request, { from: settingsSurface, to: pricingTable, type: 'flow', label: 'plan choice' });
  await addEdge(request, { from: pricingTable, to: embeddedCharts, type: 'references', label: 'usage analytics' });
  if (artifactId) {
    await addEdge(request, { from: context, to: artifactId, type: 'flow', label: 'control room' });
  }

  // ═══════════════════════════════════════════════════════════
  // Context pins — simulate human curation
  // ═══════════════════════════════════════════════════════════

  await request.post('/api/canvas/context-pins', {
    data: { nodeIds: [article, codeFile, gateBoard] },
  });

  // ═══════════════════════════════════════════════════════════
  // Verify & screenshot
  // ═══════════════════════════════════════════════════════════

  await page.goto('/workbench');
  await page.waitForSelector('.canvas-node', { timeout: 15000 });

  // Count both world-space canvas nodes and docked HUD nodes.
  // Some HUD surfaces render outside the .canvas-node wrapper, so this assertion covers both.
  const expectedRenderedNodes = artifactId ? 26 : 25;
  await expect(page.locator('.canvas-node, .docked-node')).toHaveCount(expectedRenderedNodes, { timeout: 15000 });

  // Wait for edges and iframe content to settle
  await page.waitForTimeout(3000);

  // Verify key nodes are present
  await expect(page.locator('.canvas-node').filter({ hasText: 'SDLC Pipeline Report' })).toHaveCount(1);
  await expect(page.locator('.canvas-node').filter({ hasText: 'Release Train Status' })).toHaveCount(1);
  await expect(page.locator('.canvas-node').filter({ hasText: 'Execution Ledger' })).toHaveCount(1);
  await expect(page.locator('.canvas-node').filter({ hasText: 'Lead Time Trend' })).toHaveCount(1);
  await expect(page.locator('.canvas-node').filter({ hasText: 'Release Gate Dashboard' })).toHaveCount(1);
  await expect(page.locator('.canvas-node').filter({ hasText: 'Service Readiness Matrix' })).toHaveCount(1);
  await expect(page.locator('.canvas-node').filter({ hasText: 'User Profile Card' })).toHaveCount(1);
  await expect(page.locator('.canvas-node').filter({ hasText: 'Account Settings' })).toHaveCount(1);
  await expect(page.locator('.canvas-node').filter({ hasText: 'Pricing Table' })).toHaveCount(1);
  await expect(page.locator('.canvas-node').filter({ hasText: 'Embedded Charts Dashboard' })).toHaveCount(1);

  // Verify via API
  const stateResponse = await request.get('/api/canvas/state');
  const state = (await stateResponse.json()) as {
    nodes: Array<{ type: string }>;
    edges: Array<{ id: string }>;
  };

  // Check we have the expected node types
  const types = new Set(state.nodes.map((n) => n.type));
  expect(types.has('markdown')).toBe(true);
  expect(types.has('status')).toBe(true);
  expect(types.has('context')).toBe(true);
  expect(types.has('ledger')).toBe(true);
  expect(types.has('trace')).toBe(true);
  expect(types.has('image')).toBe(true);
  expect(types.has('json-render')).toBe(true);
  expect(types.has('graph')).toBe(true);
  expect(types.has('group')).toBe(true);

  const pinsResponse = await request.get('/api/canvas/pinned-context');
  const pins = (await pinsResponse.json()) as { count: number };
  expect(pins.count).toBe(3);

  // Check edges
  expect(state.edges.length).toBeGreaterThanOrEqual(17);

  // Take the hero screenshot
  await page.screenshot({
    path: 'docs/screenshot.png',
    fullPage: false,
  });
});
