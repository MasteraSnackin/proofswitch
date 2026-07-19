# ProofSwitch — Submission Pack

## Submission links

- Demo video: <https://youtu.be/0uxTKx0Jf0Q> — 4 minutes 48 seconds
- Public GitHub repository: <https://github.com/MasteraSnackin/proofswitch>
- Deployed application: <https://proofswitch.vercel.app>
- Judge documentation: <https://proofswitch.vercel.app/submission>
- Guided judge walkthrough: <https://proofswitch.vercel.app/?judge=1>
- Machine-readable manifest: <https://proofswitch.vercel.app/api/submission>
- Copy-ready organiser form: [`SUBMISSION_FORM.md`](./SUBMISSION_FORM.md)

## Fast judge path

1. Watch the 4-minute-48-second demo.
2. Run the 90-second guided autonomous scenario and continue through the cancellation and recovery checkpoints.
3. Inspect the manifest, public APIs and repository.

All five initial-screening artefacts are published. The separate sponsor dependency is a credential-backed TxLINE run, which remains pending and is not claimed.

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

- The live reducer handles snapshots, SSE updates and the synthetic production-path rehearsal; the Demo Lab is a separate deterministic simulator.
- Sharp-movement detection combines consensus-price movement, confirmed match events and stream freshness.
- The paper market maker cancels unsafe quotes, enforces a hold and waits for stable recovery evidence before reopening.
- Live mode fails closed and never substitutes synthetic data when credentials or upstream contracts fail.
- TxLINE credentials and judge access secrets remain server-side.
- Solana verification is not claimed unless genuine TxLINE proof material passes the read-only validation runtime.
- Automated build, lint, type, reducer, adapter, replay, access-control and evidence tests cover the main boundaries.

## Strategy contract and novelty

| Stage | Deterministic contract | Synthetic evidence |
| --- | --- | --- |
| Trigger | Suspend after a consensus move of at least four percentage points, a material score event or stale transport. | The goal-shock walkthrough crosses the two-provider quorum and four-point policy threshold. |
| Action | Withdraw every open paper quote immediately and reject unsafe fills while protected. | Six paper quotes are cancelled at the first material breach. |
| Recovery | Keep the market withdrawn until score confirmation, transport freshness, the minimum hold and three stable observations all pass. | The walkthrough pauses at cancellation and recovery checkpoints before releasing replacement quotes. |
| Failure boundary | Live mode fails closed when credentials or contracts are invalid. | The public status endpoint reports configuration required and does not substitute synthetic data in live mode. |

The distinguishing idea is that safe recovery is a first-class autonomous decision. Detecting a shock is not enough: ProofSwitch explains why the market remains withdrawn and records the evidence that permits reopening.

## TxLINE endpoints integrated

The following upstream surface is implemented and contract-tested. It must be described as **integrated**, not **used live**, until a sponsor token is supplied and a genuine session is recorded.

| Method | Endpoint | Use in ProofSwitch |
| --- | --- | --- |
| `POST` | `/auth/guest/start` | Create an anonymous guest session and return its short-lived JWT. |
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

The integration design benefits from the separation between initial snapshots and SSE updates, the normalised fixture, odds and score families, and StablePrice consensus values that map cleanly into a shock-detection policy. That structure lets the synthetic production-path rehearsal exercise the intended live reducer without representing the rehearsal as genuine TxLINE traffic.

The main friction was the multi-part live setup: sponsor-token access, guest-session authentication and matching configuration across the API host, Solana network, RPC and programme ID. A compact end-to-end devnet example covering authentication, stream resumption, score-sequence handling and the stat-validation proof lifecycle would reduce integration time.

This feedback reflects implementation against the documented contracts and local adapter tests. No credential-backed TxLINE call has been made in this workspace, so observed live reliability, latency and payload behaviour remain unknown. A live-run addendum must replace or extend this paragraph after sponsor access is supplied.

## Eligibility boundary

The application, synthetic API, strategy engine, paper execution, documentation and automated tests work now. The remaining sponsor dependency is a genuine TxLINE session. Final eligibility cannot be claimed until an activated sponsor token is configured and at least one real fixture, odds and score-stream run is recorded. Solana proof validation remains optional and unclaimed unless genuine proof material succeeds.
