# ProofSwitch build and provenance record

This file is a factual disclosure and entrant sign-off aid. It is not proof that
the project is eligible for a prize. Update it when facts change; do not convert
unchecked items into claims without evidence.

## Known facts as at 15 July 2026

- This repository is a pre-hackathon exploratory baseline. The current working
  tree has no trustworthy committed baseline from which to prove when each file
  was created.
- The entrant directed a local-first mock build without a TxLINE token or Solana
  wallet, with the intended target of both London judging and the global Trading
  Tools and Agents track.
- No genuine TxLINE World Cup request, live score proof, Solana validation,
  deployment, public repository publication or organiser submission has been
  completed in this baseline.
- Every displayed order and fill is paper-only. Synthetic prices, fixtures,
  scores, P&L and counterfactual values are fictional.
- Substantial AI coding assistance was used before the event. That assistance
  must be disclosed wherever the current organiser terms or submission form
  require it.

## Pre-event AI-assisted implementation

The 15 July 2026 exploratory work included assistance with:

- the Demo Lab, guided judge walkthrough and responsive dashboard UI;
- TxLINE-shaped server adapters, payload normalisation and resumable SSE;
- the deterministic live risk reducer, paper orders, partial fills, exposure,
  P&L, maximum-liability guard and emergency stop;
- browser recovery, evidence-pack creation and SHA-256 preview;
- the browser-independent local runner and deterministic trace replay metrics;
- operator access cookies and best-effort per-isolate capacity limits;
- proof-contract parsing and the read-only Solana validation boundary;
- canonical private evidence serialisation with exact UTF-8 and retained-record
  limits, rejecting over-limit exports rather than truncating them;
- a synthetic-only aggregate public demo summary whose TxLINE-derived download
  path remains blocked without explicit sponsor permission;
- a deterministic successful headless integration-test path covering both SSE
  channels, paper fills, proof collection and clean session closure;
- automated tests, configuration examples and documentation.
- a later local documentation and readiness pass adding judge-mode operations,
  live preflight, setup wizard, scorecard, timeline, sponsor-evidence handoff,
  refreshed README, architecture notes and review reports.

This list describes assisted areas, not human authorship or sponsor acceptance.
The entrant must inspect, understand and materially control the submitted work.

## Entrant decisions

| Date | Decision | Evidence/status |
| --- | --- | --- |
| 15 July 2026 | Build and test locally before adding TxLINE or wallet access | Confirmed in the project brief |
| 15 July 2026 | Target the London local prize and global Trading Tools and Agents track | Confirmed in the project brief; dual-entry mechanics still require organiser confirmation |
| Pending | Select the final product scope and explain why it is materially entrant-led | Entrant sign-off required |
| Pending | Decide what significant work will be completed during the hackathon window | Entrant and organiser confirmation required |
| Pending | Approve the final demo, repository contents and submission claims | Entrant sign-off required |

## Authorised TxLINE run record

No authorised run has occurred. For each genuine sponsor-data test, add one row
without copying tokens, guest JWTs or response payloads.

| Time (Europe/London) | Network | Endpoint | Redacted request shape | HTTP/result | Contract observation | Documentation feedback |
| --- | --- | --- | --- | --- | --- | --- |
| Pending | Pending | Pending | Pending | Pending | Pending | Pending |

Keep any canonical trace containing TxLINE-derived data private. Do not commit,
publish or redistribute licensed feed data. Confirm the permitted scope of any
public derived metrics with TxODDS before including them in a submission.

## Solana validation record

| Time (Europe/London) | Network | Fixture/sequence | Daily root status | `validateStatV2` result | Evidence-pack checksum |
| --- | --- | --- | --- | --- | --- |
| Pending | Pending | Pending | Pending | Pending | Pending |

Do not mark a run verified unless the app receives a genuine proof for the same
fixture and sequence and the configured read-only programme call returns true.

## Local validation record

The following validation was completed locally after the public summary,
bounded canonical evidence, successful headless integration-test path and
live-readiness additions:

- `npm run typecheck`: passed;
- `npm run lint`: passed;
- `npm test`: production build passed and 133 automated tests passed;
- eight-second synthetic headless run: both streams connected, one 5.7-point
  shock suspension, one guarded recovery, two deterministic paper fills,
  55.45 maximum simulated liability and no transport-contract errors;
- private trace replay: passed with matching fill, liability, recovery and final
  status metrics;
- output permission check: report, trace and replay analysis were written with
  owner-only `0600` permissions;
- `npm audit --omit=dev`: zero high or critical findings and seven moderate
  transitive findings. The direct Next, Anchor and Solana packages were already
  at their current registry versions; no forced downgrade or incompatible
  transitive override was applied.

The Anchor runtime now uses its explicit CommonJS entry and the focused runtime
tests pass under both Node 22 and Node 24. This does not establish that the
read-only Solana runtime works against a live RPC; the genuine validation record
above remains pending.

## Public submission artefacts as at 19 July 2026

- Public repository: <https://github.com/MasteraSnackin/proofswitch>
- Deployed application: <https://proofswitch.vercel.app>
- Judge pack: <https://proofswitch.vercel.app/submission>
- Demo video: <https://youtu.be/5bsx35tDo-g> — 4 minutes 48 seconds
- Video build record and exact narration: [`VIDEO_BUILD.md`](./VIDEO_BUILD.md) and [`DEMO_TRANSCRIPT.md`](./DEMO_TRANSCRIPT.md)
- Technical documentation and bounded pre-credential feedback are included in
  the repository and judge pack.

These artefacts prove a working synthetic application. They do not replace the
still-required credential-backed TxLINE input recorded below.

## Submission evidence still required

- [ ] Obtain and activate TxLINE access on the intended network.
- [ ] Complete at least one genuine snapshot and odds/scores SSE run.
- [ ] Record useful sponsor API or documentation feedback without licensed data.
- [ ] Validate a genuine score proof against its matching posted daily root, or
      state plainly that Solana validation remains unverified.
- [ ] Confirm with organisers whether one project can enter both London and the
      global pool and whether separate submissions are required.
- [ ] Confirm that the extent and timing of pre-event and AI-assisted work comply
      with the current hackathon terms.
- [ ] Complete significant entrant-led work during the event if the rules require
      it, and record the decisions and changes here.
- [x] Create the public repository and exclude secrets, private traces and
      licensed raw data from tracked files.
- [ ] Obtain explicit TxODDS permission before publishing any derived summary
      from a genuine TxLINE run; without it, share only the synthetic public demo
      summary.
- [x] Produce the deployed app, functional synthetic API, documentation and
      sub-five-minute demonstration video required for initial screening.
- [ ] Submit through the organiser's official channel before the deadline.

## Entrant sign-off

- [ ] I have reviewed the source and can explain the data flow, policy, paper
      execution model, failure modes and verification boundary.
- [ ] I confirm that the provenance and timing statements above are accurate.
- [ ] I have disclosed pre-existing and AI-assisted work where required.
- [ ] I approved every material product and submission claim.
- [ ] I verified that no secret or licensed raw data is present in the public
      repository or evidence pack.

Sign-off date: pending
