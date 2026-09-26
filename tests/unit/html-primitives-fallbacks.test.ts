import { describe, expect, test } from 'bun:test';
import { buildHtmlPrimitive, type HtmlPrimitiveKind } from '../../src/server/html-primitives.ts';

function html(kind: HtmlPrimitiveKind, data?: Record<string, unknown>): string {
  return buildHtmlPrimitive({ kind, ...(data ? { data } : {}) }).html;
}

describe('HTML primitive example fallbacks', () => {
  const emptyDocuments: Array<[HtmlPrimitiveKind, Record<string, unknown>]> = [
    ['choice-grid', { items: [] }],
    ['plan-timeline', { milestones: [], flow: [], risks: [], snippets: [] }],
    ['review-sheet', { findings: [], files: [], diff: '' }],
    ['pr-writeup', { summary: '', why: '', before: [], after: [], files: [], reviewFocus: [], tests: [], rollout: [] }],
    ['system-map', { entryPoints: [], modules: [], edges: [] }],
    ['code-walkthrough', { summary: '', modules: [], edges: [], steps: [], keyFiles: [], gotchas: [] }],
    ['design-sheet', { directions: [], tokens: [] }],
    ['component-gallery', { component: '', variants: [] }],
    ['interaction-prototype', { scenario: '', screens: [], controls: [], annotations: [], questions: [], snippet: '' }],
    ['flowchart', { steps: [], failurePaths: [] }],
    ['illustration-set', { figures: [] }],
    ['deck', { slides: [] }],
    ['presentation', { slides: [], subtitle: '' }],
    ['explainer', { summary: '', steps: [], snippets: [], faq: [], glossary: [] }],
    ['status-report', { metrics: [], shipped: [], slipped: [], risks: [], next: [] }],
    ['incident-report', { impact: [], summary: '', timeline: [], rootCause: '', logs: '', actions: [] }],
    ['triage-board', { columns: [], items: [] }],
    ['config-editor', { flags: [] }],
    ['prompt-tuner', { template: '', samples: [] }],
    ['ax-flow', { steps: [], note: '' }],
  ];

  test.each(emptyDocuments)('%s omits empty document sections, not just sample text', (kind, data) => {
    const markup = html(kind, data).split('<body>')[1]!.split('<script')[0]!;
    expect(markup).not.toContain('<section');
    expect(markup).not.toContain('<h2');
    expect(markup).not.toContain('data-copy-diff');
    expect(markup).not.toContain('data-copy-markdown');
  });

  test('empty fields suppress only their own section; omitted fields still use examples', () => {
    const output = html('status-report', { shipped: [], slipped: null, risks: '', next: ['Ship verified change'] });
    expect(output).not.toContain('<h2>Shipped</h2>');
    expect(output).not.toContain('<h2>Slipped</h2>');
    expect(output).not.toContain('<h2>Risks</h2>');
    expect(output).toContain('<h2>Next</h2>');
    expect(output).toContain('Ship verified change');
    expect(output).toContain('on track');
    expect(html('prompt-tuner', { samples: [] })).toContain('id="template"');
    expect(html('prompt-tuner', { samples: [] })).not.toContain('<h2>Live Samples</h2>');
  });

  test('nested empty lists and explicit null text do not resurrect labels or samples', () => {
    const output = html('choice-grid', { items: [{ title: 'Kept option', summary: null, pros: [], cons: [] }] });
    expect(output).toContain('Kept option');
    expect(output).not.toContain('<h3>Pros</h3>');
    expect(output).not.toContain('<h3>Cons</h3>');
    expect(output).not.toContain('Summarize the approach here.');
    expect(html('ax-board', { note: '' })).not.toContain('Tasks you add here go straight');
    expect(html('ax-board', { note: '' })).toContain('id="ax-add-task"');
  });

  test.each([
    ['choice-grid', 'Option A'],
    ['plan-timeline', 'Understand current flow'],
    ['component-gallery', 'Primary'],
    ['flowchart', 'Receive request'],
  ] as const)('%s uses examples only when its primary collection is absent', (kind, example) => {
    expect(html(kind)).toContain(example);
  });

  test('choice-grid respects explicitly empty items', () => {
    expect(html('choice-grid', { items: [] })).not.toContain('Option A');
  });

  test('plan-timeline respects each explicitly empty section', () => {
    const output = html('plan-timeline', { milestones: [], flow: [], risks: [], snippets: [] });
    expect(output).not.toContain('Understand current flow');
    expect(output).not.toContain('<h2>Milestones</h2>');
    expect(output).not.toContain('<h2>Data Flow</h2>');
    expect(output).not.toContain('<h2 style="margin-top:18px">Risks</h2>');
  });

  test.each(['', '  ', null])('component-gallery respects empty component %j and variants', (component) => {
    const output = html('component-gallery', { component, variants: [] });
    expect(output).not.toContain('Variant contact sheet');
    expect(output).not.toContain('Primary');
  });

  test('flowchart respects explicitly empty steps and failure paths', () => {
    const output = html('flowchart', { steps: [], failurePaths: [] });
    expect(output).not.toContain('Receive request');
    expect(output).not.toContain('id="step-title"');
    expect(output).not.toContain('<h2>Failure Paths</h2>');
  });

  test('status report follows the same absent-versus-empty rule', () => {
    expect(html('status-report', { metrics: [] })).not.toContain('on track');
  });

  test('triage board follows the same absent-versus-empty rule', () => {
    expect(html('triage-board', { columns: [], items: [] })).not.toContain('Clarify requirements');
  });

  test('illustration set follows the same absent-versus-empty rule', () => {
    expect(html('illustration-set', { figures: [] })).not.toContain('System Loop');
  });
});
