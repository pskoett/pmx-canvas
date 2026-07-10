// Total-coverage floors (plan-009 H7): fails when the full-suite coverage
// drops below floors set ~2-4pp under the adoption baseline as measured from
// THIS lcov report (62.19% lines / 67.88% functions — lcov totals differ from
// bun's text-reporter table). Enforced here because bun 1.3.x evaluates
// bunfig's plain-number coverageThreshold PER FILE and silently ignores the
// { line=, function= } table form — neither expresses a total floor.
const FLOORS = { lines: 0.6, functions: 0.64 };

const lcovPath = process.env.PMX_COVERAGE_LCOV ?? 'coverage/lcov.info';
const lcov = await Bun.file(lcovPath).text();
let linesFound = 0;
let linesHit = 0;
let functionsFound = 0;
let functionsHit = 0;
for (const line of lcov.split('\n')) {
  if (line.startsWith('LF:')) linesFound += Number(line.slice(3));
  else if (line.startsWith('LH:')) linesHit += Number(line.slice(3));
  else if (line.startsWith('FNF:')) functionsFound += Number(line.slice(4));
  else if (line.startsWith('FNH:')) functionsHit += Number(line.slice(4));
}
if (linesFound === 0 || functionsFound === 0) {
  console.error(`check-coverage: ${lcovPath} has no coverage data — run bun test --coverage first.`);
  process.exit(1);
}
const lines = linesHit / linesFound;
const functions = functionsHit / functionsFound;
const pct = (v: number) => `${(v * 100).toFixed(2)}%`;
console.log(`coverage totals: lines ${pct(lines)} (floor ${pct(FLOORS.lines)}), functions ${pct(functions)} (floor ${pct(FLOORS.functions)})`);
let failed = false;
if (lines < FLOORS.lines) {
  console.error(`check-coverage: line coverage ${pct(lines)} fell below the ${pct(FLOORS.lines)} floor.`);
  failed = true;
}
if (functions < FLOORS.functions) {
  console.error(`check-coverage: function coverage ${pct(functions)} fell below the ${pct(FLOORS.functions)} floor.`);
  failed = true;
}
if (failed) process.exit(1);
