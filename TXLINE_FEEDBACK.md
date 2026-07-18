# TxLINE API Feedback

## What worked well

The separation between initial snapshots and server-sent event streams gives an agent a clear bootstrap and update model. The normalised fixture, odds and score families reduce provider-specific branching, while StablePrice consensus values map directly into ProofSwitch’s price-shock policy. That structure allowed the project to keep transport adapters separate from one deterministic risk reducer.

The dedicated stat-validation endpoint also creates a useful boundary between receiving sports data and making a stronger verification claim. ProofSwitch can preserve the fixture, score sequence and requested stat keys without labelling the result as Solana-verified until the read-only validation succeeds.

## Friction

The live setup has several coordinated parts: sponsor-token access, guest-session authentication, network-specific API origin, Solana RPC and programme ID. A single end-to-end devnet example covering authentication, fixture selection, snapshot bootstrap, SSE resumption, score-sequence handling and stat validation would reduce integration time.

The fixture, odds and score payload families use different field casing and shapes, so an application still needs a strict normalisation and contract-error layer even though the feed is described as normalised. ProofSwitch implements that layer and fails closed when required fields do not match the expected contract.

## Evidence boundary

This feedback is based on the documented contracts, implemented adapters and local contract tests. No sponsor token is configured in this workspace and no credential-backed TxLINE request has been observed. Live reliability, latency, subscription behaviour and real payload edge cases therefore remain unknown. Add a dated, redacted live-run note here after genuine access is supplied; do not invent those observations.
