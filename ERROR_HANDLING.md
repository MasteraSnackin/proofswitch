# Error Handling Summary

- Scope: local API routes, live dashboard async flows, TxLINE adapter boundary, Solana proof boundary and evidence export.
- Main failure modes: missing credentials, locked operator access, fixture absence, invalid fixture ID, upstream authentication failure, schema mismatch, stream interruption, stale transport, failed proof request, oversized evidence and local storage conflicts.
- Current gaps: no centralised request IDs, no deployed log sink, and no globally coordinated rate limits.
- Fixes made: preflight now avoids misleading live endpoint checks when credentials are absent; disabled controls explain their blocking reason; evidence and proof workflows continue to expose bounded states.
- Verification: build, typecheck, lint and full tests passed.
- Residual risks: live payload shape and real Solana proof availability remain unverified until sponsor credentials are issued.

## API Contract

The project currently uses a compact JSON failure shape:

```json
{
  "error": {
    "code": "LIVE_NOT_CONFIGURED",
    "message": "Live mode requires an activated TXLINE_API_TOKEN."
  },
  "mode": "live"
}
```

This is consistent across the current local API routes. A future deployed version should add a safe request ID so operators can correlate UI failures with server logs.

## UI Error States

- Loading: status, access, fixtures, proof and evidence preparation.
- Empty: no fixtures, no audit, no timeline and no saved session.
- Recoverable error: fixture reload, proof retry, access unlock retry and evidence export error.
- Success: access unlocked, streams connected, evidence downloaded, preflight completed and setup template copied.
- Duplicate submission guard: proof loading, evidence preparing, preflight running and operator access loading states disable repeated actions.

## Recommended Next Error-Handling Work

1. Add request IDs to API failures and server logs before deployment.
2. Add provider timing to TxLINE requests.
3. Add a single exported error-code reference table for README and tests.
4. Keep live upstream response bodies out of public logs and issue reports.
