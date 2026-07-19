# ProofSwitch — Copy-ready Submission Form

## Project name

ProofSwitch

## Primary track

Trading Tools and Agents

## One-line description

ProofSwitch is an autonomous in-play circuit breaker that detects World Cup odds shocks and stale feeds, withdraws unsafe paper quotes, and reopens only after deterministic recovery evidence.

## Briefly explain your project

ProofSwitch is an autonomous paper-trading risk operator for volatile World Cup markets. It consumes fixture, odds, score and stream-health signals, detects consensus shocks or stale transport, withdraws every unsafe paper quote, and reopens only after score confirmation, fresh data, a minimum hold and three stable observations all pass. The working application includes a guided goal-shock walkthrough, outlier and stale-feed tests, a production-path rehearsal, an inspectable decision timeline and machine-readable evidence.

The TxLINE integration implements guest authentication, fixture discovery, odds and score snapshots, both server-sent-event streams and the stat-validation endpoint behind a server-only credential boundary. Live mode fails closed when credentials are absent; the public judge deployment is therefore clearly labelled as synthetic and paper-only and does not claim a credential-backed TxLINE session or successful Solana verification. This gives judges a functional application now while keeping the sponsor-data and proof boundaries honest.

## Demo video

<https://youtu.be/M9kMuOt1kwc> — 4 minutes 48 seconds

## Public repository

<https://github.com/MasteraSnackin/proofswitch>

## Working application

<https://proofswitch.vercel.app>

Guided judge path: <https://proofswitch.vercel.app/?judge=1>

Technical judge pack: <https://proofswitch.vercel.app/submission>

Machine-readable submission manifest: <https://proofswitch.vercel.app/api/submission>

## Problem

Goals, red cards, sharp odds movements and feed failures can leave stale in-play quotes exposed during the seconds when markets are most volatile. A trader may not react quickly enough, while reopening too early can recreate the same risk.

## Solution

ProofSwitch continuously evaluates consensus prices, scores and stream freshness. A material signal triggers automatic cancellation of every unsafe paper quote. The agent then enforces a hold and waits for score confirmation, fresh transport and stable consensus evidence before deriving and releasing a replacement quote regime. Every feed event, policy decision and paper command is retained in an inspectable audit trail.

## Why it fits Trading Tools and Agents

- **Ingest:** fixture, odds and score snapshots plus odds and score SSE streams are adapted into one internal event contract.
- **Detect:** consensus shocks, score events and stale transport trigger deterministic risk policies.
- **Execute:** the agent cancels, holds, reprices and reopens paper quotes without manual intervention after the scenario starts.

## Business highlights

- Primary users: sports trading teams, market makers and risk operators.
- Value: fast, explainable risk protection during high-volatility match moments.
- Differentiator: safe recovery is a first-class autonomous decision, not an immediate reopen after prices settle.
- Current execution boundary: paper only; no real betting or exchange orders.

## Technical highlights

- Deterministic TypeScript risk reducer shared by the production-path rehearsal and intended live mode.
- Separate explanatory Demo Lab for reproducible shock, outlier and stale-feed scenarios.
- Snapshot bootstrap and resumable server-sent-event adapters.
- Fail-closed live mode; missing credentials never silently substitute synthetic data.
- Server-side credential boundary, guarded judge access and bounded evidence exports.
- Optional read-only Solana proof-validation boundary that never reports verified without a genuine successful validation.
- Automated lint, type, build, reducer, adapter, streaming, access-control and evidence tests.

## TxLINE endpoints integrated

- `POST /auth/guest/start`
- `GET /api/fixtures/snapshot`
- `GET /api/odds/snapshot/{fixtureId}`
- `GET /api/scores/snapshot/{fixtureId}`
- `GET /api/odds/stream?fixtureId=...`
- `GET /api/scores/stream?fixtureId=...`
- `GET /api/scores/stat-validation?fixtureId=...&seq=...&statKeys=...`

## TxLINE API feedback

The integration design benefits from the clear snapshot-plus-SSE bootstrap model, the normalised fixture, odds and score families, and StablePrice consensus values that map directly into a shock policy.

The main friction was coordinating sponsor-token access, guest-session authentication and matching configuration across API host, network, RPC and programme ID. A single end-to-end devnet example covering authentication, fixture selection, stream resumption, score sequences and stat validation would reduce integration time. The different field casing and payload shapes across fixture, odds and score families also require a strict normalisation and contract-error layer.

This feedback is based on documented contracts, implemented adapters and local contract tests. No credential-backed TxLINE request has been observed, so live latency, reliability and payload edge cases remain unknown.

## Evidence boundary

The public application is a working, labelled synthetic paper-trading agent rather than a static mock-up. A genuine fixture plus odds and score-stream run remains pending an activated TxLINE sponsor token. Live TxLINE behaviour and successful Solana verification are not claimed.
