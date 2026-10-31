import type { PluginAPI } from '@ampcode/plugin';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { rankContextBrief } from '../plugins/amp/context-relevance.js';
import { adviseCanvas, type AdviceRequest } from '../plugins/amp/jev-advice.js';
import { relevanceCaseBrief, relevanceCases } from '../tests/fixtures/context-relevance.js';
import { representationCases, reviewCases } from '../tests/fixtures/jev-advice.js';

export const description =
  'Development-only Jev context evaluation. Sends only fixed fictional fixtures, never workspace context.';

// Load this file as an Amp plugin, then call evaluate_canvas_context. Do not install
// it in the shipped plugin. Actual Amp inference is required; Bun tests use stubs.
export default function (amp: PluginAPI) {
  amp.registerTool({
    name: 'evaluate_canvas_context',
    description:
      'Run eight fixed fictional context-ranking cases through native Amp Jev inference. Returns model versions, ordering checks, request sizes and elapsed time; writes a JSON artifact. Does not enable production ranking.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    async execute(_input, ctx) {
      const rows = [];
      for (const fixture of relevanceCases) {
        for (const reverse of [false, true]) {
          ctx.signal.throwIfAborted();
          const brief = relevanceCaseBrief({
            ...fixture,
            candidates: reverse ? [...fixture.candidates].reverse() : fixture.candidates,
          });
          let stateChars = 0;
          const started = performance.now();
          const result = await rankContextBrief(
            brief,
            fixture.task,
            ctx.thread.id,
            typeof amp.ai?.decide === 'function'
              ? (request) => {
                  stateChars = JSON.stringify(request.state).length;
                  return amp.ai.decide(request);
                }
              : undefined,
          );
          const preserved =
            JSON.stringify({
              ...brief,
              entries: [...brief.entries].sort((a, b) => a.nodeId.localeCompare(b.nodeId)),
            }) ===
            JSON.stringify({
              ...result.brief,
              entries: [...result.brief.entries].sort((a, b) => a.nodeId.localeCompare(b.nodeId)),
            });
          rows.push({
            case: fixture.name,
            reverse,
            expectedFirstOptional: fixture.preferred,
            baselineFirstOptional: brief.entries[1].nodeId,
            rankedFirstOptional: result.brief.entries[1].nodeId,
            pass:
              result.report.mode === 'jev' &&
              result.brief.entries[1].nodeId === fixture.preferred &&
              result.brief.entries[0] === brief.entries[0] &&
              preserved,
            preserved,
            stateChars,
            briefChars: JSON.stringify(brief).length,
            elapsedMs: Math.round(performance.now() - started),
            ...result.report,
          });
        }
      }
      const report = {
        measuredAt: new Date().toISOString(),
        passed: rows.filter((row) => row.pass).length,
        total: rows.length,
        baselineCorrect: rows.filter((row) => row.baselineFirstOptional === row.expectedFirstOptional).length,
        limits:
          'Four authored fictional pairs in both orders. Diagnostic only, not retrieval/task-quality evidence. Same brief contents and size before/after. Native API exposes no billed cost. Latency includes Amp/provider routing. No production opt-in changed.',
        rows,
      };
      const directory = resolve(import.meta.dir, '../.amp/in/artifacts');
      mkdirSync(directory, { recursive: true });
      const artifact = join(directory, `jev-context-${Date.now()}.json`);
      writeFileSync(artifact, `${JSON.stringify(report, null, 2)}\n`);
      return JSON.stringify({ ...report, artifact });
    },
  });

  amp.registerTool({
    name: 'evaluate_canvas_advice',
    description:
      'Evaluate Jev output-format choices and review ordering on eight fixed fictional cases. No production consent or workspace content is used.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    async execute(_input, ctx) {
      const cases: Array<{ input: AdviceRequest; expected: string | string[]; baseline: string | string[] }> = [
        ...representationCases.map(({ task, summary, expected }, index) => ({
          input: { action: 'representation' as const, requestId: `format-${index}`, task, summary },
          expected,
          baseline: 'markdown',
        })),
        ...reviewCases.flatMap(({ task, changes, expected }, index) =>
          [false, true].map((reverse) => {
            const ordered = reverse ? [...changes].reverse() : changes;
            return {
              input: { action: 'review' as const, requestId: `review-${index}-${reverse}`, task, changes: ordered },
              expected,
              baseline: ordered.map(({ id }) => id),
            };
          }),
        ),
      ];
      const rows = [];
      for (const { input, expected, baseline } of cases) {
        ctx.signal.throwIfAborted();
        const original = JSON.stringify(input);
        let stateChars = 0;
        const started = performance.now();
        const result = await adviseCanvas(input, ctx.thread.id, (request) => {
          stateChars = JSON.stringify(request.state).length;
          return amp.ai.decide(request);
        });
        const actual = result.format ?? result.orderedIds;
        rows.push({
          case: input.requestId,
          expected,
          baseline,
          actual,
          pass:
            result.mode === 'jev' &&
            JSON.stringify(actual) === JSON.stringify(expected) &&
            JSON.stringify(input) === original,
          elapsedMs: Math.round(performance.now() - started),
          stateChars,
          ...result,
        });
      }
      const report = {
        measuredAt: new Date().toISOString(),
        passed: rows.filter(({ pass }) => pass).length,
        total: rows.length,
        baselineCorrect: rows.filter(({ baseline, expected }) => JSON.stringify(baseline) === JSON.stringify(expected))
          .length,
        limits:
          'Four format tasks and two review pairs in both orders, all fictional. Diagnostic only, not general task quality, injection immunity, rendered-output acceptance or review correctness. API exposes no billed cost. No production consent changed.',
        rows,
      };
      const directory = resolve(import.meta.dir, '../.amp/in/artifacts');
      mkdirSync(directory, { recursive: true });
      const artifact = join(directory, `jev-advice-${Date.now()}.json`);
      writeFileSync(artifact, `${JSON.stringify(report, null, 2)}\n`);
      return JSON.stringify({ ...report, artifact });
    },
  });
}
