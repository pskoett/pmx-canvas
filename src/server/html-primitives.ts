export const HTML_PRIMITIVE_KINDS = [
  'choice-grid',
  'plan-timeline',
  'review-sheet',
  'pr-writeup',
  'system-map',
  'code-walkthrough',
  'design-sheet',
  'component-gallery',
  'interaction-prototype',
  'flowchart',
  'deck',
  'presentation',
  'illustration-set',
  'explainer',
  'status-report',
  'incident-report',
  'triage-board',
  'config-editor',
  'prompt-tuner',
] as const;

export type HtmlPrimitiveKind = (typeof HTML_PRIMITIVE_KINDS)[number];

export interface HtmlPrimitiveDescriptor {
  kind: HtmlPrimitiveKind;
  title: string;
  description: string;
  useWhen: string;
  defaultSize: { width: number; height: number };
  dataShape: string;
  example: Record<string, unknown>;
}

export interface HtmlPrimitiveInput {
  kind: HtmlPrimitiveKind;
  title?: string;
  data?: Record<string, unknown>;
}

export interface HtmlPrimitiveBuildResult {
  kind: HtmlPrimitiveKind;
  title: string;
  html: string;
  summary: string;
  defaultSize: { width: number; height: number };
  data: Record<string, unknown>;
}

export interface HtmlPrimitiveSemanticMetadata {
  presentation?: true;
  slideCount?: number;
  slideTitles?: string[];
  speakerNotes?: string[];
  presentationTheme?: string | Record<string, string>;
}

type PrimitiveRenderer = (input: {
  title: string;
  data: Record<string, unknown>;
  descriptor: HtmlPrimitiveDescriptor;
}) => string;

const DESCRIPTORS: HtmlPrimitiveDescriptor[] = [
  {
    kind: 'choice-grid',
    title: 'Choice Grid',
    description: 'Side-by-side options with tradeoffs, pros, cons, and code or evidence snippets.',
    useWhen: 'Use for code approaches, product directions, visual explorations, and decision comparisons.',
    defaultSize: { width: 980, height: 720 },
    dataShape: '{ items: [{ title, summary, tradeoff, pros: string[], cons: string[], code? }] }',
    example: {
      kind: 'choice-grid',
      title: 'Implementation Options',
      data: {
        items: [
          {
            title: 'Small patch',
            summary: 'Least disruption.',
            tradeoff: 'Limited future flexibility.',
            pros: ['Fast'],
            cons: ['May need follow-up'],
          },
        ],
      },
    },
  },
  {
    kind: 'plan-timeline',
    title: 'Plan Timeline',
    description: 'Implementation plan with milestones, data flow, code checkpoints, and risks.',
    useWhen: 'Use when a markdown plan would be long and the human needs sequence, dependencies, and risk at a glance.',
    defaultSize: { width: 1040, height: 760 },
    dataShape:
      '{ milestones: [{ title, detail, status }], flow: [{ from, to, label }], risks: [{ risk, mitigation }], snippets: [{ label, code }] }',
    example: {
      kind: 'plan-timeline',
      title: 'Feature Plan',
      data: {
        milestones: [{ title: 'Trace current flow', detail: 'Map server to client path.', status: 'done' }],
        risks: [{ risk: 'Schema drift', mitigation: 'Add tests at each boundary.' }],
      },
    },
  },
  {
    kind: 'review-sheet',
    title: 'Review Sheet',
    description: 'Annotated PR/code review sheet with severity-colored findings and diff excerpts.',
    useWhen: 'Use for reviewing a change, explaining a PR, or teaching a risky code path.',
    defaultSize: { width: 1040, height: 760 },
    dataShape: '{ findings: [{ severity, title, file, line, detail }], files: [{ path, why }], diff?: string }',
    example: {
      kind: 'review-sheet',
      title: 'Streaming Review',
      data: {
        findings: [
          {
            severity: 'warning',
            title: 'Backpressure boundary',
            file: 'src/server.ts',
            line: 42,
            detail: 'Confirm queue flush before close.',
          },
        ],
      },
    },
  },
  {
    kind: 'pr-writeup',
    title: 'PR Writeup',
    description: 'Reviewer-ready PR narrative with motivation, before/after, file tour, test plan, and rollout notes.',
    useWhen: 'Use when a change needs a high-signal review guide rather than a flat pull request description.',
    defaultSize: { width: 1040, height: 760 },
    dataShape:
      '{ summary, why, before: string[], after: string[], files: [{ path, why, focus }], reviewFocus: string[], tests: string[], rollout: string[] }',
    example: {
      kind: 'pr-writeup',
      title: 'HTML Primitive PR',
      data: {
        summary: 'Adds generated HTML primitives across HTTP, MCP, CLI, and SDK.',
        files: [
          {
            path: 'src/server/html-primitives.ts',
            why: 'Primitive catalog and renderers.',
            focus: 'Escaping and export behavior.',
          },
        ],
      },
    },
  },
  {
    kind: 'system-map',
    title: 'System Map',
    description: 'Module or architecture map with boxes, relationships, entry points, and hot paths.',
    useWhen: 'Use to explain unfamiliar packages, request flows, dependencies, or architecture at a glance.',
    defaultSize: { width: 1040, height: 720 },
    dataShape: '{ modules: [{ id, title, detail, role }], edges: [{ from, to, label }], entryPoints: string[] }',
    example: {
      kind: 'system-map',
      title: 'Canvas Server Map',
      data: {
        modules: [{ id: 'api', title: 'HTTP API', detail: 'Routes requests into canvas operations.', role: 'entry' }],
        edges: [{ from: 'api', to: 'state', label: 'mutates' }],
      },
    },
  },
  {
    kind: 'code-walkthrough',
    title: 'Code Walkthrough',
    description: 'Guided code-path map with modules, ordered file steps, snippets, key files, and gotchas.',
    useWhen:
      'Use to explain an unfamiliar package, request path, or implementation slice after inspecting source files.',
    defaultSize: { width: 1040, height: 760 },
    dataShape:
      '{ summary, modules: [{ id, title, detail, role }], edges: [{ from, to, label }], steps: [{ title, file, detail, code }], keyFiles: [{ path, description }], gotchas: string[] }',
    example: {
      kind: 'code-walkthrough',
      title: 'Canvas Creation Path',
      data: {
        modules: [{ id: 'api', title: 'HTTP API', detail: 'Receives node create requests.', role: 'entry' }],
        steps: [
          { title: 'Route request', file: 'src/server/server.ts', detail: 'Normalize input before mutating state.' },
        ],
      },
    },
  },
  {
    kind: 'design-sheet',
    title: 'Design Sheet',
    description: 'Visual design directions, tokens, swatches, type samples, and rationale.',
    useWhen: 'Use for design system reviews, style exploration, and visual option comparisons.',
    defaultSize: { width: 1040, height: 760 },
    dataShape: '{ directions: [{ title, tone, palette: string[], rationale }], tokens: [{ name, value }] }',
    example: {
      kind: 'design-sheet',
      title: 'Visual Directions',
      data: {
        directions: [
          {
            title: 'Editorial',
            tone: 'calm, high contrast',
            palette: ['#f8f1e7', '#16120f', '#d65a31'],
            rationale: 'Readable and opinionated.',
          },
        ],
      },
    },
  },
  {
    kind: 'component-gallery',
    title: 'Component Gallery',
    description: 'Contact sheet for component variants, states, sizes, and accessibility notes.',
    useWhen: 'Use to review button, card, form, or status component states in one browser-visible sheet.',
    defaultSize: { width: 980, height: 720 },
    dataShape: '{ component, variants: [{ label, state, intent, example, note }] }',
    example: {
      kind: 'component-gallery',
      title: 'Button Variants',
      data: {
        component: 'Button',
        variants: [{ label: 'Primary', state: 'default', intent: 'main action', example: 'Continue' }],
      },
    },
  },
  {
    kind: 'interaction-prototype',
    title: 'Interaction Prototype',
    description:
      'Throwaway interaction or motion sandbox with a live stage, controls, annotations, and copyable config.',
    useWhen:
      'Use for animation tuning, click-through sketches, draggable behavior studies, and interaction questions that prose cannot answer.',
    defaultSize: { width: 1040, height: 760 },
    dataShape:
      '{ scenario, controls: [{ key, label, value, min?, max?, unit? }], screens: [{ title, detail }], annotations: [{ title, detail }], questions: string[], snippet? }',
    example: {
      kind: 'interaction-prototype',
      title: 'Sidebar Motion Study',
      data: {
        scenario: 'Tune the collapse transition before wiring it into the app.',
        controls: [{ key: 'duration', label: 'Duration', value: 280, min: 100, max: 900, unit: 'ms' }],
      },
    },
  },
  {
    kind: 'flowchart',
    title: 'Flowchart',
    description: 'Clickable flowchart for pipelines, user journeys, process diagrams, and failure paths.',
    useWhen: 'Use when sequence, branching, timings, or failure states matter more than prose.',
    defaultSize: { width: 980, height: 700 },
    dataShape: '{ steps: [{ title, detail, status, duration }], failurePaths?: [{ from, label, detail }] }',
    example: {
      kind: 'flowchart',
      title: 'Deploy Flow',
      data: {
        steps: [{ title: 'Build', detail: 'Compile assets and run typecheck.', status: 'ok', duration: '45s' }],
      },
    },
  },
  {
    kind: 'deck',
    title: 'Slide Deck',
    description: 'Arrow-key HTML deck with sections, speaker notes, and copyable JSON payload.',
    useWhen: 'Use to turn a thread, report, or plan into a meeting-ready narrative.',
    defaultSize: { width: 960, height: 620 },
    dataShape: '{ slides: [{ title, kicker?, body?, bullets?: string[], note? }] }',
    example: {
      kind: 'deck',
      title: 'Project Update',
      data: {
        slides: [{ title: 'Why this matters', bullets: ['Less markdown fatigue', 'More reviewable decisions'] }],
      },
    },
  },
  {
    kind: 'presentation',
    title: 'HTML Presentation',
    description:
      'PowerPoint-style fullscreen-ready HTML presentation with slide navigation, progress, speaker notes, and presentation metadata.',
    useWhen:
      'Use when the human asks for a presentation, pitch deck, briefing, workshop walkthrough, or PowerPoint-like deliverable.',
    defaultSize: { width: 1120, height: 700 },
    dataShape:
      '{ subtitle?, theme?: "canvas"|"midnight"|"paper"|"aurora"|{ bg?, panel?, surface?, border?, text?, textSecondary?, textMuted?, accent? }, slides: [{ title, kicker?, body?, bullets?: string[], metrics?: [{ label, value, detail? }], note? }] }',
    example: {
      kind: 'presentation',
      title: 'Project Briefing',
      data: {
        subtitle: 'A meeting-ready narrative for review.',
        slides: [
          {
            title: 'Why this matters',
            kicker: '01',
            body: 'Frame the decision and outcome.',
            bullets: ['Human-readable', 'Fullscreen-ready'],
          },
          { title: 'What changes', kicker: '02', bullets: ['Show the before/after', 'End with clear next steps'] },
        ],
      },
    },
  },
  {
    kind: 'illustration-set',
    title: 'Illustration Set',
    description: 'Inline SVG figure sheet with captions and per-figure SVG copy/export controls.',
    useWhen:
      'Use for blog figures, architecture illustrations, conceptual diagrams, and vector sketches that should be tweakable or pasteable.',
    defaultSize: { width: 1040, height: 760 },
    dataShape:
      '{ figures: [{ title, caption, shapes: [{ type, x, y, width, height, cx, cy, r, x1, y1, x2, y2, text, color }] }] }',
    example: {
      kind: 'illustration-set',
      title: 'Article Figures',
      data: {
        figures: [
          {
            title: 'Feedback Loop',
            caption: 'Human and agent exchange context.',
            shapes: [{ type: 'rect', x: 40, y: 50, width: 130, height: 70, text: 'Human' }],
          },
        ],
      },
    },
  },
  {
    kind: 'explainer',
    title: 'Feature Explainer',
    description: 'Readable explainer with TLDR, collapsible steps, annotated snippets, FAQ, and glossary.',
    useWhen: 'Use to teach how a feature, algorithm, or code path works after inspecting repo context.',
    defaultSize: { width: 980, height: 760 },
    dataShape:
      '{ summary, steps: [{ title, detail }], snippets: [{ label, code, note }], faq: [{ q, a }], glossary: [{ term, definition }] }',
    example: {
      kind: 'explainer',
      title: 'Rate Limiter Explainer',
      data: {
        summary: 'Requests spend tokens from a bucket that refills over time.',
        steps: [{ title: 'Identify key', detail: 'The route derives a tenant/user key.' }],
      },
    },
  },
  {
    kind: 'incident-report',
    title: 'Incident Report',
    description:
      'Post-incident report with impact metrics, minute-by-minute timeline, root cause, log excerpts, and action checklist.',
    useWhen: 'Use for incident summaries, post-mortems, reliability reviews, and follow-up tracking.',
    defaultSize: { width: 1040, height: 760 },
    dataShape:
      '{ severity, status, duration, summary, impact: [{ label, value, tone }], timeline: [{ time, event, detail, tone }], rootCause, logs?: string, actions: [{ done, owner, description, due }] }',
    example: {
      kind: 'incident-report',
      title: 'API Latency Incident',
      data: {
        severity: 'SEV-2',
        summary: 'Elevated API latency after deploy.',
        timeline: [{ time: '10:04', event: 'Alert fired', detail: 'p95 latency crossed threshold.', tone: 'warn' }],
      },
    },
  },
  {
    kind: 'status-report',
    title: 'Status Report',
    description: 'Skimmable report with metrics, shipped/slipped lists, blockers, and next actions.',
    useWhen: 'Use for weekly updates, project health, incident summaries, and leadership-ready status.',
    defaultSize: { width: 980, height: 720 },
    dataShape:
      '{ metrics: [{ label, value, tone }], shipped: string[], slipped: string[], risks: string[], next: string[] }',
    example: {
      kind: 'status-report',
      title: 'Weekly Canvas Status',
      data: {
        metrics: [{ label: 'Tests', value: 'green', tone: 'ok' }],
        shipped: ['HTML primitive endpoint'],
      },
    },
  },
  {
    kind: 'triage-board',
    title: 'Triage Board',
    description: 'Draggable Now/Next/Later/Cut board with copy-as-markdown export.',
    useWhen: 'Use when a human needs to reorder, bucket, approve, or cut items and send the result back to the agent.',
    defaultSize: { width: 1040, height: 760 },
    dataShape: '{ columns?: string[], items: [{ title, detail, column, rationale }] }',
    example: {
      kind: 'triage-board',
      title: 'Ticket Triage',
      data: {
        items: [
          {
            title: 'Fix flaky smoke test',
            detail: 'Fails on CI timeout.',
            column: 'Now',
            rationale: 'Blocks release.',
          },
        ],
      },
    },
  },
  {
    kind: 'config-editor',
    title: 'Config Editor',
    description: 'Form-like editor for flags or structured config with dependency warnings and copy-diff export.',
    useWhen: 'Use for feature flags, environment settings, structured JSON/YAML choices, and constraint-aware edits.',
    defaultSize: { width: 980, height: 720 },
    dataShape: '{ flags: [{ key, label, area, enabled, requires?: string[], description }] }',
    example: {
      kind: 'config-editor',
      title: 'Feature Flags',
      data: {
        flags: [
          { key: 'newCheckout', label: 'New checkout', area: 'Checkout', enabled: false, requires: ['paymentsV2'] },
        ],
      },
    },
  },
  {
    kind: 'prompt-tuner',
    title: 'Prompt Tuner',
    description: 'Side-by-side prompt/template editor with live variable previews and copy export.',
    useWhen: 'Use to tune prompts, copy, templates, examples, and variable slots with human-in-the-loop feedback.',
    defaultSize: { width: 1040, height: 760 },
    dataShape: '{ template: string, samples: [{ name, variables: Record<string,string> }] }',
    example: {
      kind: 'prompt-tuner',
      title: 'Prompt Tuner',
      data: {
        template: 'Explain {{feature}} for {{audience}}.',
        samples: [{ name: 'Engineering', variables: { feature: 'canvas pins', audience: 'backend engineers' } }],
      },
    },
  },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function text(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fallback;
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => text(item).trim()).filter(Boolean);
}

