import type { JsonRenderSpec } from 'pmx-canvas';
import { componentRisks, gateRows } from './data';

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
