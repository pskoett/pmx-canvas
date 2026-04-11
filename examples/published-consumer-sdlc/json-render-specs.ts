import type { JsonRenderSpec } from 'pmx-canvas';
import { componentRisks, gateRows, ownershipLoad, stageDefectCounts, weeklyMetrics } from './data';

export function buildControlTowerSpec(): JsonRenderSpec {
  return {
    root: 'card',
    elements: {
      card: {
        type: 'Card',
        props: {
          title: 'Control Tower Widgets',
          description: 'Synthetic SDLC telemetry rendered with native json-render components.',
          maxWidth: 'full',
          centered: false,
        },
        children: ['stack'],
      },
      stack: {
        type: 'Stack',
        props: {
          direction: 'vertical',
          gap: 'md',
          align: 'stretch',
          justify: 'start',
        },
        children: [
          'lede',
          'badgeRow',
          'riskAlert',
          'gateProgress',
          'separator',
          'gatesTable',
          'retroAccordion',
        ],
      },
      lede: {
        type: 'Text',
        props: {
          text: 'Lead time is improving, but integration queue volatility is still the gating constraint.',
          variant: 'lead',
        },
        children: [],
      },
      badgeRow: {
        type: 'Stack',
        props: {
          direction: 'horizontal',
          gap: 'sm',
          align: 'center',
          justify: 'start',
        },
        children: ['badgeRelease', 'badgeQueue', 'badgeRollback'],
      },
      badgeRelease: {
        type: 'Badge',
        props: { text: 'Release train green', variant: 'default' },
        children: [],
      },
      badgeQueue: {
        type: 'Badge',
        props: { text: 'Queue variance high', variant: 'outline' },
        children: [],
      },
      badgeRollback: {
        type: 'Badge',
        props: { text: 'Rollback rehearsed', variant: 'secondary' },
        children: [],
      },
      riskAlert: {
        type: 'Alert',
        props: {
          title: 'Integration queue saturation',
          message: 'Checkout and identity both exceeded the synthetic retry budget during the last rehearsal.',
          type: 'warning',
        },
        children: [],
      },
      gateProgress: {
        type: 'Progress',
        props: {
          value: 78,
          max: 100,
          label: '78% of release gates are passing on the first attempt',
        },
        children: [],
      },
      separator: {
        type: 'Separator',
        props: { orientation: 'horizontal' },
        children: [],
      },
      gatesTable: {
        type: 'Table',
        props: {
          columns: ['Gate', 'Owner', 'Status', 'Delta'],
          rows: gateRows.map((row) => [row.gate, row.owner, row.status, row.delta]),
          caption: 'Current synthetic gate review for the active release window.',
        },
        children: [],
      },
      retroAccordion: {
        type: 'Accordion',
        props: {
          type: 'single',
          items: [
            {
              title: 'What is slowing the train?',
              content: 'Integration and UI smoke both widened after new checkout retries were introduced.',
            },
            {
              title: 'Why is deploy still allowed?',
              content: 'Canary score and rollback drills are both green, so the release posture remains controlled.',
            },
            {
              title: 'What should an agent inspect first?',
              content: 'Start with the artifact app and the file nodes, then compare the gate table against the graph nodes.',
            },
          ],
        },
        children: [],
      },
    },
  };
}