function fieldRecords(
  data: Record<string, unknown>,
  key: string,
  fallback: Record<string, unknown>[],
): Record<string, unknown>[] {
  const found = records(data[key]);
  return found.length > 0 ? found : fallback;
}

const DEFAULT_DECK_SLIDES: Record<string, unknown>[] = [
  {
    title: 'HTML keeps humans in the loop',
    kicker: 'Thesis',
    bullets: ['Higher information density', 'Visual clarity', 'Two-way interaction'],
  },
  {
    title: 'Use the lightest tier that works',
    bullets: [
      'json-render for structured UI',
      'html primitives for rich documents',
      'web artifacts for full React apps',
    ],
  },
];

const DEFAULT_PRESENTATION_SLIDES: Record<string, unknown>[] = [
  {
    title: 'Set the frame',
    kicker: '01',
    body: 'Open with the decision, audience, and outcome this presentation supports.',
  },
  {
    title: 'Show the evidence',
    kicker: '02',
    bullets: ['Use concrete facts', 'Keep one idea per slide', 'Make risks visible'],
  },
  { title: 'Close with action', kicker: '03', bullets: ['Decision needed', 'Owner and next step', 'Timing'] },
];

function presentationSlides(
  data: Record<string, unknown>,
  fallback = DEFAULT_PRESENTATION_SLIDES,
): Record<string, unknown>[] {
  return fieldRecords(data, 'slides', fallback);
}

function enrichPresentationData(kind: HtmlPrimitiveKind, data: Record<string, unknown>): Record<string, unknown> {
  if (kind !== 'deck' && kind !== 'presentation') return data;
  const slides = presentationSlides(data, kind === 'deck' ? DEFAULT_DECK_SLIDES : DEFAULT_PRESENTATION_SLIDES);
  const slideTitles = slides.map((slide, index) => itemTitle(slide, `Slide ${index + 1}`));
  const speakerNotes = slides.map((slide) => text(slide.note).trim()).filter(Boolean);
  const theme = kind === 'presentation' ? presentationThemeMetadata(data) : undefined;
  return {
    ...data,
    slides,
    presentation: true,
    slideCount: slides.length,
    slideTitles,
    ...(speakerNotes.length > 0 ? { speakerNotes } : {}),
    ...(theme !== undefined ? { presentationTheme: theme } : {}),
  };
}

