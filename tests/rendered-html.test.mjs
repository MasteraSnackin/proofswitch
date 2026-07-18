import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

async function request(path = "/", headers = { accept: "text/html" }) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${path}`, { headers }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

async function render() {
  return request();
}

test("server-renders the ProofSwitch prototype", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>ProofSwitch — World Cup in-play risk operator<\/title>/i);
  assert.match(html, /World Cup 2026/i);
  assert.match(html, /Synthetic group-stage replay/i);
  assert.match(html, /Aurora/i);
  assert.match(html, /Pacifica/i);
  assert.match(html, /Run replay/i);
  assert.match(html, /Start 90-second judge walkthrough/i);
  assert.match(html, /Live control room/i);
  assert.match(html, /Primary track: Trading Tools and Agents/i);
  assert.match(html, /Primary submission track/i);
  assert.match(html, /Consumer and Fan Experiences/i);
  assert.match(html, /Prediction Markets and Settlement/i);
  assert.match(html, /Not claimed in this build/i);
  assert.match(html, /TxLINE track coverage/i);
  assert.match(html, /Sharp movement detector \+ in-play market maker/i);
  assert.match(html, /mandatory live-input requirement remains blocked/i);
  assert.match(html, /Goal shock \+ safe reopen/i);
  assert.match(html, /What this replay demonstrates/i);
  assert.match(html, /Solana not connected/i);
  assert.match(html, /does not connect to TxLINE/i);
  assert.match(html, /Paper execution/i);
  assert.match(html, /not affiliated with a tournament organiser/i);
  assert.doesNotMatch(html, /FIFA/i);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("keeps the application deterministic and integration boundaries explicit", async () => {
  const [page, submissionPage, submissionConfig, styles, simulation, liveDashboard, liveEvidence, publicDemoSummary, layout, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/submission/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/submission.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/simulation.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/live-dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/live-evidence.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/public-demo-summary.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /applyNextEvent/);
  assert.match(page, /demoScenarios/);
  assert.match(page, /<progress/);
  assert.match(page, /<dialog/);
  assert.match(page, /Synthetic feed/);
  assert.match(page, /trackFitCards/);
  assert.match(page, /txlineCoverageCards/);
  assert.match(page, /Primary submission track/);
  assert.match(page, /Prediction Markets and Settlement/);
  assert.match(page, /does not create outcome markets or settle positions on-chain yet/);
  assert.match(page, /live-input gap stated plainly/);
  assert.match(page, /Demo, repo and endpoint checklist/);
  assert.match(page, /Judge pack/);
  assert.match(page, /Open technical documentation and submission pack/);
  assert.match(submissionPage, /Judge submission pack|Judge pack/);
  assert.match(submissionPage, /Protect market makers during the seconds that matter/);
  assert.match(submissionPage, /Integrated upstream endpoints/);
  assert.match(submissionPage, /Pre-credential integration experience/);
  assert.match(submissionPage, /No credential-backed TxLINE call has been made/);
  assert.match(submissionPage, /Complete in under five minutes/);
  assert.match(submissionConfig, /\/api\/fixtures\/snapshot/);
  assert.match(submissionConfig, /\/api\/scores\/stat-validation/);
  assert.match(submissionConfig, /https:\/\/github\.com\/MasteraSnackin\/proofswitch/);
  assert.match(submissionConfig, /https:\/\/youtu\.be\/mQ84gAyAx9s/);
  assert.match(page, /Start 90-second judge walkthrough/);
  assert.match(page, /Open production-path rehearsal/);
  assert.match(page, /Latest material decision/);
  assert.match(page, /setScenarioId\("goalShock"\)/);
  assert.match(page, /setSpeed\(4\)/);
  assert.match(page, /nextCursor === 4/);
  assert.match(page, /nextCursor === 10/);
  assert.match(page, /No TxLINE claim/);
  assert.match(page, /No Solana verification claim/);
  assert.match(styles, /\.header-status\s*\{[\s\S]*position:\s*fixed/);
  assert.match(styles, /\.audit-row \.source\s*\{\s*display:\s*inline-flex/);
  assert.match(page, /Awaiting credentials/);
  assert.match(page, /validateStatV2/);
  assert.match(simulation, /consensusFromBooks/);
  assert.match(simulation, /reduceEvent/);
  assert.match(simulation, /calculateCounterfactual/);
  assert.match(simulation, /staleAfterMs:\s*2_500/);
  assert.match(simulation, /demoScenarios/);
  assert.doesNotMatch(simulation, /counterfactualLoss:\s*109\.96/);
  assert.doesNotMatch(simulation, /Math\.random|Date\.now/);
  assert.match(liveDashboard, /Run pipeline rehearsal/);
  assert.match(liveDashboard, /Replace the saved paper session/);
  assert.match(liveDashboard, /Inspect evidence pack/);
  assert.match(liveDashboard, /World Cup match queue/);
  assert.match(liveDashboard, /SHA-256 checksum/);
  assert.match(liveDashboard, /Open quoted quantity/);
  assert.match(liveDashboard, /Audit retention/);
  assert.match(liveDashboard, /Licensed-data boundary/);
  assert.match(liveDashboard, /Apply deterministic 25% fill/);
  assert.match(liveDashboard, /Unlock the live control room/);
  assert.match(liveDashboard, /Public demo summary/);
  assert.match(liveDashboard, /Live-source public download blocked/);
  assert.match(liveDashboard, /Download synthetic summary/);
  assert.match(liveDashboard, /parseLiveProofResult/);
  assert.match(liveDashboard, /Live readiness/);
  assert.match(liveDashboard, /Keys can be added later/);
  assert.match(liveDashboard, /status\.liveReadiness\.missing/);
  assert.match(liveDashboard, /Judge mode/);
  assert.match(liveDashboard, /runLivePreflight/);
  assert.match(liveDashboard, /Live connection preflight/);
  assert.match(liveDashboard, /const preflightMode = pipelineRehearsal \|\| !liveConfigured \? "synthetic" : "live"/);
  assert.match(liveDashboard, /\.env\.local setup wizard/);
  assert.match(liveDashboard, /setupTemplate/);
  assert.match(liveDashboard, /Trading-agent scorecard/);
  assert.match(liveDashboard, /Trading Tools and Agents/);
  assert.match(liveDashboard, /detects trading signals/);
  assert.match(liveDashboard, /Sponsor evidence/);
  assert.match(liveDashboard, /Fixture timeline/);
  assert.match(liveDashboard, /disabled-reason/);
  assert.match(liveDashboard, /proofswitch\.demo-bundle\.v1/);
  assert.match(liveEvidence, /proofswitch\.live-evidence\.v1/);
  assert.match(liveEvidence, /device-local-unsigned/);
  assert.match(publicDemoSummary, /proofswitch\.public-demo-summary\.v1/);
  assert.match(publicDemoSummary, /explicit sponsor permission/);
  assert.doesNotMatch(publicDemoSummary, /priceHistory:/);
  assert.match(layout, /ProofSwitch/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);

  await assert.rejects(access(new URL("../app/_sites-preview", import.meta.url)));
});

test("serves safe synthetic APIs and an explicit unconfigured proof boundary", async () => {
  const statusResponse = await request("/api/status", { accept: "application/json" });
  assert.equal(statusResponse.status, 200);
  assert.match(statusResponse.headers.get("cache-control") ?? "", /no-store/i);
  const statusEnvelope = await statusResponse.json();
  assert.equal(statusEnvelope.data.mode, "synthetic");
  assert.equal(statusEnvelope.data.liveReady, false);
  assert.equal(statusEnvelope.data.liveReadiness.state, "configuration_required");
  assert.deepEqual(statusEnvelope.data.liveReadiness.missing, [
    "PROOFSWITCH_MODE=live",
    "TXLINE_API_TOKEN",
    "PROOFSWITCH_ACCESS_CODE",
    "PROOFSWITCH_ACCESS_SIGNING_SECRET",
  ]);
  assert.match(statusEnvelope.data.liveReadiness.nextAction, /Add the missing server-side values/i);
  assert.equal(statusEnvelope.data.capabilities.paperExecution, true);
  assert.equal(JSON.stringify(statusEnvelope).includes("X-Api-Token"), false);

  const fixturesResponse = await request("/api/fixtures", { accept: "application/json" });
  assert.equal(fixturesResponse.status, 200);
  const fixturesEnvelope = await fixturesResponse.json();
  assert.equal(fixturesEnvelope.source, "synthetic");
  assert.equal(fixturesEnvelope.data.length, 1);
  assert.equal(fixturesEnvelope.data[0].home.name, "Aurora");
  const fixtureId = fixturesEnvelope.data[0].fixtureId;

  const [oddsResponse, scoresResponse] = await Promise.all([
    request(`/api/odds?fixtureId=${fixtureId}`, { accept: "application/json" }),
    request(`/api/scores?fixtureId=${fixtureId}`, { accept: "application/json" }),
  ]);
  assert.equal(oddsResponse.status, 200);
  assert.equal(scoresResponse.status, 200);
  const odds = await oddsResponse.json();
  const scores = await scoresResponse.json();
  assert.equal(odds.data.probabilities.HOME + odds.data.probabilities.DRAW + odds.data.probabilities.AWAY, 1);
  assert.equal(scores.data.seq, 1);

  const proofResponse = await request(
    `/api/verify?fixtureId=${fixtureId}&seq=${scores.data.seq}&statKeys=1,2,5,6`,
    { accept: "application/json" },
  );
  assert.equal(proofResponse.status, 200);
  const proof = await proofResponse.json();
  assert.equal(proof.state, "UNCONFIGURED");
  assert.equal(proof.verified, false);
  assert.equal(proof.proof, null);
});

test("streams canonical synthetic SSE with resumable event IDs", async () => {
  const response = await request(
    "/api/stream?kind=odds&fixtureId=20260001",
    { accept: "text/event-stream" },
  );
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/event-stream/i);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/i);
  assert.ok(response.body);
  const reader = response.body.getReader();
  const first = await reader.read();
  await reader.cancel();
  assert.equal(first.done, false);
  const text = new TextDecoder().decode(first.value);
  assert.match(text, /event: odds/);
  assert.match(text, /id: synthetic-odds-1/);
  assert.match(text, /"source":"synthetic"/);
  assert.match(text, /"eventId":"synthetic-odds-1"/);
});

test("fails closed when live mode is selected without a token", async () => {
  const previousMode = process.env.PROOFSWITCH_MODE;
  const previousToken = process.env.TXLINE_API_TOKEN;
  process.env.PROOFSWITCH_MODE = "live";
  delete process.env.TXLINE_API_TOKEN;
  try {
    const response = await request("/api/fixtures", { accept: "application/json" });
    assert.equal(response.status, 503);
    const payload = await response.json();
    assert.equal(payload.error.code, "LIVE_NOT_CONFIGURED");
    assert.match(payload.error.message, /Synthetic data was not substituted/i);
  } finally {
    if (previousMode === undefined) delete process.env.PROOFSWITCH_MODE;
    else process.env.PROOFSWITCH_MODE = previousMode;
    if (previousToken === undefined) delete process.env.TXLINE_API_TOKEN;
    else process.env.TXLINE_API_TOKEN = previousToken;
  }
});

test("reports live credential readiness without exposing configured values", async () => {
  const previous = {
    mode: process.env.PROOFSWITCH_MODE,
    token: process.env.TXLINE_API_TOKEN,
    code: process.env.PROOFSWITCH_ACCESS_CODE,
    signingSecret: process.env.PROOFSWITCH_ACCESS_SIGNING_SECRET,
    validation: process.env.SOLANA_VALIDATION_ENABLED,
    payer: process.env.SOLANA_SIMULATION_PAYER_PUBLIC_KEY,
  };
  process.env.PROOFSWITCH_MODE = "live";
  process.env.TXLINE_API_TOKEN = "test-token-not-returned";
  process.env.PROOFSWITCH_ACCESS_CODE = "judge-code";
  process.env.PROOFSWITCH_ACCESS_SIGNING_SECRET =
    "0123456789abcdef0123456789abcdef";
  process.env.SOLANA_VALIDATION_ENABLED = "false";
  delete process.env.SOLANA_SIMULATION_PAYER_PUBLIC_KEY;

  try {
    const response = await request("/api/status", { accept: "application/json" });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.data.mode, "live");
    assert.equal(payload.data.liveConfigured, true);
    assert.equal(payload.data.liveReady, true);
    assert.equal(payload.data.liveReadiness.state, "validation_optional");
    assert.deepEqual(payload.data.liveReadiness.missing, []);
    assert.deepEqual(payload.data.liveReadiness.configured, [
      "PROOFSWITCH_MODE=live",
      "TXLINE_API_TOKEN",
      "PROOFSWITCH_ACCESS_CODE",
      "PROOFSWITCH_ACCESS_SIGNING_SECRET",
    ]);
    const body = JSON.stringify(payload);
    assert.equal(body.includes("test-token-not-returned"), false);
    assert.equal(body.includes("judge-code"), false);
    assert.equal(body.includes("0123456789abcdef0123456789abcdef"), false);
  } finally {
    if (previous.mode === undefined) delete process.env.PROOFSWITCH_MODE;
    else process.env.PROOFSWITCH_MODE = previous.mode;
    if (previous.token === undefined) delete process.env.TXLINE_API_TOKEN;
    else process.env.TXLINE_API_TOKEN = previous.token;
    if (previous.code === undefined) delete process.env.PROOFSWITCH_ACCESS_CODE;
    else process.env.PROOFSWITCH_ACCESS_CODE = previous.code;
    if (previous.signingSecret === undefined) {
      delete process.env.PROOFSWITCH_ACCESS_SIGNING_SECRET;
    } else {
      process.env.PROOFSWITCH_ACCESS_SIGNING_SECRET = previous.signingSecret;
    }
    if (previous.validation === undefined) delete process.env.SOLANA_VALIDATION_ENABLED;
    else process.env.SOLANA_VALIDATION_ENABLED = previous.validation;
    if (previous.payer === undefined) delete process.env.SOLANA_SIMULATION_PAYER_PUBLIC_KEY;
    else process.env.SOLANA_SIMULATION_PAYER_PUBLIC_KEY = previous.payer;
  }
});
