export const submissionLinks = {
  application: "https://proofswitch.vercel.app",
  judgeWalkthrough: "https://proofswitch.vercel.app/?judge=1",
  judgePack: "https://proofswitch.vercel.app/submission",
  repository: "https://github.com/MasteraSnackin/proofswitch",
  demoVideo: "https://youtu.be/0uxTKx0Jf0Q",
  demoVideoEmbed: "https://www.youtube-nocookie.com/embed/0uxTKx0Jf0Q",
} as const;

export const syntheticJudgeFixtureId = 20_260_001;

export const publicJudgeEndpoints = [
  {
    label: "Submission manifest",
    path: "/api/submission",
    purpose: "Machine-readable links, track fit, evidence state and integration boundary.",
  },
  {
    label: "Runtime status",
    path: "/api/status",
    purpose: "Current data mode, live readiness and safe capability flags.",
  },
  {
    label: "Synthetic fixtures",
    path: "/api/fixtures",
    purpose: "Labelled World Cup fixture data for the public judge rehearsal.",
  },
  {
    label: "Synthetic odds",
    path: `/api/odds?fixtureId=${syntheticJudgeFixtureId}`,
    purpose: "Normalised match-winner probabilities used by the rehearsal.",
  },
  {
    label: "Synthetic score",
    path: `/api/scores?fixtureId=${syntheticJudgeFixtureId}`,
    purpose: "Normalised score and match state used by the rehearsal.",
  },
  {
    label: "Odds SSE stream",
    path: `/api/stream?kind=odds&fixtureId=${syntheticJudgeFixtureId}`,
    purpose: "Resumable consensus-odds events with explicit synthetic source labels.",
  },
  {
    label: "Score SSE stream",
    path: `/api/stream?kind=scores&fixtureId=${syntheticJudgeFixtureId}`,
    purpose: "Resumable score events with explicit synthetic source labels.",
  },
] as const;

export const txlineEndpoints = [
  {
    method: "POST",
    path: "/auth/guest/start",
    purpose: "Create an anonymous guest session and return its short-lived JWT.",
  },
  {
    method: "GET",
    path: "/api/fixtures/snapshot",
    purpose: "Discover covered World Cup fixtures.",
  },
  {
    method: "GET",
    path: "/api/odds/snapshot/{fixtureId}",
    purpose: "Seed the match-winner StablePrice state before streaming.",
  },
  {
    method: "GET",
    path: "/api/scores/snapshot/{fixtureId}",
    purpose: "Seed the score and match-state reducer.",
  },
  {
    method: "GET",
    path: "/api/odds/stream?fixtureId=...",
    purpose: "Receive live consensus-price and heartbeat events over SSE.",
  },
  {
    method: "GET",
    path: "/api/scores/stream?fixtureId=...",
    purpose: "Receive score, disciplinary and match-state events over SSE.",
  },
  {
    method: "GET",
    path: "/api/scores/stat-validation?fixtureId=...&seq=...&statKeys=...",
    purpose: "Retrieve validation material for the optional Solana proof boundary.",
  },
] as const;
