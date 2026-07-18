export const submissionLinks = {
  repository: "https://github.com/MasteraSnackin/proofswitch",
  demoVideo: "https://youtu.be/mQ84gAyAx9s",
} as const;

export const syntheticJudgeFixtureId = 20_260_001;

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
