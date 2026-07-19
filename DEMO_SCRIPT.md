# ProofSwitch — Demo Video Timed Outline

The exact narration used by the published video is in [`DEMO_TRANSCRIPT.md`](./DEMO_TRANSCRIPT.md). This file is the judge-facing timed outline and shot list.

Published length: **4 minutes 48 seconds**. Absolute maximum: **5 minutes**.

## 0:00–0:30 — The problem

“During a World Cup match, one goal or a stale data feed can move the market before a trader has time to react. If old quotes remain live for even a few seconds, a market maker can take avoidable risk. ProofSwitch is an autonomous circuit breaker for those moments.”

Show the ProofSwitch header, Trading Tools and Agents track label and synthetic-data boundary.

## 0:30–0:55 — The product

“ProofSwitch watches consensus odds, scores and stream health. It detects sharp movement, withdraws every unsafe paper quote, waits for deterministic recovery evidence, then reopens with a new fair regime. Every decision is recorded for review.”

Show the market, agent state and five-stage strategy path.

## 0:55–2:20 — Working application

Start the judge walkthrough and run the goal-shock scenario.

“This is the working deterministic rehearsal. The first frames establish a stable market. The incoming price shock crosses the four-percentage-point policy boundary. ProofSwitch suspends the market and cancels six paper quotes automatically. It does not reopen immediately. It waits for score confirmation, fresh transport and three stable observations. Once every gate passes, the agent reprices and reopens.”

Show the cancellation checkpoint, hold/recovery state, reopened quotes, decision receipt and counterfactual-risk comparison.

“The separate Demo Lab simulator also demonstrates a single-source outlier without unnecessary quote churn and a stale feed by withdrawing the market until freshness returns.”

## 2:20–3:35 — How TxLINE powers the backend

Open the Live Control Room and then the judge submission pack.

“The live backend is implemented around TxLINE’s World Cup surface. The server starts an anonymous guest session at `POST /auth/guest/start` to obtain a JWT. The activated API token is a separate credential. It discovers fixtures from `/api/fixtures/snapshot`, seeds odds and scores from their snapshot endpoints, then consumes both SSE streams. Those inputs are adapted into the production live reducer used by this synthetic pipeline rehearsal. The browser receives neither credential.”

“This recording uses the labelled synthetic production-path rehearsal because no sponsor credential is configured in this workspace. The live path fails closed; it never silently replaces missing TxLINE data with synthetic data. A credential-backed fixture and stream run is still required before claiming live TxLINE evidence.”

Show runtime status, credential checks, the endpoint table and the synthetic-source label.

## 3:35–4:20 — Evidence and Solana boundary

“The scorecard measures suspension latency, reopening delay, cancelled quotes, rejected fills and paper P-and-L. The timeline preserves feed, agent and execution decisions. For real score events, ProofSwitch can request TxLINE stat-validation material and pass it to a read-only Solana validation boundary. Proof retrieval alone is not called verification: the UI says verified only after a genuine validation succeeds.”

Show the scorecard, audit timeline and unverified Solana state.

## 4:20–4:48 — Close

“ProofSwitch is built for sports trading teams and market makers who need fast, explainable protection during high-volatility moments. It is a working paper-trading agent, not a betting app. The submission targets Trading Tools and Agents and the London local prize. The deployed application, public repository, technical documentation and exact TxLINE endpoint list are linked with this submission.”

End on the submission page with application and repository links visible.

## Recording checklist

- Keep the total duration below five minutes.
- Show the working app, not only slides or static designs.
- Keep the synthetic-source label visible whenever synthetic data is shown.
- If a real TxLINE session is available, replace the synthetic-backend disclaimer with redacted live preflight and stream evidence.
- Do not expose the sponsor API token, guest JWT, judge access code, signing secret, wallet material or licensed raw payloads.
- Show the deployed application URL and public repository URL in the final frame.
