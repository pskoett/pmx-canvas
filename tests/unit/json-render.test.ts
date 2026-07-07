import { describe, expect, test } from 'bun:test';
import {
  applyJsonRenderStreamPatches,
  buildGraphSpec,
  emptyStreamingSpec,
  normalizeAndValidateJsonRenderSpec,
  normalizeGraphType,
} from '../../src/json-render/server.ts';

describe('json-render validation', () => {
  test('rejects specs without root and elements', () => {
    expect(() => normalizeAndValidateJsonRenderSpec({})).toThrow('Missing root and elements in spec.');
  });

  test('validates a spec whose elements have no `on` bindings (on is optional)', () => {
    // Most elements have no event bindings. The schema requires `on`, so
    // normalization must default it — a spec that omits `on` must still validate.
    const spec = normalizeAndValidateJsonRenderSpec({
      root: 'card',
      elements: {
        card: { type: 'Card', props: { title: 'No actions' }, children: ['t'] },
        t: { type: 'Text', props: { text: 'plain' }, children: [] },
      },
    });
    expect(spec.elements.card.on).toEqual({});
    expect(spec.elements.t.on).toEqual({});
  });

  test('preserves an authored `on` binding through validation', () => {
    const spec = normalizeAndValidateJsonRenderSpec({
      root: 'card',
      elements: {
        card: {
          type: 'Card',
          props: { title: 'Actionable' },
          on: { press: { action: 'ax.work.create', params: { title: 'X' } } },
          children: [],
        },
      },
    });
    expect((spec.elements.card.on as Record<string, unknown>).press).toBeDefined();
  });

  test('rejects an unknown $-keyed directive instead of rendering "[object Object]"', () => {
    expect(() =>
      normalizeAndValidateJsonRenderSpec({
        root: 'h',
        elements: {
          h: { type: 'Heading', props: { text: { $path: '/title' } }, children: [] },
        },
      }),
    ).toThrow(/Unknown directive "\$path"/);
    expect(() =>
      normalizeAndValidateJsonRenderSpec({
        root: 'h',
        elements: {
          h: { type: 'Heading', props: { text: { $path: '/title' } }, children: [] },
        },
      }),
    ).toThrow(/"\$state"/);
  });

  test('still accepts recognized directives and $state bindings', () => {
    const spec = normalizeAndValidateJsonRenderSpec({
      root: 'card',
      elements: {
        card: {
          type: 'Card',
          props: {
            title: { $state: '/title' },
            description: { $format: 'currency', value: 5 },
          },
          children: [],
        },
      },
    });
    expect((spec.elements.card?.props as Record<string, unknown>).title).toEqual({ $state: '/title' });
    expect((spec.elements.card?.props as Record<string, unknown>).description).toEqual({
      $format: 'currency',
      value: 5,
    });
  });

  test('accepts minimal valid specs', () => {
    const spec = normalizeAndValidateJsonRenderSpec({
      root: 'card',
      elements: {
        card: {
          type: 'Card',
          props: {
            title: 'Test card',
          },
          children: [],
        },
      },
    });

    expect(spec.root).toBe('card');
    expect(Object.keys(spec.elements)).toEqual(['card']);
    expect(spec.elements.card?.visible).toBe(true);
  });

  test('normalizes common element aliases and cleans non-string children', () => {
    const spec = normalizeAndValidateJsonRenderSpec({
      root: 'panel',
      elements: {
        panel: {
          type: 'Panel',
          props: {
            title: 'Alias card',
            description: null,
            maxWidth: 'full',
            centered: false,
          },
          children: ['copy', 123, null],
        },
        copy: {
          type: 'Text',
          props: {
            text: 'Hello',
          },
          children: [],
        },
      },
    });

    expect(spec.elements.panel?.type).toBe('Card');
    expect(spec.elements.panel?.children).toEqual(['copy']);
    expect((spec.elements.panel?.props as Record<string, unknown>).description).toBeUndefined();
  });

  test('normalizes legacy Badge label and status variants', () => {
    const spec = normalizeAndValidateJsonRenderSpec({
      root: 'card',
      elements: {
        card: {
          type: 'Card',
          props: {
            title: 'Legacy badge',
          },
          children: ['healthy', 'info', 'warning', 'error', 'danger'],
        },
        healthy: {
          type: 'Badge',
          props: {
            label: 'Healthy',
            variant: 'success',
          },
        },
        info: {
          type: 'Badge',
          props: {
            label: 'Heads up',
            variant: 'info',
          },
        },
        warning: {
          type: 'Badge',
          props: {
            label: 'Attention',
            variant: 'warning',
          },
        },
        error: {
          type: 'Badge',
          props: {
            label: 'Build broken',
            variant: 'error',
          },
        },
        danger: {
          type: 'Badge',
          props: {
            text: 'Blocked',
            variant: 'danger',
          },
        },
      },
    });

    expect(spec.elements.healthy?.props).toEqual(
      expect.objectContaining({
        text: 'Healthy',
        variant: 'success',
      }),
    );
    expect(spec.elements.info?.props).toEqual(
      expect.objectContaining({
        text: 'Heads up',
        variant: 'info',
      }),
    );
    expect(spec.elements.warning?.props).toEqual(
      expect.objectContaining({
        text: 'Attention',
        variant: 'warning',
      }),
    );
    expect(spec.elements.error?.props).toEqual(
      expect.objectContaining({
        text: 'Build broken',
        variant: 'error',
      }),
    );
    expect(spec.elements.danger?.props).toEqual(
      expect.objectContaining({
        text: 'Blocked',
        variant: 'danger',
      }),
    );

    // After normalization the legacy `label` key must be gone — the spec
    // should carry exactly one of `text` or `label`, never both.
    for (const key of ['healthy', 'info', 'warning', 'error', 'danger'] as const) {
      const props = spec.elements[key]?.props as Record<string, unknown>;
      expect('label' in props).toBe(false);
    }
  });

  test('wraps bare component specs for legacy callers', () => {
    const normalized = normalizeAndValidateJsonRenderSpec({
      type: 'Badge',
      props: { label: 'Legacy Badge', variant: 'success' },
    });

    expect(normalized.root).toBe('root');
    expect(normalized.elements.root).toEqual(
      expect.objectContaining({
        type: 'Badge',
        props: expect.objectContaining({
          text: 'Legacy Badge',
          variant: 'success',
        }),
        visible: true,
        children: [],
      }),
    );
    expect((normalized.elements.root as { props?: Record<string, unknown> }).props).not.toHaveProperty('label');
  });
});

