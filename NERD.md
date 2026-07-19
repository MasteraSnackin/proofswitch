# Technical Review

## Technical Risks Found

1. Preflight mode mismatch: UI preflight could label checks as live-oriented before live configuration was present.
2. Live integration unproven: adapters and tests are strong, but real TxLINE payloads have not been observed.
3. Evidence integrity is local: SHA-256 checksums detect byte changes but do not identify the creator.
4. Rate limits are per server isolate, not globally coordinated.
5. Public Solana RPC is suitable for demos but not a production reliability plan.

## Priority Ranking

- P1: Preflight source mismatch. Fixed.
- P1: Real credentialed TxLINE run still pending.
- P2: Browser visual QA still pending.
- P2: Request IDs and provider timing absent.
- P3: Dedicated repository screenshots are absent; the demo video is published.

## Changes Made

- Added explicit preflight mode selection.
- Refreshed project documentation with architecture, risk boundaries and setup detail.
- Added review reports that state current unknowns plainly.
- Added source-level assertions for the new live-control features.

## Verification Evidence

- TypeScript compilation passed.
- ESLint passed with no warnings.
- Focused render contract tests passed.
- Full automated suite passed: `133/133`.

## Residual Risk

The remaining highest-risk path is external: genuine TxLINE fixture, odds, scores and proof payloads must be tested after token activation. No local code change can prove that without organiser access.
