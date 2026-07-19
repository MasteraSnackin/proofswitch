# Debug Report

## Root Cause

The new live preflight UI used the display-level `runtimeSource` value when choosing fixture, odds and score checks. When the app was in normal synthetic configuration but not running the explicit pipeline rehearsal, `runtimeSource` evaluated to `txline`, even though the server API routes still use server configuration as the source of truth.

This could make a credential-free preflight look noisier than needed, because it would label checks as live-oriented before the live path was actually configured.

## Fix

The preflight now derives a separate `preflightMode`:

- `synthetic` when live credentials are not configured or when the synthetic rehearsal is running;
- `live` only when live configuration is present.

That keeps preflight output aligned with the actual server mode and preserves the fail-closed live boundary.

## Verification

- Command: `npm run typecheck`
- Result: passed.
- Command: `npm run lint`
- Result: passed with no warnings.
- Command: `node --test tests/rendered-html.test.mjs`
- Result: passed.
- Command: `npm test`
- Result: production build passed and `133/133` tests passed.
- Browser check: not performed in this turn; Sites workflow did not require browser interaction and the user did not request visual browser QA.

## Residual Risk

The first real TxLINE preflight still depends on sponsor-issued credentials and current upstream payloads. That cannot be verified locally without the token.

## Follow-up

Run live preflight after adding `TXLINE_API_TOKEN`, operator access values and any Solana validation settings.
