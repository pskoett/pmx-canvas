# SDLC Control Room

This published-consumer scenario exercises PMX Canvas the way an external user would: install the package, start the server through the public SDK, generate a bundled web artifact, add native `json-render` panels, and connect the whole story with standard canvas nodes.

## What This Demo Covers

- A markdown article node for narrative context
- A hosted web artifact node built from local React source
- Native `json-render` dashboard and form nodes
- Native graph nodes for line, bar, and pie views
- Status, context, ledger, trace, file, image, and group nodes
- Flow, dependency, relation, and reference edges
- Snapshot creation and context pin updates over the HTTP API

## Fake SDLC Dataset

The data is intentionally synthetic but shaped like a real weekly release train:

| Signal | Value | Interpretation |
| --- | --- | --- |
| Median lead time | 19 hours | Healthy overall, but queueing dominates the tail |
| Change failure rate | 7.6% | Stable, with most regressions caught before production |
| Mean time to recover | 36 minutes | Rollback readiness is strong |
| First-pass gate rate | 78% | Integration tests remain the biggest drag |

### Current Story

1. Planning is predictable.
2. Code review throughput is strong.
3. Build stability is mostly green.
4. Integration test volatility is the current bottleneck.
5. Canary and rollback posture are healthy enough to keep the train moving.

## Why This Is Useful

A realistic evaluation needs more than a single markdown note. If someone installs PMX Canvas after it is published, they should be able to:

- programmatically seed a workspace,
- mix narrative and structured panels,
- ship a custom artifact into the canvas,
- inspect local files directly from the board,
- pin the key context for an agent,
- and keep the whole layout understandable in the browser.

This fixture is designed to prove exactly that.