function fieldStrings(data: Record<string, unknown>, key: string, fallback: string[]): string[] {
  const found = strings(data[key]);
  return found.length > 0 ? found : fallback;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function safeCssColor(value: string): string {
  const trimmed = value.trim();
  if (/^var\(--[a-z0-9-]+\)$/i.test(trimmed)) return trimmed;
  if (/^#[0-9a-f]{3,8}$/i.test(trimmed)) return trimmed;
  if (/^(?:rgb|hsl)a?\([\d\s.,%+-]+\)$/i.test(trimmed)) return trimmed;
  return 'transparent';
}

type PresentationThemeName = 'canvas' | 'midnight' | 'paper' | 'aurora';

interface PresentationThemeTokens {
  name: PresentationThemeName | 'custom';
  bg: string;
  panel: string;
  surface: string;
  border: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  accent: string;
  colorScheme: string;
}

const PRESENTATION_THEMES: Record<PresentationThemeName, PresentationThemeTokens> = {
  canvas: {
    name: 'canvas',
    bg: 'var(--color-bg, #081524)',
    panel: 'var(--color-panel, #0f1d31)',
    surface: 'var(--color-surface, #10213a)',
    border: 'var(--color-border, #1b2c44)',
    text: 'var(--color-text, #e6eef7)',
    textSecondary: 'var(--color-text-secondary, #c7d3ea)',
    textMuted: 'var(--color-text-muted, #8ea3bd)',
    accent: 'var(--color-accent, #4BBCFF)',
    colorScheme: 'dark light',
  },
  midnight: {
    name: 'midnight',
    bg: '#081524',
    panel: '#0f1d31',
    surface: '#10213a',
    border: '#1b2c44',
    text: '#e6eef7',
    textSecondary: '#c7d3ea',
    textMuted: '#8ea3bd',
    accent: '#4BBCFF',
    colorScheme: 'dark',
  },
  paper: {
    name: 'paper',
    bg: '#F4EFE6',
    panel: '#EFE7D4',
    surface: '#FAF6EE',
    border: '#D6CBB4',
    text: '#081524',
    textSecondary: '#3d4d63',
    textMuted: '#5c6b80',
    accent: '#1A7ABF',
    colorScheme: 'light',
  },
  aurora: {
    name: 'aurora',
    bg: '#090f1f',
    panel: '#101a32',
    surface: '#12263b',
    border: '#24415f',
    text: '#f5fbff',
    textSecondary: '#d5e8f7',
    textMuted: '#95adc2',
    accent: '#8cffd2',
    colorScheme: 'dark',
  },
};

function isPresentationThemeName(value: string): value is PresentationThemeName {
  return value === 'canvas' || value === 'midnight' || value === 'paper' || value === 'aurora';
}

function parsePresentationThemeName(value: string, field = 'theme'): PresentationThemeName {
  if (isPresentationThemeName(value)) return value;
  throw new Error(
    `Invalid presentation ${field} "${value}". Use canvas, midnight, paper, aurora, or a custom theme object.`,
  );
}

function presentationTheme(data: Record<string, unknown>): PresentationThemeTokens {
  const raw = data.theme ?? data.presentationTheme;
  if (typeof raw === 'string') {
    return PRESENTATION_THEMES[parsePresentationThemeName(raw)];
  }
  if (!isRecord(raw)) return PRESENTATION_THEMES.canvas;
  const baseName = typeof raw.base === 'string' ? parsePresentationThemeName(raw.base, 'theme base') : 'canvas';
  const base = PRESENTATION_THEMES[baseName];
  const readColor = (key: string, fallback: string): string => {
    const value = text(raw[key]);
    if (!value) return fallback;
    const color = safeCssColor(value);
    return color === 'transparent' ? fallback : color;
  };
  const colorScheme = raw.colorScheme === 'light' ? 'light' : raw.colorScheme === 'dark' ? 'dark' : base.colorScheme;
  return {
    name: 'custom',
    bg: readColor('bg', base.bg),
    panel: readColor('panel', base.panel),
    surface: readColor('surface', base.surface),
    border: readColor('border', base.border),
    text: readColor('text', base.text),
    textSecondary: readColor('textSecondary', base.textSecondary),
    textMuted: readColor('textMuted', base.textMuted),
    accent: readColor('accent', base.accent),
    colorScheme,
  };
}

function presentationThemeMetadata(data: Record<string, unknown>): string | Record<string, string> | undefined {
  const raw = data.theme ?? data.presentationTheme;
  if (typeof raw === 'string') return parsePresentationThemeName(raw);
  if (!isRecord(raw)) return undefined;
  if (typeof raw.base === 'string') parsePresentationThemeName(raw.base, 'theme base');
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'string') result[key] = value;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function number(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function inlineSvgShape(shape: Record<string, unknown>, index: number): string {
  const color = safeCssColor(text(shape.color, '#4a9eff'));
  const label = text(shape.text, text(shape.label));
  const labelText = label
    ? `<text x="${number(shape.x, number(shape.cx, 80)) + 12}" y="${number(shape.y, number(shape.cy, 80)) + 28}" fill="var(--color-text, #e8edf2)" font-size="13" font-weight="700">${escapeHtml(label)}</text>`
    : '';
  switch (text(shape.type, 'rect')) {
    case 'circle':
      return `<circle cx="${number(shape.cx, 80 + index * 40)}" cy="${number(shape.cy, 80)}" r="${number(shape.r, 32)}" fill="${color}" opacity="0.22" stroke="${color}" stroke-width="2" />${label ? `<text x="${number(shape.cx, 80 + index * 40)}" y="${number(shape.cy, 80) + 4}" text-anchor="middle" fill="var(--color-text, #e8edf2)" font-size="13" font-weight="700">${escapeHtml(label)}</text>` : ''}`;
    case 'line':
    case 'arrow':
      return `<line x1="${number(shape.x1, 40)}" y1="${number(shape.y1, 40 + index * 30)}" x2="${number(shape.x2, 220)}" y2="${number(shape.y2, 40 + index * 30)}" stroke="${color}" stroke-width="2.5" stroke-linecap="round" ${text(shape.type) === 'arrow' ? 'marker-end="url(#arrow)"' : ''}/>`;
    case 'text':
      return `<text x="${number(shape.x, 40)}" y="${number(shape.y, 60 + index * 24)}" fill="var(--color-text, #e8edf2)" font-size="15" font-weight="700">${escapeHtml(label || `Label ${index + 1}`)}</text>`;
    default:
      return `<rect x="${number(shape.x, 40 + index * 24)}" y="${number(shape.y, 50 + index * 18)}" width="${number(shape.width, 150)}" height="${number(shape.height, 70)}" rx="14" fill="${color}" opacity="0.18" stroke="${color}" stroke-width="2" />${labelText}`;
  }
}

function safeJson(value: unknown): string {
  return (JSON.stringify(value ?? {}, null, 2) ?? '{}')
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026');
}

function itemTitle(item: Record<string, unknown>, fallback: string): string {
  return text(item.title, text(item.label, text(item.name, fallback)));
}

function badge(value: string): string {
  const normalized = value.toLowerCase();
  const tone =
    normalized.includes('block') ||
    normalized.includes('fail') ||
    normalized.includes('danger') ||
    normalized.includes('critical')
      ? 'danger'
      : normalized.includes('warn') ||
          normalized.includes('risk') ||
          normalized.includes('progress') ||
          normalized.includes('later')
        ? 'warn'
        : normalized.includes('ok') ||
            normalized.includes('done') ||
            normalized.includes('ship') ||
            normalized.includes('green')
          ? 'ok'
          : 'info';
  return `<span class="badge ${tone}">${escapeHtml(value)}</span>`;
}

function list(items: string[]): string {
  if (items.length === 0) return '';
  return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
}

function codeBlock(value: unknown): string {
  const code = text(value).trim();
  return code ? `<pre><code>${escapeHtml(code)}</code></pre>` : '';
}

function page(input: {
  title: string;
  kind: HtmlPrimitiveKind;
  summary: string;
  data: Record<string, unknown>;
  body: string;
  script?: string;
}): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(input.title)}</title>
<style>
  :root { color-scheme: dark light; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 22px; background: radial-gradient(circle at top left, color-mix(in srgb, var(--color-accent, #4a9eff) 18%, transparent), transparent 34rem), var(--color-bg, #0b0f14); color: var(--color-text, #e8edf2); font-family: var(--font-sans, ui-sans-serif, system-ui, sans-serif); }
  .shell { max-width: 1160px; margin: 0 auto; }
  header.hero { display: grid; grid-template-columns: 1fr auto; gap: 16px; align-items: start; margin-bottom: 20px; }
  .kicker { color: var(--color-accent, #4a9eff); text-transform: uppercase; letter-spacing: .16em; font-size: 11px; font-weight: 800; }
  h1 { margin: 5px 0 8px; font-size: clamp(28px, 4vw, 46px); line-height: .95; letter-spacing: -.04em; }
  h2 { margin: 0 0 12px; font-size: 19px; letter-spacing: -.02em; }
  h3 { margin: 0 0 8px; font-size: 15px; }
  p { color: var(--color-text-secondary, #aeb8c2); margin: 0 0 12px; }
  .actions { display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
  button { border: 1px solid var(--color-border, #263241); background: var(--color-panel, #111821); color: var(--color-text, #e8edf2); border-radius: 999px; padding: 8px 12px; font: inherit; cursor: pointer; }
  button:hover { border-color: var(--color-accent, #4a9eff); transform: translateY(-1px); }
  table { width: 100%; border-collapse: collapse; color: var(--color-text-secondary, #aeb8c2); font-size: 13px; }
  th, td { text-align: left; border-bottom: 1px solid var(--color-border, #263241); padding: 9px 8px; vertical-align: top; }
  th { color: var(--color-text, #e8edf2); font-size: 11px; text-transform: uppercase; letter-spacing: .08em; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(235px, 1fr)); gap: 14px; }
  .two { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 14px; }
  .three { display: grid; grid-template-columns: 1.1fr 1fr .9fr; gap: 14px; align-items: start; }
  .card, details, .panel { border: 1px solid var(--color-border, #263241); background: color-mix(in srgb, var(--color-panel, #111821) 88%, transparent); border-radius: 18px; padding: 16px; box-shadow: 0 18px 50px rgba(0, 0, 0, .18); }
  .card.emphasis { border-color: color-mix(in srgb, var(--color-accent, #4a9eff) 55%, var(--color-border, #263241)); }
  .sticky { position: sticky; top: 14px; }
  .metric { min-height: 104px; display: grid; align-content: space-between; }
  .metric strong { font-size: clamp(24px, 4vw, 42px); letter-spacing: -.04em; }
  .muted { color: var(--color-text-secondary, #aeb8c2); }
  .small { font-size: 12px; color: var(--color-text-muted, #7e8a97); }
  ul { padding-left: 18px; margin: 8px 0 0; color: var(--color-text-secondary, #aeb8c2); }
  li + li { margin-top: 5px; }
  pre { white-space: pre-wrap; overflow: auto; margin: 10px 0 0; padding: 12px; border-radius: 12px; background: #05070a; border: 1px solid color-mix(in srgb, var(--color-border, #263241) 75%, black); color: #d7eadb; font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace); font-size: 12px; line-height: 1.45; }
  .badge { display: inline-flex; align-items: center; border-radius: 999px; padding: 3px 8px; font-size: 11px; font-weight: 800; letter-spacing: .04em; text-transform: uppercase; }
  .badge.ok { color: #062b18; background: var(--color-success, #22c55e); }
  .badge.warn { color: #2b1a02; background: var(--color-warning, #eab308); }
  .badge.danger { color: white; background: var(--color-danger, #ef4444); }
  .badge.info { color: #051a33; background: var(--color-accent, #4a9eff); }
  .timeline { position: relative; display: grid; gap: 12px; }
  .timeline .step { display: grid; grid-template-columns: 34px 1fr; gap: 12px; align-items: start; }
  .dot { width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center; background: var(--color-accent, #4a9eff); color: #06111f; font-weight: 900; }
  .flow { display: flex; gap: 10px; align-items: stretch; overflow-x: auto; padding-bottom: 4px; }
  .flow-node { min-width: 180px; border-radius: 16px; border: 1px solid var(--color-border, #263241); padding: 14px; background: var(--color-surface, #17202b); }
  .arrow { align-self: center; color: var(--color-accent, #4a9eff); font-weight: 900; }
  .swatches { display: flex; gap: 6px; flex-wrap: wrap; margin: 8px 0; }
  .swatch { width: 44px; height: 44px; border-radius: 13px; border: 1px solid rgba(255,255,255,.22); }
  textarea, input[type="text"] { width: 100%; border: 1px solid var(--color-border, #263241); border-radius: 14px; padding: 12px; background: var(--color-bg, #0b0f14); color: var(--color-text, #e8edf2); font: inherit; }
  textarea { min-height: 220px; resize: vertical; font-family: var(--font-mono, ui-monospace, monospace); }
  .columns { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 12px; align-items: start; }
  .column { min-height: 220px; border: 1px dashed var(--color-border, #263241); border-radius: 18px; padding: 12px; background: color-mix(in srgb, var(--color-panel, #111821) 70%, transparent); }
  .ticket { cursor: grab; margin: 10px 0; }
  .ticket:active { cursor: grabbing; }
  .slide { min-height: 390px; display: none; align-content: center; }
  .slide.active { display: grid; }
  .slide h2 { font-size: clamp(30px, 5vw, 58px); line-height: .95; }
  .preview { white-space: pre-wrap; min-height: 220px; }
  .figure svg { width: 100%; min-height: 220px; border-radius: 14px; background: color-mix(in srgb, var(--color-bg, #0b0f14) 86%, white); border: 1px solid var(--color-border, #263241); }
  @media (max-width: 760px) { body { padding: 14px; } header.hero, .two, .three { grid-template-columns: 1fr; } .actions { justify-content: flex-start; } .sticky { position: static; } }
</style>
</head>
<body>
<div class="shell">
  <header class="hero">
    <div><div class="kicker">PMX HTML primitive / ${escapeHtml(input.kind)}</div><h1>${escapeHtml(input.title)}</h1><p>${escapeHtml(input.summary)}</p></div>
    <div class="actions"><button type="button" data-copy-json>Copy JSON</button><button type="button" data-copy-prompt>Copy prompt</button></div>
  </header>
  ${input.body}
</div>
<script type="application/json" id="pmx-data">${safeJson(input.data)}</script>
<script>
const PMX_DATA = JSON.parse(document.getElementById('pmx-data').textContent);
function fallbackCopy(text) {
  const el = document.createElement('textarea');
  el.value = text;
  el.setAttribute('readonly', '');
  el.style.position = 'fixed';
  el.style.left = '-9999px';
  document.body.appendChild(el);
  el.select();
  document.execCommand('copy');
  el.remove();
}
async function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(text);
  else fallbackCopy(text);
}
document.querySelector('[data-copy-json]')?.addEventListener('click', () => {
  const payload = typeof window.__pmxGetCopyJson === 'function' ? window.__pmxGetCopyJson() : PMX_DATA;
  copyText(JSON.stringify(payload, null, 2));
});
document.querySelector('[data-copy-prompt]')?.addEventListener('click', () => copyText('Use this PMX Canvas HTML primitive output as context:\\n\\n' + JSON.stringify(PMX_DATA, null, 2)));
${input.script ?? ''}
</script>
</body>
</html>`;
}

function renderChoiceGrid({ title, data, descriptor }: Parameters<PrimitiveRenderer>[0]): string {
  const items = fieldRecords(data, 'items', [
    {
      title: 'Option A',
      summary: 'Conservative path with minimal code churn.',
      tradeoff: 'Lower upside, lower risk.',
      pros: ['Quick to ship', 'Easy to review'],
      cons: ['Less flexible'],
    },
    {
      title: 'Option B',
      summary: 'Balanced refactor with clearer seams.',
      tradeoff: 'More code touched.',
      pros: ['Better long-term shape'],
      cons: ['Requires more tests'],
    },
    {
      title: 'Option C',
      summary: 'Purpose-built new layer.',
      tradeoff: 'Best UX, highest implementation cost.',
      pros: ['Distinctive output'],
      cons: ['More maintenance'],
    },
  ]);
  const body = `<section class="grid">${items
    .map(
      (item, index) => `
    <article class="card ${index === 0 ? 'emphasis' : ''}">
      <div class="small">Choice ${index + 1}</div>
      <h2>${escapeHtml(itemTitle(item, `Option ${index + 1}`))}</h2>
      <p>${escapeHtml(text(item.summary, 'Summarize the approach here.'))}</p>
      ${text(item.tradeoff) ? `<p><strong>Tradeoff:</strong> ${escapeHtml(text(item.tradeoff))}</p>` : ''}
      <div class="two"><div><h3>Pros</h3>${list(strings(item.pros))}</div><div><h3>Cons</h3>${list(strings(item.cons))}</div></div>
      ${codeBlock(item.code)}
    </article>`,
    )
    .join('')}</section>`;
  return page({ title, kind: 'choice-grid', summary: descriptor.description, data, body });
}

function renderPlanTimeline({ title, data, descriptor }: Parameters<PrimitiveRenderer>[0]): string {
  const milestones = fieldRecords(data, 'milestones', [
    { title: 'Understand current flow', detail: 'Map API, state, rendering, and agent entry points.', status: 'done' },
    { title: 'Add primitive catalog', detail: 'Generate sandboxed HTML from typed templates.', status: 'in progress' },
    { title: 'Expose interfaces', detail: 'Wire HTTP, SDK, MCP, CLI, and schema discovery.', status: 'next' },
    { title: 'Verify', detail: 'Run tests that prove schema, creation, and metadata behavior.', status: 'next' },
  ]);
  const flow = fieldRecords(data, 'flow', [
    { from: 'Agent', to: 'Primitive catalog', label: 'chooses kind + data' },
    { from: 'Primitive catalog', to: 'HTML node', label: 'renders iframe HTML' },
    { from: 'Human', to: 'Agent', label: 'exports edited JSON/prompt' },
  ]);
  const risks = fieldRecords(data, 'risks', [
    { risk: 'Overly generic output', mitigation: 'Use named primitives with clear use cases.' },
  ]);
  const snippets = fieldRecords(data, 'snippets', []);
  const body = `<section class="two"><div class="panel"><h2>Milestones</h2><div class="timeline">${milestones
    .map(
      (item, index) => `
    <div class="step"><div class="dot">${index + 1}</div><div class="card"><h3>${escapeHtml(itemTitle(item, `Milestone ${index + 1}`))} ${badge(text(item.status, 'planned'))}</h3><p>${escapeHtml(text(item.detail, 'Add implementation detail.'))}</p></div></div>`,
    )
    .join('')}</div></div>
    <div class="panel"><h2>Data Flow</h2><div class="flow">${flow.map((item, index) => `<div class="flow-node"><h3>${escapeHtml(text(item.from, `Step ${index + 1}`))}</h3><p>${escapeHtml(text(item.label, 'flows to'))}</p><strong>${escapeHtml(text(item.to, 'Next'))}</strong></div>${index < flow.length - 1 ? '<div class="arrow">-></div>' : ''}`).join('')}</div><h2 style="margin-top:18px">Risks</h2>${risks.map((item) => `<div class="card"><strong>${escapeHtml(text(item.risk, 'Risk'))}</strong><p>${escapeHtml(text(item.mitigation, 'Mitigation'))}</p></div>`).join('')}</div></section>
    ${snippets.length > 0 ? `<section class="panel" style="margin-top:14px"><h2>Code Checkpoints</h2>${snippets.map((item) => `<h3>${escapeHtml(itemTitle(item, 'Snippet'))}</h3>${codeBlock(item.code)}`).join('')}</section>` : ''}`;
  return page({ title, kind: 'plan-timeline', summary: descriptor.description, data, body });
}

function renderReviewSheet({ title, data, descriptor }: Parameters<PrimitiveRenderer>[0]): string {
  const findings = fieldRecords(data, 'findings', [
    {
      severity: 'warning',
      title: 'Review focus',
      file: 'src/example.ts',
      line: 1,
      detail: 'Explain the risky behavior and what to inspect.',
    },
  ]);
  const files = fieldRecords(data, 'files', []);
  const diff = text(data.diff);
  const body = `<section class="two"><div class="panel"><h2>Findings</h2>${findings
    .map(
      (item) => `
    <article class="card"><h3>${badge(text(item.severity, 'info'))} ${escapeHtml(itemTitle(item, 'Finding'))}</h3><p class="small">${escapeHtml([text(item.file), text(item.line)].filter(Boolean).join(':'))}</p><p>${escapeHtml(text(item.detail, 'Add review note.'))}</p></article>`,
    )
    .join('')}</div>
    <div class="panel"><h2>Review Tour</h2>${files.length > 0 ? files.map((item) => `<article class="card"><h3>${escapeHtml(text(item.path, 'File'))}</h3><p>${escapeHtml(text(item.why, 'Why this file matters.'))}</p></article>`).join('') : '<p class="muted">Add files with path and why fields for a guided review.</p>'}</div></section>
    ${diff ? `<section class="panel" style="margin-top:14px"><h2>Diff Excerpt</h2>${codeBlock(diff)}</section>` : ''}`;
  return page({ title, kind: 'review-sheet', summary: descriptor.description, data, body });
}

function renderPrWriteup({ title, data, descriptor }: Parameters<PrimitiveRenderer>[0]): string {
  const files = fieldRecords(data, 'files', [
    { path: 'src/example.ts', why: 'Core behavior changed here.', focus: 'Review edge cases and tests.' },
  ]);
  const body = `<section class="panel"><h2>Summary</h2><p>${escapeHtml(text(data.summary, 'Summarize the change in one reviewer-friendly paragraph.'))}</p><p>${escapeHtml(text(data.why, 'Explain why this change matters now.'))}</p></section>
    <section class="two" style="margin-top:14px"><div class="card"><h2>Before</h2>${list(fieldStrings(data, 'before', ['Current behavior or pain point.']))}</div><div class="card emphasis"><h2>After</h2>${list(fieldStrings(data, 'after', ['New behavior or reviewer-visible outcome.']))}</div></section>
    <section class="three" style="margin-top:14px"><div class="panel"><h2>File Tour</h2>${files.map((file) => `<details open><summary><strong>${escapeHtml(text(file.path, 'File'))}</strong></summary><p>${escapeHtml(text(file.why, 'Why this file matters.'))}</p><p class="small">Focus: ${escapeHtml(text(file.focus, 'Review behavior and tests.'))}</p></details>`).join('')}</div>
    <div class="panel"><h2>Review Focus</h2>${list(fieldStrings(data, 'reviewFocus', ['Correctness of changed behavior.', 'Missing regression coverage.']))}<h2 style="margin-top:18px">Tests</h2>${list(fieldStrings(data, 'tests', ['Add or run targeted tests.']))}</div>
    <div class="panel sticky"><h2>Rollout</h2>${list(fieldStrings(data, 'rollout', ['Merge behind normal release flow.']))}<button type="button" data-copy-markdown style="margin-top:12px">Copy PR markdown</button></div></section>`;
  return page({
    title,
    kind: 'pr-writeup',
    summary: descriptor.description,
    data,
    body,
    script: `
function prMarkdown() {
  const d = PMX_DATA;
  const lines = ['## Summary', d.summary || '', '', '## Why', d.why || '', '', '## Before / After'];
  (d.before || []).forEach((item) => lines.push('- Before: ' + item));
  (d.after || []).forEach((item) => lines.push('- After: ' + item));
  lines.push('', '## Review Focus');
  (d.reviewFocus || []).forEach((item) => lines.push('- ' + item));
  lines.push('', '## Tests');
  (d.tests || []).forEach((item) => lines.push('- ' + item));
  return lines.join('\\n');
}
document.querySelector('[data-copy-markdown]')?.addEventListener('click', () => copyText(prMarkdown()));`,
  });
}

function renderSystemMap({ title, data, descriptor }: Parameters<PrimitiveRenderer>[0]): string {
  const modules = fieldRecords(data, 'modules', [
    { id: 'agent', title: 'Agent', detail: 'Chooses an operation and passes structured data.', role: 'entry' },
    { id: 'api', title: 'HTTP/MCP API', detail: 'Validates input and creates nodes.', role: 'boundary' },
    { id: 'state', title: 'Canvas State', detail: 'Persists nodes, edges, and pins.', role: 'core' },
    { id: 'browser', title: 'Workbench', detail: 'Renders the shared canvas.', role: 'view' },
  ]);
  const edges = fieldRecords(data, 'edges', [
    { from: 'agent', to: 'api', label: 'calls' },
    { from: 'api', to: 'state', label: 'mutates' },
    { from: 'state', to: 'browser', label: 'SSE update' },
  ]);
  const entryPoints = fieldStrings(data, 'entryPoints', ['MCP tools', 'CLI commands', 'HTTP API']);
  const body = `<section class="panel"><h2>Entry Points</h2><div class="swatches">${entryPoints.map((entry) => badge(entry)).join('')}</div></section>
    <section class="grid" style="margin-top:14px">${modules.map((item) => `<article class="card"><div class="small">${escapeHtml(text(item.role, text(item.id, 'module')))}</div><h2>${escapeHtml(itemTitle(item, 'Module'))}</h2><p>${escapeHtml(text(item.detail, 'Describe this module.'))}</p></article>`).join('')}</section>
    <section class="panel" style="margin-top:14px"><h2>Relationships</h2><div class="flow">${edges.map((item) => `<div class="flow-node"><strong>${escapeHtml(text(item.from, 'from'))}</strong><p>${escapeHtml(text(item.label, 'connects'))}</p><strong>${escapeHtml(text(item.to, 'to'))}</strong></div>`).join('<div class="arrow">+</div>')}</div></section>`;
  return page({ title, kind: 'system-map', summary: descriptor.description, data, body });
}

function renderCodeWalkthrough({ title, data, descriptor }: Parameters<PrimitiveRenderer>[0]): string {
  const modules = fieldRecords(data, 'modules', [
    { id: 'entry', title: 'Entry Point', detail: 'Request or command enters here.', role: 'entry' },
    { id: 'core', title: 'Core Logic', detail: 'State change or main computation.', role: 'core' },
    { id: 'view', title: 'Renderer', detail: 'User-visible result.', role: 'view' },
  ]);
  const steps = fieldRecords(data, 'steps', [
    { title: 'Trace the path', file: 'src/example.ts', detail: 'Explain the first important hop.', code: '' },
  ]);
  const keyFiles = fieldRecords(data, 'keyFiles', []);
  const edges = fieldRecords(data, 'edges', []);
  const body = `<section class="panel"><h2>Path Summary</h2><p>${escapeHtml(text(data.summary, 'Explain the code path this walkthrough covers.'))}</p><div class="flow" style="margin-top:12px">${modules.map((module) => `<div class="flow-node"><div class="small">${escapeHtml(text(module.role, text(module.id, 'module')))}</div><h3>${escapeHtml(itemTitle(module, 'Module'))}</h3><p>${escapeHtml(text(module.detail, ''))}</p></div>`).join('<div class="arrow">-></div>')}</div>${edges.length > 0 ? `<p class="small" style="margin-top:10px">Edges: ${escapeHtml(edges.map((edge) => `${text(edge.from)} -> ${text(edge.to)}${text(edge.label) ? ` (${text(edge.label)})` : ''}`).join(', '))}</p>` : ''}</section>
    <section class="three" style="margin-top:14px"><div class="panel"><h2>Walkthrough</h2>${steps.map((step, index) => `<details ${index === 0 ? 'open' : ''}><summary><strong>${index + 1}. ${escapeHtml(itemTitle(step, 'Step'))}</strong></summary><p class="small">${escapeHtml(text(step.file, ''))}</p><p>${escapeHtml(text(step.detail, ''))}</p>${codeBlock(step.code)}</details>`).join('')}</div>
    <div class="panel"><h2>Key Files</h2>${keyFiles.length > 0 ? keyFiles.map((file) => `<article class="card"><h3>${escapeHtml(text(file.path, 'File'))}</h3><p>${escapeHtml(text(file.description, text(file.why, '')))}</p></article>`).join('') : '<p class="muted">No key files listed.</p>'}</div>
    <div class="panel sticky"><h2>Gotchas</h2>${list(fieldStrings(data, 'gotchas', ['Watch for hidden state, async boundaries, and validation gaps.']))}</div></section>`;
  return page({ title, kind: 'code-walkthrough', summary: descriptor.description, data, body });
}

function renderDesignSheet({ title, data, descriptor }: Parameters<PrimitiveRenderer>[0]): string {
  const directions = fieldRecords(data, 'directions', [
    {
      title: 'Editorial dense',
      tone: 'serious, information-rich',
      palette: ['#f4efe5', '#17120f', '#c84f2f'],
      rationale: 'Good when humans need to compare many details quickly.',
    },
    {
      title: 'Control-room dark',
      tone: 'operational, high contrast',
      palette: ['#07111d', '#dce8f2', '#4a9eff'],
      rationale: 'Good for dashboards and incident views.',
    },
  ]);
  const tokens = fieldRecords(data, 'tokens', []);
  const body = `<section class="grid">${directions
    .map((item) => {
      const palette = strings(item.palette);
      return `<article class="card"><h2>${escapeHtml(itemTitle(item, 'Direction'))}</h2><p>${escapeHtml(text(item.tone, 'Tone'))}</p><div class="swatches">${palette.map((color) => `<span class="swatch" title="${escapeHtml(color)}" style="background:${safeCssColor(color)}"></span>`).join('')}</div><p>${escapeHtml(text(item.rationale, 'Rationale'))}</p></article>`;
    })
    .join('')}</section>
    ${tokens.length > 0 ? `<section class="panel" style="margin-top:14px"><h2>Tokens</h2><div class="grid">${tokens.map((item) => `<div class="card"><strong>${escapeHtml(itemTitle(item, 'Token'))}</strong><p>${escapeHtml(text(item.value, ''))}</p></div>`).join('')}</div></section>` : ''}`;
  return page({ title, kind: 'design-sheet', summary: descriptor.description, data, body });
}

function renderComponentGallery({ title, data, descriptor }: Parameters<PrimitiveRenderer>[0]): string {
  const component = text(data.component, 'Component');
  const variants = fieldRecords(data, 'variants', [
    { label: 'Primary', state: 'default', intent: 'Main action', example: 'Continue', note: 'High emphasis.' },
    { label: 'Secondary', state: 'hover', intent: 'Alternative action', example: 'Back', note: 'Lower emphasis.' },
    {
      label: 'Destructive',
      state: 'disabled',
      intent: 'Danger zone',
      example: 'Delete',
      note: 'Requires confirmation.',
    },
  ]);
  const body = `<section class="panel"><h2>${escapeHtml(component)}</h2><p>Variant contact sheet for fast visual review.</p></section>
    <section class="grid" style="margin-top:14px">${variants.map((item) => `<article class="card"><div class="small">${escapeHtml(text(item.state, 'state'))} / ${escapeHtml(text(item.intent, 'intent'))}</div><h2>${escapeHtml(itemTitle(item, 'Variant'))}</h2><button type="button">${escapeHtml(text(item.example, itemTitle(item, 'Example')))}</button><p>${escapeHtml(text(item.note, ''))}</p></article>`).join('')}</section>`;
  return page({ title, kind: 'component-gallery', summary: descriptor.description, data, body });
}

function renderInteractionPrototype({ title, data, descriptor }: Parameters<PrimitiveRenderer>[0]): string {
  const controls = fieldRecords(data, 'controls', [
    { key: 'duration', label: 'Duration', value: 280, min: 100, max: 900, unit: 'ms' },
  ]);
  const screens = fieldRecords(data, 'screens', [
    { title: 'Start', detail: 'Initial state before interaction.' },
    { title: 'Active', detail: 'The user has started the interaction.' },
    { title: 'Done', detail: 'Final state after completion.' },
  ]);
  const annotations = fieldRecords(data, 'annotations', [
    { title: 'Decision', detail: 'Tune the values until this feels right.' },
  ]);
  const body = `<section class="three"><div class="panel"><h2>Stage</h2><p>${escapeHtml(text(data.scenario, 'Describe the interaction this prototype evaluates.'))}</p><div class="flow" style="margin-top:16px">${screens.map((screen, index) => `<button class="flow-node" type="button" data-screen="${index}"><h3>${escapeHtml(itemTitle(screen, 'Screen'))}</h3><p>${escapeHtml(text(screen.detail, ''))}</p></button>`).join('<div class="arrow">-></div>')}</div><div class="card emphasis" id="prototype-readout" style="margin-top:14px">Select a screen to inspect it.</div></div>
    <div class="panel"><h2>Controls</h2>${controls.map((control, index) => `<label class="card"><span class="small">${escapeHtml(text(control.key, `control${index}`))}</span><h3>${escapeHtml(text(control.label, 'Control'))}: <span data-control-value="${index}">${escapeHtml(text(control.value, '0'))}</span>${escapeHtml(text(control.unit, ''))}</h3><input type="range" data-control="${index}" min="${number(control.min, 0)}" max="${number(control.max, 1000)}" value="${number(control.value, 0)}"></label>`).join('')}</div>
    <div class="panel sticky"><h2>Notes</h2>${annotations.map((item) => `<article class="card"><h3>${escapeHtml(itemTitle(item, 'Note'))}</h3><p>${escapeHtml(text(item.detail, ''))}</p></article>`).join('')}<h2 style="margin-top:18px">Questions</h2>${list(fieldStrings(data, 'questions', ['Does the timing feel responsive?', 'What should persist after completion?']))}${codeBlock(data.snippet)}</div></section>`;
  return page({
    title,
    kind: 'interaction-prototype',
    summary: descriptor.description,
    data,
    body,
    script: `
const screens = PMX_DATA.screens || [];
document.querySelectorAll('[data-screen]').forEach((button) => button.addEventListener('click', () => {
  const screen = screens[Number(button.getAttribute('data-screen'))] || {};
  document.getElementById('prototype-readout').textContent = (screen.title || 'Screen') + ': ' + (screen.detail || '');
}));
document.querySelectorAll('[data-control]').forEach((input) => input.addEventListener('input', () => {
  document.querySelector('[data-control-value="' + input.getAttribute('data-control') + '"]').textContent = input.value;
}));
window.__pmxGetCopyJson = () => ({ ...PMX_DATA, controls: Array.from(document.querySelectorAll('[data-control]')).map((input, index) => ({ ...(PMX_DATA.controls || [])[index], value: Number(input.value) })) });`,
  });
}

function renderFlowchart({ title, data, descriptor }: Parameters<PrimitiveRenderer>[0]): string {
  const steps = fieldRecords(data, 'steps', [
    { title: 'Receive request', detail: 'Validate inputs and determine target path.', status: 'ok', duration: '10ms' },
    { title: 'Run operation', detail: 'Mutate server-side canvas state.', status: 'ok', duration: '25ms' },
    { title: 'Emit event', detail: 'Notify browser and agents through SSE/resources.', status: 'ok', duration: '5ms' },
  ]);
  const failurePaths = fieldRecords(data, 'failurePaths', []);
  const body = `<section class="flow">${steps.map((item, index) => `<button class="flow-node" type="button" data-step="${index}"><h3>${escapeHtml(itemTitle(item, `Step ${index + 1}`))}</h3><p>${badge(text(item.status, 'step'))} ${escapeHtml(text(item.duration))}</p></button>${index < steps.length - 1 ? '<div class="arrow">-></div>' : ''}`).join('')}</section>
    <section class="panel" style="margin-top:14px"><h2 id="step-title">${escapeHtml(itemTitle(steps[0] ?? {}, 'Step'))}</h2><p id="step-detail">${escapeHtml(text((steps[0] ?? {}).detail, 'Select a step.'))}</p></section>
    ${failurePaths.length > 0 ? `<section class="panel" style="margin-top:14px"><h2>Failure Paths</h2>${failurePaths.map((item) => `<article class="card"><h3>${escapeHtml(text(item.from, 'Step'))}: ${escapeHtml(text(item.label, 'failure'))}</h3><p>${escapeHtml(text(item.detail, ''))}</p></article>`).join('')}</section>` : ''}`;
  return page({
    title,
    kind: 'flowchart',
    summary: descriptor.description,
    data,
    body,
    script: `
const steps = PMX_DATA.steps || [];
document.querySelectorAll('[data-step]').forEach((button) => button.addEventListener('click', () => {
  const step = steps[Number(button.getAttribute('data-step'))] || {};
  document.getElementById('step-title').textContent = step.title || step.label || 'Step';
  document.getElementById('step-detail').textContent = step.detail || step.description || '';
}));`,
  });
}

function renderIllustrationSet({ title, data, descriptor }: Parameters<PrimitiveRenderer>[0]): string {
  const figures = fieldRecords(data, 'figures', [
    {
      title: 'System Loop',
      caption: 'A small editable SVG-style figure.',
      shapes: [
        { type: 'rect', x: 40, y: 60, width: 160, height: 72, text: 'Agent', color: '#4a9eff' },
        { type: 'arrow', x1: 210, y1: 96, x2: 340, y2: 96, color: '#eab308' },
        { type: 'circle', cx: 420, cy: 96, r: 42, text: 'Human', color: '#22c55e' },
      ],
    },
  ]);
  const body = `<section class="grid">${figures
    .map((figure, index) => {
      const shapes = records(figure.shapes);
      return `<article class="card figure"><h2>${escapeHtml(itemTitle(figure, `Figure ${index + 1}`))}</h2><svg viewBox="0 0 560 260" role="img" aria-label="${escapeHtml(itemTitle(figure, `Figure ${index + 1}`))}" data-figure="${index}"><defs><marker id="arrow" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L0,6 L9,3 z" fill="currentColor"></path></marker></defs>${shapes.map(inlineSvgShape).join('')}</svg><p>${escapeHtml(text(figure.caption, ''))}</p><button type="button" data-copy-svg="${index}">Copy SVG</button></article>`;
    })
    .join('')}</section>`;
  return page({
    title,
    kind: 'illustration-set',
    summary: descriptor.description,
    data,
    body,
    script: `
document.querySelectorAll('[data-copy-svg]').forEach((button) => button.addEventListener('click', () => {
  const svg = document.querySelector('[data-figure="' + button.getAttribute('data-copy-svg') + '"]');
  copyText(svg ? svg.outerHTML : '');
}));`,
  });
}

function renderDeck({ title, data, descriptor }: Parameters<PrimitiveRenderer>[0]): string {
  const slides = presentationSlides(data, DEFAULT_DECK_SLIDES);
  const body = `<section class="panel"><div class="small"><span id="slide-count">1</span> / ${slides.length} - use left/right arrows</div>${slides.map((item, index) => `<article class="slide ${index === 0 ? 'active' : ''}" data-slide="${index}"><div><div class="kicker">${escapeHtml(text(item.kicker, `Slide ${index + 1}`))}</div><h2>${escapeHtml(itemTitle(item, 'Slide'))}</h2><p>${escapeHtml(text(item.body, ''))}</p>${list(strings(item.bullets))}<p class="small">${escapeHtml(text(item.note, ''))}</p></div></article>`).join('')}</section>`;
  return page({
    title,
    kind: 'deck',
    summary: descriptor.description,
    data,
    body,
    script: `
let currentSlide = 0;
const slides = Array.from(document.querySelectorAll('[data-slide]'));
function showSlide(index) {
  currentSlide = Math.max(0, Math.min(slides.length - 1, index));
  slides.forEach((slide, i) => slide.classList.toggle('active', i === currentSlide));
  document.getElementById('slide-count').textContent = String(currentSlide + 1);
}
document.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowRight' || event.key === 'PageDown' || event.key === ' ') showSlide(currentSlide + 1);
  if (event.key === 'ArrowLeft' || event.key === 'PageUp') showSlide(currentSlide - 1);
});`,
  });
}

function renderPresentation({ title, data, descriptor }: Parameters<PrimitiveRenderer>[0]): string {
  const slides = presentationSlides(data);
  const subtitle = text(data.subtitle, descriptor.description);
  const theme = presentationTheme(data);
  const accentOverride = safeCssColor(text(data.accent, ''));
  const accent = accentOverride === 'transparent' ? theme.accent : accentOverride;
  const slideMarkup = slides
    .map((item, index) => {
      const metrics = records(item.metrics);
      return `<article class="slide ${index === 0 ? 'active' : ''}" data-slide="${index}">
      <div class="slide-grid ${metrics.length > 0 ? 'with-metrics' : 'without-metrics'}">
        <div class="slide-copy">
          <div class="kicker">${escapeHtml(text(item.kicker, `Slide ${index + 1}`))}</div>
          <h2>${escapeHtml(itemTitle(item, 'Slide'))}</h2>
          ${text(item.body) ? `<p class="lede">${escapeHtml(text(item.body))}</p>` : ''}
          ${list(strings(item.bullets))}
        </div>
        ${metrics.length > 0 ? `<div class="metrics">${metrics.map((metric) => `<div class="metric"><span>${escapeHtml(text(metric.label, 'Metric'))}</span><strong>${escapeHtml(text(metric.value, '0'))}</strong>${text(metric.detail) ? `<p>${escapeHtml(text(metric.detail))}</p>` : ''}</div>`).join('')}</div>` : ''}
      </div>
      ${text(item.note) ? `<aside class="speaker-note"><span>Speaker note</span>${escapeHtml(text(item.note))}</aside>` : ''}
    </article>`;
    })
    .join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: ${theme.colorScheme}; --deck-accent: ${accent}; --deck-bg: ${theme.bg}; --deck-panel: ${theme.panel}; --deck-surface: ${theme.surface}; --deck-border: ${theme.border}; --deck-text: ${theme.text}; --deck-text-secondary: ${theme.textSecondary}; --deck-text-muted: ${theme.textMuted}; }
  * { box-sizing: border-box; }
  html, body { width: 100%; height: 100%; overflow: hidden; }
  body { margin: 0; padding: 0; background: var(--deck-bg); color: var(--deck-text); font-family: var(--font-sans, ui-sans-serif, system-ui, sans-serif); }
  .deck { height: 100vh; min-height: 0; display: grid; grid-template-rows: auto minmax(0, 1fr) auto; background: radial-gradient(circle at 10% 10%, color-mix(in srgb, var(--deck-accent) 32%, transparent), transparent 28rem), linear-gradient(135deg, color-mix(in srgb, var(--deck-panel) 88%, black), var(--deck-bg)); }
  .topbar, .bottombar { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: clamp(12px, 2.5vmin, 24px) clamp(18px, 4vw, 48px); color: var(--deck-text-secondary); }
  .brand { display: grid; gap: 2px; }
  .brand p { margin: 0; }
  .eyebrow { color: var(--deck-accent); font-size: 11px; font-weight: 900; letter-spacing: .18em; text-transform: uppercase; }
  .title { max-width: 70vw; overflow: hidden; color: var(--deck-text); font-size: clamp(16px, 2vw, 24px); font-weight: 850; letter-spacing: -.03em; text-overflow: ellipsis; white-space: nowrap; }
  .controls { display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
  button { border: 1px solid color-mix(in srgb, var(--deck-border) 82%, white); background: color-mix(in srgb, var(--deck-panel) 82%, transparent); color: var(--deck-text); border-radius: 999px; padding: 8px 12px; font: 700 12px/1 var(--font-sans, ui-sans-serif, system-ui, sans-serif); cursor: pointer; }
  button:hover, button.active { border-color: var(--deck-accent); color: var(--deck-text); background: color-mix(in srgb, var(--deck-accent) 18%, var(--deck-panel)); }
  .slides { min-height: 0; overflow-x: hidden; overflow-y: auto; overscroll-behavior: contain; scrollbar-gutter: stable; }
  .slide { display: none; min-height: 100%; align-content: center; gap: clamp(16px, 3vmin, 28px); padding: clamp(24px, 5vmin, 64px) clamp(28px, 6vw, 92px); }
  .slide.active { display: grid; }
  .slide-grid { display: grid; gap: clamp(24px, 5vw, 72px); align-items: center; }
  .slide-grid.with-metrics { grid-template-columns: minmax(0, 1.15fr) minmax(260px, .85fr); }
  .slide-grid.without-metrics { grid-template-columns: minmax(0, 1fr); }
  .slide-copy { max-width: min(1120px, 100%); }
  .kicker { color: var(--deck-accent); font-size: clamp(12px, 1.8vw, 18px); font-weight: 950; letter-spacing: .18em; text-transform: uppercase; }
  h2 { margin: 10px 0 18px; max-width: 16ch; font-size: clamp(40px, 8vmin, 104px); line-height: .9; letter-spacing: -.07em; }
  .lede { max-width: 900px; margin: 0 0 20px; color: var(--deck-text-secondary); font-size: clamp(18px, 3vmin, 32px); line-height: 1.14; letter-spacing: -.03em; }
  ul { display: grid; gap: 12px; max-width: 780px; margin: 0; padding: 0; list-style: none; }
  li { position: relative; padding-left: 30px; color: var(--deck-text-secondary); font-size: clamp(17px, 2.2vmin, 25px); line-height: 1.22; }
  li::before { content: ''; position: absolute; left: 0; top: .42em; width: 12px; height: 12px; border-radius: 50%; background: var(--deck-accent); box-shadow: 0 0 24px color-mix(in srgb, var(--deck-accent) 60%, transparent); }
  .metrics { display: grid; gap: 14px; }
  .metric { border: 1px solid color-mix(in srgb, var(--deck-accent) 42%, var(--deck-border)); border-radius: 28px; padding: 22px; background: color-mix(in srgb, var(--deck-panel) 78%, transparent); box-shadow: 0 24px 70px rgba(0,0,0,.26); }
  .metric span { color: var(--deck-text-muted); font-size: 11px; font-weight: 900; letter-spacing: .14em; text-transform: uppercase; }
  .metric strong { display: block; margin-top: 8px; font-size: clamp(34px, 6vw, 78px); line-height: .9; letter-spacing: -.06em; }
  .metric p { margin: 10px 0 0; color: var(--deck-text-secondary); }
  .speaker-note { max-width: min(1120px, 100%); border-left: 4px solid var(--deck-accent); padding: 10px 14px; color: var(--deck-text-muted); background: color-mix(in srgb, var(--deck-panel) 76%, transparent); border-radius: 14px; }
  .speaker-note span { display: block; margin-bottom: 2px; color: var(--deck-accent); font-size: 10px; font-weight: 900; letter-spacing: .12em; text-transform: uppercase; }
  .dots { display: flex; gap: 7px; align-items: center; }
  .dot { width: 30px; height: 7px; border: 0; border-radius: 999px; padding: 0; background: color-mix(in srgb, var(--deck-text) 24%, transparent); }
  .dot.active { width: 54px; background: var(--deck-accent); }
  .hint { font-size: 12px; color: var(--deck-text-muted); }
  html[data-pmx-presentation-mode="present"] .hint { display: none; }
  .progress { height: 3px; width: 180px; overflow: hidden; border-radius: 999px; background: color-mix(in srgb, var(--deck-text) 18%, transparent); }
  .progress span { display: block; height: 100%; width: 0; background: var(--deck-accent); transition: width .2s ease; }
  @media (max-width: 820px) { .slide-grid { grid-template-columns: 1fr; } .metrics { grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); } h2 { max-width: none; font-size: clamp(42px, 14vw, 78px); } .lede, li { font-size: 21px; } .topbar { align-items: flex-start; flex-direction: column; } .title { max-width: 100%; } }
</style>
</head>
<body>
<main class="deck">
  <header class="topbar">
    <div class="brand"><div class="eyebrow">PMX presentation</div><div class="title">${escapeHtml(title)}</div><p>${escapeHtml(subtitle)}</p></div>
  </header>
  <section class="slides">${slideMarkup}</section>
  <footer class="bottombar">
    <div class="dots">${slides.map((_, index) => `<button class="dot ${index === 0 ? 'active' : ''}" type="button" data-dot="${index}" aria-label="Go to slide ${index + 1}"></button>`).join('')}</div>
    <div class="hint"><span id="slide-current">1</span> / ${slides.length} - Arrow keys, Space, Page Up/Down</div>
    <div class="progress" aria-hidden="true"><span id="slide-progress"></span></div>
  </footer>
</main>
<script type="application/json" id="pmx-data">${safeJson(data)}</script>
<script>
let currentSlide = 0;
const slides = Array.from(document.querySelectorAll('[data-slide]'));
const dots = Array.from(document.querySelectorAll('[data-dot]'));
function showSlide(index) {
  currentSlide = Math.max(0, Math.min(slides.length - 1, index));
  slides.forEach((slide, i) => slide.classList.toggle('active', i === currentSlide));
  dots.forEach((dot, i) => dot.classList.toggle('active', i === currentSlide));
  document.getElementById('slide-current').textContent = String(currentSlide + 1);
  document.getElementById('slide-progress').style.width = String(((currentSlide + 1) / slides.length) * 100) + '%';
}
dots.forEach((dot) => dot.addEventListener('click', () => showSlide(Number(dot.getAttribute('data-dot')))));
function handlePresentationKey(key) {
  if (key === 'ArrowRight' || key === 'PageDown' || key === ' ') { showSlide(currentSlide + 1); return true; }
  if (key === 'ArrowLeft' || key === 'PageUp') { showSlide(currentSlide - 1); return true; }
  if (key === 'Home') { showSlide(0); return true; }
  if (key === 'End') { showSlide(slides.length - 1); return true; }
  return false;
}
window.PMX_CANVAS_PRESENTATION_HANDLE_KEY = handlePresentationKey;
document.addEventListener('pmx-presentation-key', (event) => {
  if (!event.detail || typeof event.detail.key !== 'string') return;
  handlePresentationKey(event.detail.key);
});
document.addEventListener('keydown', (event) => {
  const tag = event.target && event.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (handlePresentationKey(event.key)) event.preventDefault();
});
showSlide(0);
</script>
</body>
</html>`;
}

function renderExplainer({ title, data, descriptor }: Parameters<PrimitiveRenderer>[0]): string {
  const steps = fieldRecords(data, 'steps', [
    { title: 'Start here', detail: 'Add request path, data flow, or concept steps.' },
  ]);
  const snippets = fieldRecords(data, 'snippets', []);
  const faq = fieldRecords(data, 'faq', []);
  const glossary = fieldRecords(data, 'glossary', []);
  const body = `<section class="panel"><h2>TLDR</h2><p>${escapeHtml(text(data.summary, 'Add the one-paragraph explanation a reader should remember.'))}</p></section>
    <section class="grid" style="margin-top:14px">${steps.map((item, index) => `<details open><summary><strong>${index + 1}. ${escapeHtml(itemTitle(item, 'Step'))}</strong></summary><p>${escapeHtml(text(item.detail, ''))}</p></details>`).join('')}</section>
    ${snippets.length > 0 ? `<section class="panel" style="margin-top:14px"><h2>Annotated Snippets</h2>${snippets.map((item) => `<h3>${escapeHtml(itemTitle(item, 'Snippet'))}</h3><p>${escapeHtml(text(item.note, ''))}</p>${codeBlock(item.code)}`).join('')}</section>` : ''}
    <section class="two" style="margin-top:14px"><div class="panel"><h2>FAQ</h2>${faq.map((item) => `<details><summary>${escapeHtml(text(item.q, 'Question'))}</summary><p>${escapeHtml(text(item.a, 'Answer'))}</p></details>`).join('') || '<p class="muted">No FAQ entries yet.</p>'}</div><div class="panel"><h2>Glossary</h2>${glossary.map((item) => `<div class="card"><strong>${escapeHtml(text(item.term, 'Term'))}</strong><p>${escapeHtml(text(item.definition, 'Definition'))}</p></div>`).join('') || '<p class="muted">No glossary entries yet.</p>'}</div></section>`;
  return page({ title, kind: 'explainer', summary: descriptor.description, data, body });
}

function renderStatusReport({ title, data, descriptor }: Parameters<PrimitiveRenderer>[0]): string {
  const metrics = fieldRecords(data, 'metrics', [
    { label: 'Health', value: 'on track', tone: 'ok' },
    { label: 'Risk', value: 'medium', tone: 'warn' },
  ]);
  const body = `<section class="grid">${metrics.map((item) => `<article class="card"><div class="small">${escapeHtml(text(item.label, 'Metric'))}</div><h2>${escapeHtml(text(item.value, 'Value'))}</h2>${badge(text(item.tone, 'info'))}</article>`).join('')}</section>
    <section class="grid" style="margin-top:14px"><article class="card"><h2>Shipped</h2>${list(fieldStrings(data, 'shipped', ['Add shipped items.']))}</article><article class="card"><h2>Slipped</h2>${list(fieldStrings(data, 'slipped', ['Add slipped items.']))}</article><article class="card"><h2>Risks</h2>${list(fieldStrings(data, 'risks', ['Add risks.']))}</article><article class="card"><h2>Next</h2>${list(fieldStrings(data, 'next', ['Add next actions.']))}</article></section>`;
  return page({ title, kind: 'status-report', summary: descriptor.description, data, body });
}

function renderIncidentReport({ title, data, descriptor }: Parameters<PrimitiveRenderer>[0]): string {
  const impact = fieldRecords(data, 'impact', [
    { label: 'Severity', value: text(data.severity, 'SEV-2'), tone: 'warn' },
    { label: 'Status', value: text(data.status, 'resolved'), tone: 'ok' },
    { label: 'Duration', value: text(data.duration, 'unknown'), tone: 'info' },
  ]);
  const timeline = fieldRecords(data, 'timeline', [
    { time: '00:00', event: 'Incident started', detail: 'Add the first observed signal.', tone: 'warn' },
  ]);
  const actions = fieldRecords(data, 'actions', [
    { done: false, owner: 'Unassigned', description: 'Add follow-up action.', due: 'TBD' },
  ]);
  const body = `<section class="grid">${impact.map((item) => `<article class="card metric"><div class="small">${escapeHtml(text(item.label, 'Metric'))}</div><strong>${escapeHtml(text(item.value, 'Value'))}</strong>${badge(text(item.tone, 'info'))}</article>`).join('')}</section>
    <section class="panel" style="margin-top:14px"><h2>Executive Summary</h2><p>${escapeHtml(text(data.summary, 'Summarize user impact, detection, and resolution.'))}</p></section>
    <section class="three" style="margin-top:14px"><div class="panel"><h2>Timeline</h2><div class="timeline">${timeline.map((item, index) => `<div class="step"><div class="dot">${escapeHtml(text(item.time, String(index + 1)))}</div><div class="card"><h3>${escapeHtml(text(item.event, 'Event'))} ${badge(text(item.tone, 'info'))}</h3><p>${escapeHtml(text(item.detail, ''))}</p></div></div>`).join('')}</div></div>
    <div class="panel"><h2>Root Cause</h2><p>${escapeHtml(text(data.rootCause, 'Add confirmed or suspected root cause.'))}</p>${codeBlock(data.logs)}</div>
    <div class="panel sticky"><h2>Actions</h2>${actions.map((action) => `<label class="card"><h3><input type="checkbox" data-action ${action.done === true ? 'checked' : ''}> ${escapeHtml(text(action.description, 'Action'))}</h3><p class="small">${escapeHtml(text(action.owner, 'Owner'))} / ${escapeHtml(text(action.due, 'Due'))}</p></label>`).join('')}<button type="button" data-copy-actions>Copy actions</button></div></section>`;
  return page({
    title,
    kind: 'incident-report',
    summary: descriptor.description,
    data,
    body,
    script: `
function actionState() {
  return Array.from(document.querySelectorAll('[data-action]')).map((input, index) => ({ ...(PMX_DATA.actions || [])[index], done: input.checked }));
}
window.__pmxGetCopyJson = () => ({ ...PMX_DATA, actions: actionState() });
document.querySelector('[data-copy-actions]')?.addEventListener('click', () => copyText(actionState().map((action) => '- [' + (action.done ? 'x' : ' ') + '] ' + (action.description || 'Action') + ' (' + (action.owner || 'owner') + ', ' + (action.due || 'due') + ')').join('\\n')));`,
  });
}

function renderTriageBoard({ title, data, descriptor }: Parameters<PrimitiveRenderer>[0]): string {
  const columns = fieldStrings(data, 'columns', ['Now', 'Next', 'Later', 'Cut']);
  const items = fieldRecords(data, 'items', [
    {
      title: 'Clarify requirements',
      detail: 'Human should decide scope boundary.',
      column: 'Now',
      rationale: 'Blocks accurate implementation.',
    },
    {
      title: 'Polish visuals',
      detail: 'Improve hierarchy after behavior lands.',
      column: 'Next',
      rationale: 'Useful but not blocking.',
    },
  ]);
  const body = `<section class="columns">${columns
    .map(
      (column) =>
        `<div class="column" data-column="${escapeHtml(column)}"><h2>${escapeHtml(column)}</h2>${items
          .filter((item) => text(item.column, columns[0]) === column)
          .map(
            (item, index) =>
              `<article class="card ticket" draggable="true" data-ticket="${index}"><h3>${escapeHtml(itemTitle(item, 'Item'))}</h3><p>${escapeHtml(text(item.detail, ''))}</p><p class="small">${escapeHtml(text(item.rationale, ''))}</p></article>`,
          )
          .join('')}</div>`,
    )
    .join(
      '',
    )}</section><p class="small" style="margin-top:12px">Drag cards between columns, then copy JSON or markdown.</p><button type="button" data-copy-markdown>Copy markdown</button>`;
  return page({
    title,
    kind: 'triage-board',
    summary: descriptor.description,
    data,
    body,
    script: `
let dragged = null;
function boardState() {
  return Array.from(document.querySelectorAll('.column')).map((column) => ({
    column: column.getAttribute('data-column') || 'Column',
    items: Array.from(column.querySelectorAll('.ticket')).map((ticket) => ({
      title: ticket.querySelector('h3')?.textContent || '',
      detail: ticket.querySelector('p')?.textContent || '',
    })),
  }));
}
document.querySelectorAll('.ticket').forEach((ticket) => {
  ticket.addEventListener('dragstart', () => { dragged = ticket; });
});
document.querySelectorAll('.column').forEach((column) => {
  column.addEventListener('dragover', (event) => event.preventDefault());
  column.addEventListener('drop', () => { if (dragged) column.appendChild(dragged); });
});
function boardMarkdown() {
  return boardState().map((column) => {
    const items = column.items.map((item) => '- ' + item.title + ': ' + item.detail);
    return '## ' + column.column + '\\n' + (items.join('\\n') || '- None');
  }).join('\\n\\n');
}
window.__pmxGetCopyJson = () => ({ ...PMX_DATA, board: boardState() });
document.querySelector('[data-copy-markdown]')?.addEventListener('click', () => copyText(boardMarkdown()));`,
  });
}

function renderConfigEditor({ title, data, descriptor }: Parameters<PrimitiveRenderer>[0]): string {
  const flags = fieldRecords(data, 'flags', [
    {
      key: 'paymentsV2',
      label: 'Payments V2',
      area: 'Checkout',
      enabled: true,
      description: 'Required for the new checkout path.',
    },
    {
      key: 'newCheckout',
      label: 'New checkout',
      area: 'Checkout',
      enabled: false,
      requires: ['paymentsV2'],
      description: 'Routes users through the new flow.',
    },
  ]);
  const body = `<section class="grid">${flags.map((flag, index) => `<label class="card"><div class="small">${escapeHtml(text(flag.area, 'General'))}</div><h3><input type="checkbox" data-flag="${index}" ${flag.enabled === true ? 'checked' : ''}> ${escapeHtml(text(flag.label, text(flag.key, `Flag ${index + 1}`)))}</h3><p>${escapeHtml(text(flag.description, ''))}</p><p class="small">Key: ${escapeHtml(text(flag.key, 'unknown'))}${strings(flag.requires).length > 0 ? ` / requires: ${escapeHtml(strings(flag.requires).join(', '))}` : ''}</p><p class="small" data-warning="${index}"></p></label>`).join('')}</section><button type="button" data-copy-diff style="margin-top:12px">Copy diff</button>`;
  return page({
    title,
    kind: 'config-editor',
    summary: descriptor.description,
    data,
    body,
    script: `
const originalFlags = PMX_DATA.flags || [];
function flagState() {
  return originalFlags.map((flag, index) => ({ ...flag, enabled: document.querySelector('[data-flag="' + index + '"]').checked }));
}
function refreshWarnings() {
  const state = flagState();
  const byKey = new Map(state.map((flag) => [flag.key, flag]));
  state.forEach((flag, index) => {
    const missing = (flag.requires || []).filter((key) => flag.enabled && !byKey.get(key)?.enabled);
    document.querySelector('[data-warning="' + index + '"]').textContent = missing.length ? 'Warning: requires ' + missing.join(', ') : '';
  });
}
document.querySelectorAll('[data-flag]').forEach((input) => input.addEventListener('change', refreshWarnings));
window.__pmxGetCopyJson = () => ({ ...PMX_DATA, flags: flagState() });
document.querySelector('[data-copy-diff]')?.addEventListener('click', () => {
  const diff = flagState().filter((flag, index) => flag.enabled !== originalFlags[index]?.enabled).map((flag) => ({ key: flag.key, enabled: flag.enabled }));
  copyText(JSON.stringify(diff, null, 2));
});
refreshWarnings();`,
  });
}

function renderPromptTuner({ title, data, descriptor }: Parameters<PrimitiveRenderer>[0]): string {
  const template = text(
    data.template,
    'Explain {{feature}} for {{audience}}. Include the tradeoffs and one concrete example.',
  );
  const samples = fieldRecords(data, 'samples', [
    { name: 'Default', variables: { feature: 'PMX Canvas pins', audience: 'coding agents' } },
  ]);
  const body = `<section class="two"><div class="panel"><h2>Template</h2><textarea id="template">${escapeHtml(template)}</textarea><p class="small"><span id="char-count">0</span> characters</p></div><div class="panel"><h2>Live Samples</h2><div id="previews"></div><button type="button" data-copy-template>Copy template</button></div></section>`;
  return page({
    title,
    kind: 'prompt-tuner',
    summary: descriptor.description,
    data: { ...data, samples },
    body,
    script: `
const templateEl = document.getElementById('template');
const previewsEl = document.getElementById('previews');
const samples = PMX_DATA.samples || [];
function fill(template, vars) {
  return template.replace(/{{\\s*([\\w.-]+)\\s*}}/g, (_, key) => vars?.[key] ?? '{{' + key + '}}');
}
function renderPreviews() {
  const value = templateEl.value;
  document.getElementById('char-count').textContent = String(value.length);
  previewsEl.innerHTML = samples.map((sample) => '<div class="card"><h3>' + (sample.name || 'Sample') + '</h3><div class="preview">' + fill(value, sample.variables || {}).replace(/[&<>]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])) + '</div></div>').join('');
}
templateEl.addEventListener('input', renderPreviews);
window.__pmxGetCopyJson = () => ({ ...PMX_DATA, template: templateEl.value });
document.querySelector('[data-copy-template]')?.addEventListener('click', () => copyText(templateEl.value));
renderPreviews();`,
  });
}

const RENDERERS: Record<HtmlPrimitiveKind, PrimitiveRenderer> = {
  'choice-grid': renderChoiceGrid,
  'plan-timeline': renderPlanTimeline,
  'review-sheet': renderReviewSheet,
  'pr-writeup': renderPrWriteup,
  'system-map': renderSystemMap,
  'code-walkthrough': renderCodeWalkthrough,
  'design-sheet': renderDesignSheet,
  'component-gallery': renderComponentGallery,
  'interaction-prototype': renderInteractionPrototype,
  flowchart: renderFlowchart,
  'illustration-set': renderIllustrationSet,
  deck: renderDeck,
  presentation: renderPresentation,
  explainer: renderExplainer,
  'status-report': renderStatusReport,
  'incident-report': renderIncidentReport,
  'triage-board': renderTriageBoard,
  'config-editor': renderConfigEditor,
  'prompt-tuner': renderPromptTuner,
};

export function isHtmlPrimitiveKind(value: string): value is HtmlPrimitiveKind {
  return (HTML_PRIMITIVE_KINDS as readonly string[]).includes(value);
}

export function getHtmlPrimitiveDescriptor(kind: HtmlPrimitiveKind): HtmlPrimitiveDescriptor {
  const descriptor = DESCRIPTORS.find((entry) => entry.kind === kind);
  if (!descriptor) throw new Error(`Unknown HTML primitive: ${kind}`);
  return descriptor;
}

export function listHtmlPrimitiveDescriptors(): HtmlPrimitiveDescriptor[] {
  return JSON.parse(JSON.stringify(DESCRIPTORS)) as HtmlPrimitiveDescriptor[];
}

export function getHtmlPrimitiveSemanticMetadata(data: Record<string, unknown>): HtmlPrimitiveSemanticMetadata {
  if (data.presentation !== true) return {};
  const slideTitles = strings(data.slideTitles);
  const speakerNotes = strings(data.speakerNotes);
  const theme = presentationThemeMetadata(data);
  return {
    presentation: true,
    ...(typeof data.slideCount === 'number' && Number.isFinite(data.slideCount) ? { slideCount: data.slideCount } : {}),
    ...(slideTitles.length > 0 ? { slideTitles } : {}),
    ...(speakerNotes.length > 0 ? { speakerNotes } : {}),
    ...(theme !== undefined ? { presentationTheme: theme } : {}),
  };
}

export function buildHtmlPrimitive(input: HtmlPrimitiveInput): HtmlPrimitiveBuildResult {
  const descriptor = getHtmlPrimitiveDescriptor(input.kind);
  const title = input.title ?? descriptor.title;
  const data = enrichPresentationData(input.kind, input.data ?? {});
  const renderer = RENDERERS[input.kind];
  const slideTitles = strings(data.slideTitles);
  const summary =
    slideTitles.length > 0 ? `${descriptor.description} Slides: ${slideTitles.join(', ')}.` : descriptor.description;
  return {
    kind: input.kind,
    title,
    html: renderer({ title, data, descriptor }),
    summary,
    defaultSize: descriptor.defaultSize,
    data,
  };
}
