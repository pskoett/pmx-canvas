import DOMPurify from 'dompurify';

// Mermaid configuration is global: serialize configuration with each render.
let rendering: Promise<unknown> = Promise.resolve();

export function renderMermaid(source: string): Promise<string> {
  const result = rendering.then(async () => {
    // Diagram-only dependency: the SPA splits this module; self-contained MCP
    // documents defer its initialization without requiring external assets.
    const { default: mermaid } = await import('mermaid');
    const style = getComputedStyle(document.documentElement);
    const token = (name: string) => style.getPropertyValue(name).trim();
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'base',
      fontFamily: token('--font-ui'),
      themeVariables: {
        primaryColor: token('--c-panel-soft'),
        primaryTextColor: token('--c-text'),
        primaryBorderColor: token('--c-line'),
        lineColor: token('--c-muted'),
        secondaryColor: token('--c-panel'),
        tertiaryColor: token('--c-panel'),
        edgeLabelBackground: token('--c-panel'),
        fontSize: '12px',
      },
    });
    const { svg } = await mermaid.render(`mermaid-${crypto.randomUUID()}`, source);
    return DOMPurify.sanitize(svg, {
      ADD_TAGS: ['foreignObject'],
      ADD_ATTR: ['dominant-baseline'],
      HTML_INTEGRATION_POINTS: { foreignobject: true },
    });
  });
  // A malformed diagram must not prevent the next diagram from rendering.
  rendering = result.catch(() => {});
  return result;
}
