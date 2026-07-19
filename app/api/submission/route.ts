import {
  publicJudgeEndpoints,
  submissionLinks,
  txlineEndpoints,
} from "../../../lib/submission";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const origin = new URL(request.url).origin;

  return Response.json(
    {
      schema: "proofswitch.submission.v1",
      project: "ProofSwitch",
      primaryTrack: "Trading Tools and Agents",
      localJudgingContext: "London",
      status: {
        screeningArtefacts: "complete",
        application: "working_synthetic_agent",
        execution: "paper_only",
        txlineCredentialRun: "pending_sponsor_token",
        solanaVerification: "not_claimed",
      },
      screeningRequirements: [
        {
          requirement: "Demo video up to five minutes",
          state: "ready",
          evidence: submissionLinks.demoVideo,
          detail: "Published duration: 4 minutes 48 seconds.",
        },
        {
          requirement: "Public repository",
          state: "ready",
          evidence: submissionLinks.repository,
        },
        {
          requirement: "Application access",
          state: "ready",
          evidence: origin,
          detail: "Working UI, JSON endpoints and SSE streams in labelled synthetic mode.",
        },
        {
          requirement: "Brief technical documentation",
          state: "ready",
          evidence: `${origin}/submission`,
        },
        {
          requirement: "TxLINE API feedback",
          state: "ready_with_evidence_boundary",
          evidence: `${origin}/submission#txline-feedback`,
          detail: "Contract-level feedback only; no credential-backed observations are claimed.",
        },
      ],
      trackEvidence: {
        ingest: "Fixture, odds and score snapshot/SSE adapters feed one normalised event contract.",
        detect: "Consensus shocks, score events and stale transport trigger deterministic policy decisions.",
        execute: "The agent cancels, holds, reprices and reopens paper quotes without manual intervention.",
      },
      links: {
        ...submissionLinks,
        application: origin,
        judgeWalkthrough: `${origin}/?judge=1`,
        judgePack: `${origin}/submission`,
      },
      publicJudgeEndpoints,
      integratedTxlineEndpoints: txlineEndpoints,
      evidenceBoundary:
        "The public deployment is a working synthetic rehearsal. Genuine live TxLINE evidence remains pending an activated sponsor token.",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