describe('graph builder', () => {
  test('resolves aliases for the new chart types', () => {
    expect(normalizeGraphType('area')).toBe('AreaChart');
    expect(normalizeGraphType('Scatter Plot')).toBe('ScatterChart');
    expect(normalizeGraphType('radar')).toBe('RadarChart');
    expect(normalizeGraphType('stacked-bar')).toBe('StackedBarChart');
    expect(normalizeGraphType('combo')).toBe('ComposedChart');
  });

  test('builds a radar spec inferring metrics from data', () => {
    const spec = buildGraphSpec({
      graphType: 'radar',
      data: [
        { axis: 'Speed', a: 10, b: 20 },
        { axis: 'Power', a: 30, b: 40 },
      ],
    });

    const chart = spec.elements.chart as { type: string; props: Record<string, unknown> };
    expect(chart.type).toBe('RadarChart');
    expect(chart.props.axisKey).toBe('axis');
    expect(chart.props.metrics).toEqual(['a', 'b']);
    expect(chart.props.showLegend).toBe(true);
  });

  test('builds compact graph specs that can hide legends and pie labels', () => {
    const pie = buildGraphSpec({
      graphType: 'pie',
      data: [{ name: 'A', value: 25 }],
      showLegend: false,
      showLabels: false,
    });
    const pieChart = pie.elements.chart as { props: Record<string, unknown> };
    expect(pieChart.props.showLegend).toBe(false);
    expect(pieChart.props.showLabels).toBe(false);

    const stacked = buildGraphSpec({
      graphType: 'stacked-bar',
      xKey: 'quarter',
      data: [{ quarter: 'Q1', north: 1, south: 2 }],
      showLegend: false,
    });
    const stackedChart = stacked.elements.chart as { props: Record<string, unknown> };
    expect(stackedChart.props.showLegend).toBe(false);
  });

  test('omits graph chart height unless explicitly provided', () => {
    const autoSized = buildGraphSpec({
      graphType: 'pie',
      data: [{ name: 'A', value: 25 }],
    });
    const autoSizedChart = autoSized.elements.chart as { props: Record<string, unknown> };
    expect(autoSizedChart.props).not.toHaveProperty('height');

    const fixedHeight = buildGraphSpec({
      graphType: 'pie',
      data: [{ name: 'A', value: 25 }],
      height: 280,
    });
    const fixedHeightChart = fixedHeight.elements.chart as { props: Record<string, unknown> };
    expect(fixedHeightChart.props.height).toBe(280);
  });

  test('builds a stacked-bar spec inferring series from data', () => {
    const spec = buildGraphSpec({
      graphType: 'stacked-bar',
      xKey: 'quarter',
      data: [
        { quarter: 'Q1', north: 1, south: 2 },
        { quarter: 'Q2', north: 3, south: 4 },
      ],
    });

    const chart = spec.elements.chart as { type: string; props: Record<string, unknown> };
    expect(chart.type).toBe('StackedBarChart');
    expect(chart.props.series).toEqual(['north', 'south']);
  });

  test('builds a composed spec with bar + line keys', () => {
    const spec = buildGraphSpec({
      graphType: 'composed',
      xKey: 'day',
      barKey: 'visits',
      lineKey: 'conversion',
      data: [{ day: 'Mon', visits: 100, conversion: 4.5 }],
    });

    const chart = spec.elements.chart as { type: string; props: Record<string, unknown> };
    expect(chart.type).toBe('ComposedChart');
    expect(chart.props.barKey).toBe('visits');
    expect(chart.props.lineKey).toBe('conversion');
  });

  test('scatter spec includes optional zKey', () => {
    const spec = buildGraphSpec({
      graphType: 'scatter',
      xKey: 'size',
      yKey: 'latency',
      zKey: 'weight',
      data: [{ size: 1, latency: 2, weight: 3 }],
    });

    const chart = spec.elements.chart as { type: string; props: Record<string, unknown> };
    expect(chart.type).toBe('ScatterChart');
    expect(chart.props.zKey).toBe('weight');
  });
});

