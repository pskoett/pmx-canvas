# Eval: how much does curation change the work?

**Status:** ready to run; no runs scored yet. Written 2026-10-07. A benchmark rerun on every
release, for continuous improvement, not a one-off verdict (decided with the maintainer,
2026-10-07).
**Source:** [vision](../product-vision-2026-09.md#part-1-the-foundation) Part 1, item 4 (effect);
[plan 016](../plans/plan-016-context-made-visible-wave-1.md) slice 6.
**Fixture:** [`scripts/eval-curation/board.ts`](../../scripts/eval-curation/board.ts), guarded by
`tests/unit/eval-curation-board.test.ts`.

The board, task and rubric are fixed so scores compare across releases. Changing one voids
the comparison with earlier results; add a new case beside this one instead of editing it.

## The question

The same task, with the brief delivered, on a curated and an uncurated copy of the same board.
How good is the work in each condition, what does retrieval cost, and what contribution does
curation make? Improve useful outcomes, not the size of the difference between conditions.
With one real user this is a test case, not statistics; real sessions only confirm or
contradict it.

## The board

"Team tier pricing — Q4": 30 Markdown cards written over a quarter, oldest first. It holds early
research, a first decision (Team to $20, August) that a later one supersedes (Team to $24,
September), a finance ceiling ($25 until the Q2 billing migration), a churn readout, a competitor
price update (Rival to $29), and realistic distractors (roadmap, hiring, transcripts, glossary).

- **Curated:** the current decision, the finance ceiling, the churn readout and the competitor
  update are pinned (`PINNED_KEYS`), with the reason "what this task rests on".
- **Uncurated:** the same cards, order and layout, no pins.

Since 2026-10-07 the brief is a map, not a dump: every card arrives as its title and a short
summary (with its relations, and why it was pinned), and the agent pulls whatever it wants in
full. So both boards deliver all 30 cards. Curation changes what the agent is told matters: the
four pinned cards lead the curated brief, marked `pinned`, while the uncurated brief runs oldest
first, with the superseded $20 decision ahead of the current $24 one. The fixture test guards
exactly that.

## What it measures

Given the same map, does curation make the agent pull and use the right cards? Score the
answer (rubric below) and record **which cards it pulled in full** (`canvas_ax_timeline {
action: "read-status", board }` after the run: a card is read only when pulled). The pulls
explain the score: a missed current decision that was never pulled is a curation or ranking
miss; one that was pulled and misread is a model miss.

Record retrieval cost separately from the answer rubric: brief-page requests, full-card pulls
(including repeats), elapsed task time, and host-reported tokens when available. Count only the
run's reads, not the evaluator's inspection calls. Keep character counts and estimated tokens
distinct from measured tokens; missing instrumentation is unknown, not zero. Lower cost is an
improvement at comparable quality, not a reason to skip evidence needed for a correct answer.

## Protocol

1. **Scratch workspace.** Start a server on a scratch workspace or database, never your real
   boards: `PMX_CANVAS_DB_PATH=<scratch>/canvas.db pmx-canvas serve --daemon --port=<port>`.
2. **Seed.** `PMX_CANVAS_URL=http://127.0.0.1:<port> bun run scripts/eval-curation/seed.ts`.
   It prints both board ids and leaves Home open.
3. **One run** = open the run's board (`canvas_board open`), start a **fresh** agent
   session with PMX Canvas connected and no other context, and send `TASK_PROMPT` from
   `board.ts` verbatim. Save the final answer as `run-<random id>.md`, and note the id and board
   in a separate key file, with the cards the agent pulled (step 4).
4. **Delivery check, every run.** After the run, `canvas_ax_timeline { action: "read-status",
   board }` and the read log must show a brief read during the session, with the four pins in
   its delivered pins for curated runs. Record the cards read (pulled in full). A run without a confirmed brief read is a delivery failure: record it, do not
   score it, and fix the adapter rather than doubt the thesis.
5. **Runs.** Three per board with the same host and model: 6 runs. Alternate curated and
   uncurated. Record host, model, relevant configuration, product version, date and per-run
   retrieval costs. Keep those conditions comparable between releases; changing the model or
   host starts a separate comparison series. Three runs per condition are diagnostic, not
   enough to make small score differences a statistical release gate.
6. **Blind scoring.** Score the answer files in shuffled order without the key file, using the
   rubric below, then join scores to the key.

## Rubric (0–10 per run)

| # | Criterion | 2 | 1 | 0 |
|---|---|---|---|---|
| R1 | Current decision | Recommends $25 or less and identifies $24 (September) as the current decision | Recommends $25 or less without the current decision | Treats $20 as current, or recommends more than $25 for Q4 |
| R2 | Finance ceiling | States the $25 ceiling until the Q2 billing migration | Mentions a finance or billing limit vaguely | Absent |
| R3 | Churn evidence | Cites churn 2.2% vs 2.1% and the higher small-team churn | Cites one of the two | Absent or wrong |
| R4 | Competitor | Uses Rival at $29 | Uses the July $22 and flags it may be stale | Uses $22 as current, or absent |
| R5 | Small teams | Addresses teams under 10 seats (a separate price or plan) | Mentions small teams without a recommendation | Absent |

Penalties: **−2** for presenting the superseded $20 decision as current; **−2** for any number
stated as fact that is not on the board. The minimum score is 0.

## How results are used

Run the eval on every release that touches the brief, pins, budgets or adapters, and at least
once per minor version. Record absolute scores and retrieval costs for **both conditions**,
all run scores (not only means), delivery failures, and the cards each run pulled. Also record
the **curation gap**: curated mean minus uncurated mean, with delivery confirmed in every
scored run. Excluding a delivery failure from scoring does not remove it from the report.

- **Quality first; cost alongside it.** Improve absolute answer quality and delivery reliability
  in both conditions. At comparable quality, fewer unnecessary reads, lower token use or shorter
  task time are useful improvements. Make quality/cost tradeoffs explicit rather than collapsing
  them into a single score.
- **Use the gap diagnostically, not as a target.** Curated 8 → 9 and uncurated 5 → 8 narrows the
  gap from 3 to 1 while both improve. Curated 8 → 8 and uncurated 5 → 3 widens it from 3 to 5
  while one condition regresses. Neither gap direction alone establishes product improvement.
- **Investigate regressions.** Broken delivery is a defect to fix before release. A lower
  absolute score or higher retrieval cost under comparable conditions triggers inspection of
  the lost rubric points and repeat runs. Reproducible quality loss is a regression; unexplained
  cost increases need resolution or a documented quality tradeoff. Do not block a release merely
  because the gap shrank or a small diagnostic sample varied.
- **Read the misses.** For each run below 10, note which rubric line it lost and why (not
  delivered, delivered but ignored, misread). That note is the improvement backlog.
- **Add cases, keep this one.** New boards (another domain, a larger board, cross-board pins)
  sit beside this case so the history of this one stays comparable.

## Results

Per release:

| Version | Host / model / config | Date | Curated mean | Uncurated mean | Gap | Delivery failures / attempts | Costs by condition | Notes (lost lines, variation) |
|---|---|---|---|---|---|---|---|---|

Per run (kept for the misses):

| Run id | Version | Board | Delivery | Cards pulled | Brief requests / full pulls | Elapsed time | Tokens (measured / estimated / unknown) | R1 | R2 | R3 | R4 | R5 | Penalty | Total | Lost lines, why |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|

Not yet run.