export function buildReleaseIntakeSpec(): JsonRenderSpec {
  return {
    root: 'card',
    elements: {
      card: {
        type: 'Card',
        props: {
          title: 'Release Gate Intake',
          description: 'Interactive control inputs for the published-consumer test surface.',
          maxWidth: 'full',
          centered: false,
        },
        children: ['stack'],
      },
      stack: {
        type: 'Stack',
        props: {
          direction: 'vertical',
          gap: 'md',
          align: 'stretch',
          justify: 'start',
        },
        children: [
          'summary',
          'ticket',
          'notes',
          'target',
          'riskBand',
          'freeze',
          'rollback',
          'separator',
          'rollout',
          'lane',
          'shortcuts',
        ],
      },
      summary: {
        type: 'Text',
        props: {
          text: 'This node intentionally covers a broad set of json-render form controls.',
          variant: 'muted',
        },
        children: [],
      },
      ticket: {
        type: 'Input',
        props: {
          label: 'Change ticket',
          name: 'change-ticket',
          type: 'text',
          placeholder: 'REL-421',
          value: 'REL-421',
        },
        children: [],
      },
      notes: {
        type: 'Textarea',
        props: {
          label: 'Operator notes',
          name: 'operator-notes',
          placeholder: 'Describe the current release posture',
          rows: 4,
          value: 'Queue depth is elevated, but rollback rehearsal and canary scoring are both clean.',
        },
        children: [],
      },
      target: {
        type: 'Select',
        props: {
          label: 'Target environment',
          name: 'target-environment',
          options: ['staging', 'canary', 'production'],
          placeholder: 'Choose environment',
          value: 'production',
        },
        children: [],
      },
      riskBand: {
        type: 'Radio',
        props: {
          label: 'Risk band',
          name: 'risk-band',
          options: ['low', 'medium', 'high'],
          value: 'medium',
        },
        children: [],
      },
      freeze: {
        type: 'Switch',
        props: {
          label: 'Release freeze override',
          name: 'release-freeze',
          checked: false,
        },
        children: [],
      },
      rollback: {
        type: 'Checkbox',
        props: {
          label: 'Rollback rehearsal completed',
          name: 'rollback-check',
          checked: true,
        },
        children: [],
      },
      separator: {
        type: 'Separator',
        props: { orientation: 'horizontal' },
        children: [],
      },
      rollout: {
        type: 'ToggleGroup',
        props: {
          items: [
            { label: 'Canary', value: 'canary' },
            { label: 'Linear', value: 'linear' },
            { label: 'Blue/Green', value: 'blue-green' },
          ],
          type: 'single',
          value: 'canary',
        },
        children: [],
      },
      lane: {
        type: 'ButtonGroup',
        props: {
          buttons: [
            { label: 'Fast lane', value: 'fast' },
            { label: 'Steady lane', value: 'steady' },
            { label: 'Freeze lane', value: 'freeze' },
          ],
          selected: 'steady',
        },
        children: [],
      },
      shortcuts: {
        type: 'DropdownMenu',
        props: {
          label: 'Operator shortcuts',
          items: [
            { label: 'Open runbook', value: 'runbook' },
            { label: 'Pull flaky tests', value: 'flakes' },
            { label: 'Trigger rollback drill', value: 'rollback' },
          ],
        },
        children: [],
      },
    },
  };
}

export function buildServiceMatrixSpec(): JsonRenderSpec {
  return {
    root: 'card',
    elements: {
      card: {
        type: 'Card',
        props: {
          title: 'Service Readiness Matrix',
          description: 'Compact structured panel that turns fake service posture into a quick scan table.',
          maxWidth: 'full',
          centered: false,
        },
        children: ['matrixTable'],
      },
      matrixTable: {
        type: 'Table',
        props: {
          columns: ['Service', 'Readiness', 'Note'],
          rows: componentRisks.map((risk) => [
            risk.service,
            `${risk.readiness}%`,
            risk.note,
          ]),
          caption: 'Synthetic readiness table rendered through json-render.',
        },
        children: [],
      },
    },
  };
}

export function buildUserProfileCardSpec(): JsonRenderSpec {
  return {
    root: 'card',
    elements: {
      card: {
        type: 'Card',
        props: {
          title: 'User Profile',
          description: null,
          maxWidth: 'full',
          centered: false,
        },
        children: ['stack'],
      },
      stack: {
        type: 'Stack',
        props: {
          direction: 'vertical',
          gap: 'md',
          align: 'stretch',
          justify: 'start',
        },
        children: ['heading', 'text', 'badges', 'separator', 'progress'],
      },
      heading: {
        type: 'Heading',
        props: { text: 'Jane Cooper', level: 'h2' },
        children: [],
      },
      text: {
        type: 'Text',
        props: {
          text: 'Senior software engineer based in San Francisco. Passionate about building accessible, high-performance web applications.',
          variant: 'muted',
        },
        children: [],
      },
      badges: {
        type: 'Stack',
        props: {
          direction: 'horizontal',
          gap: 'sm',
          align: 'center',
          justify: 'start',
        },
        children: ['badgeTs', 'badgeReact', 'badgeNode'],
      },
      badgeTs: {
        type: 'Badge',
        props: { text: 'TypeScript', variant: 'default' },
        children: [],
      },
      badgeReact: {
        type: 'Badge',
        props: { text: 'React', variant: 'secondary' },
        children: [],
      },
      badgeNode: {
        type: 'Badge',
        props: { text: 'Node.js', variant: 'outline' },
        children: [],
      },
      separator: {
        type: 'Separator',
        props: { orientation: 'horizontal' },
        children: [],
      },
      progress: {
        type: 'Progress',
        props: { value: 72, max: 100, label: 'Profile completion' },
        children: [],
      },
    },
  };
}

