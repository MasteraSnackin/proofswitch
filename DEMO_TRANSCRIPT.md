# ProofSwitch — Published Demo Transcript

Video: <https://youtu.be/0uxTKx0Jf0Q>

Published duration: 4 minutes 48 seconds

This is the exact narration used in the published submission video. The recording uses labelled synthetic data and does not claim a credential-backed TxLINE session or successful Solana verification.

During live football, a goal, sharp odds move or stale feed can leave unsafe quotes exposed before a trader reacts. ProofSwitch is an autonomous circuit breaker for those moments. It is a paper-trading tool for the Trading Tools and Agents track.

This recording uses the application’s clearly labelled synthetic World Cup fixture because no TxLINE sponsor token is configured. I will show the working strategy and the exact credential-ready TxLINE path without claiming live sponsor data.

The opening frames establish a stable synthetic market and six paper quotes. In this goal-shock scenario, two providers move far enough to breach the configured four-percentage-point threshold. ProofSwitch suspends the market and cancels all six quotes automatically, before the score confirmation arrives.

The decision receipt records the trigger, action and result. The input is explicitly synthetic, execution is paper only, and neither TxLINE data nor Solana verification is claimed in this run.

The policy does not reopen as soon as prices settle. It waits for the confirming score event, fresh transport, the minimum hold and three stable observations. At this checkpoint, every recovery condition has passed and a replacement price regime is ready, but freshness still gates release.

Only when that final guard passes does ProofSwitch release six newly priced paper orders. The timeline makes every transition inspectable. The counterfactual panel models what stale fills could have cost if the old quotes had remained available. This is modelled risk, not realised profit or claimed savings.

The separate Demo Lab also tests a single-source outlier, where unnecessary cancellation is suppressed, and feed staleness, where quotes remain withdrawn until freshness and stability return.

This is the production-path synthetic rehearsal. It sends TxLINE-shaped fixture, odds, score and stream events through the production live reducer and paper executor. The rehearsal and the intended credential-backed mode use this same live reducer. The explanatory Demo Lab is separate.

The trading scorecard reports suspension time, safe reopening delay, cancelled paper quotes, rejected paper fills and paper profit and loss. The audit timeline preserves feed, agent, command and execution decisions for replay. The sponsor-evidence panel states the source, execution boundary and verification state so synthetic evidence cannot be mistaken for live TxLINE data.

For a genuine TxLINE score sequence, ProofSwitch can request stat-validation material and pass it to the optional read-only Solana validation boundary. Retrieving proof material is not treated as verification. The interface displays verified only after matching validation succeeds. This recording therefore says no claim.

When sponsor access is configured, the server begins by creating an anonymous guest session at post auth slash guest slash start and receives a short-lived JWT. The activated API token is a separate credential. ProofSwitch discovers covered fixtures from the fixtures snapshot endpoint, seeds the agent from odds and score snapshots, then consumes the odds and score server-sent-event streams.

Those inputs are adapted into one internal event contract before entering the risk engine. Both credentials remain on the server. Missing credentials fail closed: live mode does not silently substitute synthetic data, while rehearsal mode is labelled throughout the interface.

The endpoint table documents every upstream route implemented by the adapters, including fixture discovery, odds and score snapshots, both streams, and the stat-validation request. The integration is contract-tested and credential-ready. It is not presented as evidence of observed TxLINE latency, reliability or live payload behaviour.

ProofSwitch is designed for sports trading teams, market makers and risk operators who need fast, explainable protection during volatile match moments. It is paper execution only and does not create or settle prediction markets.

The deployed application, public repository, technical overview, exact endpoint mapping and honest pre-credential API feedback are published with the submission. A genuine credential-backed TxLINE session remains the final sponsor dependency.