describe('Tufte chart types', () => {
  test('resolves Tufte aliases', () => {
    expect(normalizeGraphType('spark')).toBe('Sparkline');
    expect(normalizeGraphType('sparkline')).toBe('Sparkline');
    expect(normalizeGraphType('slope')).toBe('Slopegraph');
    expect(normalizeGraphType('slopegraph')).toBe('Slopegraph');
  });

  test('builds a Sparkline spec', () => {
    const spec = buildGraphSpec({
      graphType: 'sparkline',
      xKey: 't',
      yKey: 'v',
      data: [
        { t: 1, v: 10 },
        { t: 2, v: 14 },
        { t: 3, v: 9 },
      ],
    });
    const chart = spec.elements.chart as { type: string; props: Record<string, unknown> };
    expect(chart.type).toBe('Sparkline');
  });

  test('builds a Slopegraph spec', () => {
    const spec = buildGraphSpec({
      graphType: 'slopegraph',
      data: [
        { label: 'A', before: 30, after: 48 },
        { label: 'B', before: 42, after: 40 },
      ],
    });
    const chart = spec.elements.chart as { type: string; props: Record<string, unknown> };
    expect(chart.type).toBe('Slopegraph');
  });

  test('BulletChart accepts the conventional "actual" measure key', () => {
    // Explicit "value" column still resolves to value.
    const withValue = buildGraphSpec({
      graphType: 'bullet',
      labelKey: 'label',
      targetKey: 'target',
      data: [{ label: 'Revenue', value: 275, target: 250 }],
    });
    expect((withValue.elements.chart as { props: Record<string, unknown> }).props.valueKey).toBe('value');

    // Data using "actual" (no explicit valueKey) now resolves to actual instead
    // of failing the data-key-mismatch check on a default of "value".
    const withActual = buildGraphSpec({
      graphType: 'bullet',
      labelKey: 'label',
      targetKey: 'target',
      data: [{ label: 'Revenue', actual: 275, target: 250 }],
    });
    const chart = withActual.elements.chart as { type: string; props: Record<string, unknown> };
    expect(chart.type).toBe('BulletChart');
    expect(chart.props.valueKey).toBe('actual');
  });
});

describe('json-render SpecStream', () => {
  test('applies add patches and accumulates the spec', () => {
    const spec = emptyStreamingSpec();
    const r1 = applyJsonRenderStreamPatches(spec, [
      { op: 'add', path: '/root', value: 'card' },
      { op: 'add', path: '/elements/card', value: { type: 'Card', props: { title: 'Live' }, children: [] } },
    ]);
    expect(r1.applied).toBe(2);
    expect(r1.skipped).toBe(0);
    expect((r1.spec as { root: string }).root).toBe('card');
    expect(Object.keys((r1.spec as { elements: Record<string, unknown> }).elements)).toContain('card');
  });

  test('skips malformed items without throwing', () => {
    const r = applyJsonRenderStreamPatches(emptyStreamingSpec(), ['not json', 42, { nope: true }]);
    expect(r.applied).toBe(0);
    expect(r.skipped).toBe(3);
  });

  test('rejects prototype-pollution paths and does not pollute Object.prototype', () => {
    const before = ({} as Record<string, unknown>).polluted;
    const r = applyJsonRenderStreamPatches(emptyStreamingSpec(), [
      { op: 'add', path: '/__proto__/polluted', value: true },
      { op: 'add', path: '/constructor/prototype/polluted', value: true },
      { op: 'add', path: '/elements/~0proto/x', value: 1 },
    ]);
    // All three are unsafe (the third decodes to a literal segment that is fine,
    // but the first two must be skipped). Critically, Object.prototype is clean.
    expect(({} as Record<string, unknown>).polluted).toBe(before);
    expect(Object.hasOwn(Object.prototype, 'polluted')).toBe(false);
    // The two __proto__/constructor patches are skipped.
    expect(r.skipped).toBeGreaterThanOrEqual(2);
  });
});
