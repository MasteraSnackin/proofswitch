# Research Question

What facts matter before ProofSwitch can honestly claim live TxLINE and Solana verification readiness for the hackathon demo?

## Sources Checked

- TxLINE World Cup Free Tier documentation, checked 18 July 2026: https://txline.txodds.com/documentation/worldcup
- Solana RPC overview, checked 18 July 2026: https://solana.com/docs/rpc
- Solana `simulateTransaction` documentation, checked 18 July 2026: https://solana.com/docs/rpc/http/simulatetransaction
- Anchor TypeScript client documentation, checked 18 July 2026: https://www.anchor-lang.com/docs/clients/typescript

## Findings

- TxLINE documentation states that World Cup free-tier access still requires a Solana wallet on the selected network, enough SOL for normal fees and matching network configuration across wallet, RPC, program ID, guest JWT and API host.
- TxLINE documentation lists devnet host `https://txline-dev.txodds.com` and devnet program ID `6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J`, matching this repository's defaults.
- TxLINE documentation describes fixture, odds, score and validation-proof API areas, which aligns with this app's narrow upstream adapter surface.
- Solana RPC documentation distinguishes clusters and notes that public endpoints are shared infrastructure. That supports treating public devnet RPC as acceptable for a demo, not a production reliability plan.
- Solana `simulateTransaction` documentation states simulation does not broadcast the transaction. That supports the app's read-only validation boundary, while still requiring a genuine proof and valid runtime configuration before claiming verification.
- Anchor TypeScript documentation confirms the IDL-driven `program.methods` builder flow used by the validation implementation approach.

## Options

- Option 1: Keep the current local-first demo and add credentials later. Lowest risk for judging before sponsor access; does not prove live data.
- Option 2: Add credentials and perform a single controlled fixture run. Best next evidence step; requires sponsor token and redacted logging discipline.
- Option 3: Push toward production deployment now. Higher scope and risk; rate limiting, logging, stream fan-out and public-data policy are not yet production-grade.

## Recommendation

Use Option 2 after credentials are issued. Run the Live preflight first, then connect one covered fixture, request proof evidence and update `BUILD_LOG.md` with redacted endpoint, status and contract observations.

## Unknowns

- Whether the organiser allows one project to enter both London local judging and the global pool through one submission.
- Whether TxODDS permits any public derived metrics from a genuine TxLINE run.
- Whether a matching score-stat proof and posted daily root will be available during the demo window.
- Whether the public devnet RPC will be reliable enough during judging.

## Next Experiment

After token activation, run:

1. Live preflight.
2. Fixture discovery.
3. One odds snapshot and one scores snapshot.
4. Both SSE streams for a short controlled window.
5. Proof request for the latest real score sequence.
6. Optional read-only Solana validation if the public simulation payer is configured.