export function buildSettingsFormSpec(): JsonRenderSpec {
  return {
    root: 'card',
    elements: {
      card: {
        type: 'Card',
        props: {
          title: 'Account Settings',
          description: 'Manage your preferences',
          maxWidth: 'full',
          centered: false,
        },
        children: ['form'],
      },
      form: {
        type: 'Stack',
        props: {
          direction: 'vertical',
          gap: 'md',
          align: 'stretch',
          justify: 'start',
        },
        children: [
          'nameInput',
          'emailInput',
          'roleSelect',
          'separator1',
          'notificationSwitch',
          'darkModeSwitch',
          'separator2',
          'actions',
        ],
      },
      nameInput: {
        type: 'Input',
        props: {
          label: 'Full Name',
          name: 'name',
          type: 'text',
          placeholder: 'Your name',
          value: 'Ada Lovelace',
        },
        children: [],
      },
      emailInput: {
        type: 'Input',
        props: {
          label: 'Email',
          name: 'email',
          type: 'email',
          placeholder: 'you@example.com',
          value: 'ada@example.com',
        },
        children: [],
      },
      roleSelect: {
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
      separator1: {
        type: 'Separator',
        props: { orientation: 'horizontal' },
        children: [],
      },
      notificationSwitch: {
        type: 'Switch',
        props: {
          label: 'Email notifications',
          name: 'notifications',
          checked: true,
        },
        children: [],
      },
      darkModeSwitch: {
        type: 'Switch',
        props: {
          label: 'Dark mode',
          name: 'dark-mode',
          checked: true,
        },
        children: [],
      },
      separator2: {
        type: 'Separator',
        props: { orientation: 'horizontal' },
        children: [],
      },
      actions: {
        type: 'Stack',
        props: {
          direction: 'horizontal',
          gap: 'sm',
          align: 'center',
          justify: 'end',
        },
        children: ['cancelButton', 'saveButton'],
      },
      cancelButton: {
        type: 'Button',
        props: { label: 'Cancel', variant: 'secondary', disabled: false },
        children: [],
      },
      saveButton: {
        type: 'Button',
        props: { label: 'Save Changes', variant: 'primary', disabled: false },
        children: [],
      },
    },
  };
}

export function buildPricingTableSpec(): JsonRenderSpec {
  return {
    root: 'outer',
    elements: {
      outer: {
        type: 'Stack',
        props: {
          direction: 'vertical',
          gap: 'lg',
          align: 'stretch',
          justify: 'start',
        },
        children: ['header', 'grid'],
      },
      header: {
        type: 'Stack',
        props: {
          direction: 'vertical',
          gap: 'sm',
          align: 'center',
          justify: 'start',
        },
        children: ['title', 'subtitle'],
      },
      title: {
        type: 'Heading',
        props: { text: 'Simple, transparent pricing', level: 'h1' },
        children: [],
      },
      subtitle: {
        type: 'Text',
        props: {
          text: 'Choose the plan that fits your needs. Upgrade or downgrade at any time.',
          variant: 'muted',
        },
        children: [],
      },
      grid: {
        type: 'Grid',
        props: { columns: 3, gap: 'md' },
        children: ['freePlan', 'proPlan', 'enterprisePlan'],
      },
      freePlan: {
        type: 'Card',
        props: { title: 'Free', description: '$0/month', maxWidth: 'full', centered: false },
        children: ['freeContent'],
      },
      freeContent: {
        type: 'Stack',
        props: { direction: 'vertical', gap: 'sm', align: 'stretch', justify: 'start' },
        children: ['free1', 'free2', 'free3', 'freeButton'],
      },
      free1: { type: 'Text', props: { text: 'Up to 3 projects', variant: 'body' }, children: [] },
      free2: { type: 'Text', props: { text: '1 GB storage', variant: 'body' }, children: [] },
      free3: { type: 'Text', props: { text: 'Community support', variant: 'body' }, children: [] },
      freeButton: {
        type: 'Button',
        props: { label: 'Get Started', variant: 'secondary', disabled: false },
        children: [],
      },
      proPlan: {
        type: 'Card',
        props: { title: 'Pro', description: '$19/month', maxWidth: 'full', centered: false },
        children: ['proContent'],
      },
      proContent: {
        type: 'Stack',
        props: { direction: 'vertical', gap: 'sm', align: 'stretch', justify: 'start' },
        children: ['pro1', 'pro2', 'pro3', 'pro4', 'proButton'],
      },
      pro1: { type: 'Text', props: { text: 'Unlimited projects', variant: 'body' }, children: [] },
      pro2: { type: 'Text', props: { text: '50 GB storage', variant: 'body' }, children: [] },
      pro3: { type: 'Text', props: { text: 'Priority support', variant: 'body' }, children: [] },
      pro4: { type: 'Text', props: { text: 'Custom domains', variant: 'body' }, children: [] },
      proButton: {
        type: 'Button',
        props: { label: 'Upgrade to Pro', variant: 'primary', disabled: false },
        children: [],
      },
      enterprisePlan: {
        type: 'Card',
        props: { title: 'Enterprise', description: 'Custom pricing', maxWidth: 'full', centered: false },
        children: ['enterpriseContent'],
      },
      enterpriseContent: {
        type: 'Stack',
        props: { direction: 'vertical', gap: 'sm', align: 'stretch', justify: 'start' },
        children: ['enterprise1', 'enterprise2', 'enterprise3', 'enterprise4', 'enterpriseButton'],
      },
      enterprise1: { type: 'Text', props: { text: 'Everything in Pro', variant: 'body' }, children: [] },
      enterprise2: { type: 'Text', props: { text: 'Unlimited storage', variant: 'body' }, children: [] },
      enterprise3: { type: 'Text', props: { text: 'Dedicated support', variant: 'body' }, children: [] },
      enterprise4: { type: 'Text', props: { text: 'SLA guarantees', variant: 'body' }, children: [] },
      enterpriseButton: {
        type: 'Button',
        props: { label: 'Contact Sales', variant: 'secondary', disabled: false },
        children: [],
      },
    },
  };
}

export function buildEmbeddedChartsSpec(): JsonRenderSpec {
  return {
    root: 'card',
    elements: {
      card: {
        type: 'Card',
        props: {
          title: 'Embedded Charts Dashboard',
          description: 'Upstream-style analytics panels rendered directly inside a json-render node.',
          maxWidth: 'full',
          centered: false,
        },
        children: ['content'],
      },
      content: {
        type: 'Stack',
        props: { direction: 'vertical', gap: 'md', align: 'stretch', justify: 'start' },
        children: ['summaryGrid', 'separator', 'chartsGrid'],
      },
      summaryGrid: {
        type: 'Grid',
        props: { columns: 3, gap: 'md' },
        children: ['summaryLeadTime', 'summaryDefects', 'summaryLoad'],
      },
      summaryLeadTime: {
        type: 'Card',
        props: { title: 'Lead time', description: 'Median fell to 19h', maxWidth: 'full', centered: false },
        children: ['summaryLeadTimeBody'],
      },
      summaryLeadTimeBody: {
        type: 'Text',
        props: { text: 'Trend is improving for five straight weeks.', variant: 'muted' },
        children: [],
      },
      summaryDefects: {
        type: 'Card',
        props: { title: 'Defect pressure', description: 'Integration remains the main spike', maxWidth: 'full', centered: false },
        children: ['summaryDefectsBody'],
      },
      summaryDefectsBody: {
        type: 'Text',
        props: { text: 'UI smoke and canary remain comparatively stable.', variant: 'muted' },
        children: [],
      },
      summaryLoad: {
        type: 'Card',
        props: { title: 'Operational load', description: 'Platform still absorbs the largest share', maxWidth: 'full', centered: false },
        children: ['summaryLoadBody'],
      },
      summaryLoadBody: {
        type: 'Text',
        props: { text: 'Use this panel to compare chart rendering inside a single spec.', variant: 'muted' },
        children: [],
      },
      separator: {
        type: 'Separator',
        props: { orientation: 'horizontal' },
        children: [],
      },
      chartsGrid: {
        type: 'Grid',
        props: { columns: 1, gap: 'md' },
        children: ['leadChart', 'defectChart', 'loadChart'],
      },
      leadChart: {
        type: 'LineChart',
        props: {
          title: 'Lead Time Trend',
          data: weeklyMetrics.map((entry) => ({ week: entry.week, leadTimeHours: entry.leadTimeHours })),
          xKey: 'week',
          yKey: 'leadTimeHours',
          aggregate: null,
          color: '#e9c46a',
          height: 220,
        },
        children: [],
      },
      defectChart: {
        type: 'BarChart',
        props: {
          title: 'Defects by Stage',
          data: stageDefectCounts.map((entry) => ({ stage: entry.stage, defects: entry.defects })),
          xKey: 'stage',
          yKey: 'defects',
          aggregate: null,
          color: '#e76f51',
          height: 220,
        },
        children: [],
      },
      loadChart: {
        type: 'PieChart',
        props: {
          title: 'Operational Load by Team',
          data: ownershipLoad,
          nameKey: 'name',
          valueKey: 'value',
          height: 240,
        },
        children: [],
      },
    },
  };
}
