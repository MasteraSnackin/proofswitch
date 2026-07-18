# ProofSwitch — Submission Pack

## Submission links

- Demo video: **pending upload**
- Public GitHub repository: <https://github.com/MasteraSnackin/proofswitch>
- Deployed application: <https://proofswitch.vercel.app>
- Judge documentation: <https://proofswitch.vercel.app/submission>

## Track

**Primary track: Trading Tools and Agents.**

ProofSwitch is an autonomous paper-trading risk operator. It consumes odds, scores and stream-health signals, detects sharp movement or stale data, then cancels, holds, reprices and reopens quotes under a deterministic policy without manual intervention.

The same build may be presented for the London local prize pool, subject to organiser rules. Consumer and Fan Experiences is only a secondary presentation angle. Prediction Markets and Settlement is not claimed because this version does not create or settle on-chain markets.

## Core idea

In-play markets move fastest when a goal, red card or feed failure occurs. Those are also the moments when stale quotes create the greatest risk. ProofSwitch gives market makers and sports trading teams an automated circuit breaker: it withdraws unsafe paper quotes quickly, records why it acted, then refuses to reopen until score confirmation, feed freshness and stable-price evidence satisfy the configured policy.

## Business highlights

- **User:** sports trading teams, market makers and risk operators.
- **Problem:** odds shocks and stale data can leave unsafe quotes live during high-volatility moments.
- **Value:** fast, deterministic risk protection with an auditable decision trail.
- **Expansion path:** connect the guarded command layer to a real execution venue after compliance, risk and reliability review.
- **Current boundary:** paper execution only; no consumer betting and no real orders.

## Technical highlights

- One deterministic reducer handles snapshots, SSE updates, synthetic rehearsal and replay.
- Sharp-movement detection combines consensus-price movement, confirmed match events and stream freshness.
- The paper market maker cancels unsafe quotes, enforces a hold and waits for stable recovery evidence before reopening.
- Live mode fails closed and never substitutes synthetic data when credentials or upstream contracts fail.
- TxLINE credentials and judge access secrets remain server-side.
- Solana verification is not claimed unless genuine TxLINE proof material passes the read-only validation runtime.
- Automated build, lint, type, reducer, adapter, replay, access-control and evidence tests cover the main boundaries.

## TxLINE endpoints integrated

The following upstream surface is implemented and contract-tested. It must be described as **integrated**, not **used live**, until a sponsor token is supplied and a genuine session is recorded.

| Method | Endpoint | Use in ProofSwitch |
| --- | --- | --- |
| `POST` | `/auth/guest/start` | Exchange the server-side sponsor token for a short-lived guest session. |
| `GET` | `/api/fixtures/snapshot` | Discover covered World Cup fixtures. |
| `GET` | `/api/odds/snapshot/{fixtureId}` | Seed the match-winner StablePrice state. |
| `GET` | `/api/scores/snapshot/{fixtureId}` | Seed score and match-state data. |
| `GET` | `/api/odds/stream?fixtureId=...` | Consume live consensus-price and heartbeat events over SSE. |
| `GET` | `/api/scores/stream?fixtureId=...` | Consume live score, disciplinary and match-state events over SSE. |
| `GET` | `/api/scores/stat-validation?fixtureId=...&seq=...&statKeys=...` | Retrieve material for the optional Solana validation boundary. |

## Judge-testable application surface

The deployed application exposes a working synthetic rehearsal because no TxLINE token is stored in this repository:

```text
GET /api/status
GET /api/fixtures
GET /api/odds?fixtureId=20260001
GET /api/scores?fixtureId=20260001
GET /api/stream?kind=odds&fixtureId=20260001
GET /api/stream?kind=scores&fixtureId=20260001
```

Every public response identifies its source as synthetic. These endpoints prove the running application, data contracts, reducer and paper-execution path; they are not evidence of a genuine TxLINE session.

## TxLINE API feedback

We liked the separation between initial snapshots and SSE updates, the normalised fixture, odds and score families, and StablePrice consensus values that map cleanly into a shock-detection policy. That structure allowed one deterministic reducer to power both credential-free rehearsal and the intended live path.

The main friction was the multi-part live setup: sponsor-token access, guest-session authentication and matching configuration across the API host, Solana network, RPC and programme ID. A compact end-to-end devnet example covering authentication, stream resumption, score-sequence handling and the stat-validation proof lifecycle would reduce integration time.

This feedback reflects implementation against the documented contracts and local adapter tests. No credential-backed TxLINE call has been made in this workspace, so observed live reliability, latency and payload behaviour remain unknown. A live-run addendum must replace or extend this paragraph after sponsor access is supplied.

## Eligibility boundary

The application, synthetic API, strategy engine, paper execution, documentation and automated tests work now. The remaining sponsor dependency is a genuine TxLINE session. Final eligibility cannot be claimed until an activated sponsor token is configured and at least one real fixture, odds and score-stream run is recorded. Solana proof validation remains optional and unclaimed unless genuine proof material succeeds.
