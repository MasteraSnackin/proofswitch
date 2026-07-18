import assert from "node:assert/strict";
import test from "node:test";
import type { Fixture, MatchWinnerOdds, ScoreSnapshot } from "../lib/contracts.ts";
import { defaultLivePolicy } from "../app/live-engine.ts";
import {
  runHeadlessAgent,
  selectHeadlessFixture,
} from "../server/headless-agent.ts";

const now = Date.UTC(2026, 6, 15, 12, 0, 0);

function fixture(
  fixtureId: number,
  startTime: number,
  competition = "World Cup",
): Fixture {
  return {
    fixtureId,
    fixtureGroupId: 2026,
    competitionId: 1,
    competition,
    startTime,
    updatedAt: now,
    participant1IsHome: true,
    participant1: { id: fixtureId * 2, name: `Home ${fixtureId}` },
    participant2: { id: fixtureId * 2 + 1, name: `Away ${fixtureId}` },
    home: { id: fixtureId * 2, name: `Home ${fixtureId}` },
    away: { id: fixtureId * 2 + 1, name: `Away ${fixtureId}` },
  };
}

test("headless fixture selection honours explicit and configured fixtures", () => {
  const rows = [
    fixture(1, now - 60_000),
    fixture(2, now + 60 * 60_000),
  ];
  assert.equal(selectHeadlessFixture(rows, 2, null, now).fixtureId, 2);
  assert.equal(selectHeadlessFixture(rows, undefined, 2, now).fixtureId, 2);
  assert.throws(() => selectHeadlessFixture(rows, 99, null, now), /not in the catalogue/);
});

test("headless fixture selection prefers an active World Cup fixture then the next one", () => {
  const active = fixture(1, now - 5 * 60_000);
  const upcoming = fixture(2, now + 60 * 60_000);
  const unrelated = fixture(3, now - 2 * 60_000, "International friendly");
  assert.equal(
    selectHeadlessFixture([unrelated, upcoming, active], undefined, null, now).fixtureId,
    1,
  );
  assert.equal(
    selectHeadlessFixture([unrelated, upcoming], undefined, null, now).fixtureId,
    2,
  );
});

test("headless fixture selection rejects an empty catalogue", () => {
  assert.throws(
    () => selectHeadlessFixture([], undefined, null, now),
    /catalogue is empty/,
  );
});

test("headless non-stream requests have a hard timeout", async () => {
  const stalledFetch = (() => new Promise<Response>(() => undefined)) as typeof fetch;
  await assert.rejects(
    runHeadlessAgent({
      durationMs: 2_000,
      requestTimeoutMs: 25,
      fetchImplementation: stalledFetch,
    }),
    /\/api\/access timed out after 25ms/,
  );
});

test("headless runner completes a healthy streamed paper session", { timeout: 5_000 }, async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout", "Date"], now });

  const requestPaths: string[] = [];
  const demoFixture = fixture(20_260_018, now - 60_000);
  const odds = (messageId: string, ts = now): MatchWinnerOdds => ({
    fixtureId: demoFixture.fixtureId,
    messageId,
    ts,
    inRunning: true,
    gameState: "in_running",
    source: { bookmaker: null, bookmakerId: null },
    market: {
      superOddsType: "Match Winner",
      period: "Full Time",
      parameters: null,
      priceNames: ["Home", "Draw", "Away"],
    },
    rawPct: { HOME: "42.3", DRAW: "28.6", AWAY: "29.1" },
    probabilities: { HOME: 0.423, DRAW: 0.286, AWAY: 0.291 },
  });
  const score = (seq: number, id: string, ts = now): ScoreSnapshot => ({
    fixtureId: demoFixture.fixtureId,
    seq,
    id,
    ts,
    connectionId: "headless-happy-path",
    dedupeKey: id,
    action: "score_update",
    confirmed: true,
    finalised: false,
    statusId: 3,
    gameState: "in_running",
    score: { home: 0, away: 0 },
    redCards: { home: 0, away: 0 },
    participant1IsHome: true,
    coverage: { secondaryData: true, type: "synthetic-test" },
  });
  const envelope = <T>(data: T) => ({
    data,
    mode: "synthetic" as const,
    source: "synthetic" as const,
    receivedAt: new Date(Date.now()).toISOString(),
  });
  const streamEnvelope = <T>(eventId: string, data: T) => ({
    ...envelope(data),
    eventId,
  });
  const sseResponse = (body: string, signal?: AbortSignal | null) => {
    const encoded = new TextEncoder().encode(body);
    let closed = false;
    return new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoded);
          const close = () => {
            if (closed) return;
            closed = true;
            controller.close();
          };
          if (signal?.aborted) close();
          else signal?.addEventListener("abort", close, { once: true });
        },
        cancel() {
          closed = true;
        },
      }),
      { headers: { "Content-Type": "text/event-stream" } },
    );
  };
  const verifiedProof = envelope({
    state: "VERIFIED",
    verified: true,
    message: "Synthetic proof accepted for the integration test.",
  });

  const mockFetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = new URL(input instanceof URL ? input : String(input));
    requestPaths.push(`${url.pathname}${url.search}`);
    if (url.pathname === "/api/access") {
      return Response.json(
        envelope({
          required: false,
          configured: false,
          authenticated: false,
          expiresAt: null,
        }),
      );
    }
    if (url.pathname === "/api/status") {
      return Response.json(
        envelope({
          mode: "synthetic",
          network: "devnet",
          liveConfigured: false,
          liveReady: false,
          txline: {
            configured: false,
            origin: "https://txline-dev.txodds.com",
            apiTokenPresent: false,
            guestAuthentication: "on-demand",
            preferredFixtureId: demoFixture.fixtureId,
          },
          solana: {
            network: "devnet",
            rpcConfigured: true,
            walletConfigured: false,
            simulationPayerConfigured: false,
            runtimeConfigured: false,
            validationEnabled: false,
            programId: "6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J",
          },
          policy: defaultLivePolicy,
          capabilities: {
            fixtures: true,
            odds: true,
            scores: true,
            streaming: true,
            paperExecution: true,
            onchainValidation: false,
          },
          limitations: ["Synthetic integration test"],
        }),
      );
    }
    if (url.pathname === "/api/fixtures") {
      return Response.json(envelope([demoFixture]));
    }
    if (url.pathname === "/api/odds") {
      return Response.json(envelope(odds("headless-happy-odds-1")));
    }
    if (url.pathname === "/api/scores") {
      return Response.json(envelope(score(1, "headless-happy-score-1")));
    }
    if (url.pathname === "/api/stream") {
      if (url.searchParams.get("kind") === "odds") {
        const eventId = "headless-happy-odds-event-2";
        return sseResponse(
          [
            "id: headless-happy-odds-heartbeat",
            "event: heartbeat",
            "data: {}",
            "",
            `id: ${eventId}`,
            "event: odds",
            `data: ${JSON.stringify(streamEnvelope(eventId, odds("headless-happy-odds-2")))}`,
            "",
            "",
          ].join("\n"),
          init?.signal,
        );
      }
      const eventId = "headless-happy-score-event-2";
      return sseResponse(
        [
          "id: headless-happy-score-heartbeat",
          "event: heartbeat",
          "data: {}",
          "",
          `id: ${eventId}`,
          "event: score",
          `data: ${JSON.stringify(streamEnvelope(eventId, score(2, "headless-happy-score-2")))}`,
          "",
          "",
        ].join("\n"),
        init?.signal,
      );
    }
    if (url.pathname === "/api/verify") {
      return Response.json(verifiedProof);
    }
    throw new Error(`Unexpected mock request: ${url.pathname}`);
  }) as typeof fetch;

  let streamsReady = false;
  let markStreamsReady: () => void = () => undefined;
  const bothStreamsConnected = new Promise<void>((resolve) => {
    markStreamsReady = resolve;
  });
  const run = runHeadlessAgent({
    durationMs: 2_500,
    requestTimeoutMs: 100,
    fetchImplementation: mockFetch,
    simulateFills: true,
    onState(state) {
      if (
        !streamsReady &&
        state.lastHeartbeatAtMs.ODDS !== null &&
        state.lastHeartbeatAtMs.SCORES !== null
      ) {
        streamsReady = true;
        markStreamsReady();
      }
    },
  });

  await bothStreamsConnected;
  for (let elapsed = 0; elapsed < 2_500; elapsed += 500) {
    context.mock.timers.tick(500);
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  const result = await run;
  const lastEvent = result.trace.events.at(-1);

  assert.equal(result.report.engine.status, "CLOSED");
  assert.equal(result.report.engine.reason, "Headless agent run completed");
  assert.equal(lastEvent?.kind, "SESSION_END");
  assert.equal(
    lastEvent?.kind === "SESSION_END" ? lastEvent.reason : null,
    "Headless agent run completed",
  );
  assert.equal(result.report.transport.oddsConnections, 1);
  assert.equal(result.report.transport.scoreConnections, 1);
  assert.equal(result.report.transport.reconnects, 0);
  assert.deepEqual(result.report.transport.contractErrors, []);
  assert.equal(result.report.transport.contractErrorsDropped, 0);
  assert.equal(result.report.metrics.eventCount, result.trace.events.length);
  assert.equal(result.report.metrics.rejectedEvents, 0);
  assert.equal(result.report.metrics.paperFillRejects, 0);
  assert.ok(result.report.metrics.paperFills >= 1);
  assert.ok(result.report.metrics.filledNotional > 0);
  assert.ok(result.report.metrics.quoteUptimeMs > 0);
  assert.equal(result.report.metrics.finalStatus, "CLOSED");
  assert.equal(result.report.metrics.finalReason, "Headless agent run completed");
  assert.equal(result.report.execution.paperOnly, true);
  assert.equal(result.report.execution.deterministicFillSimulator, true);
  assert.deepEqual(result.report.proof, verifiedProof);
  assert.equal(result.report.sensitivity.length, 3);
  assert.equal(
    requestPaths.includes(
      `/api/verify?fixtureId=${demoFixture.fixtureId}&seq=2&statKeys=1,2,5,6`,
    ),
    true,
  );
});

test("headless stream contract errors close the paper market immediately", async () => {
  const requestPaths: string[] = [];
  const demoFixture = fixture(20_260_001, now - 60_000);
  const demoOdds = (): MatchWinnerOdds => ({
    fixtureId: demoFixture.fixtureId,
    messageId: "headless-test-odds-1",
    ts: Date.now(),
    inRunning: true,
    gameState: "in_running",
    source: { bookmaker: null, bookmakerId: null },
    market: {
      superOddsType: "Match Winner",
      period: "Full Time",
      parameters: null,
      priceNames: ["Home", "Draw", "Away"],
    },
    rawPct: { HOME: "42.3", DRAW: "28.6", AWAY: "29.1" },
    probabilities: { HOME: 0.423, DRAW: 0.286, AWAY: 0.291 },
  });
  const demoScore = (): ScoreSnapshot => ({
    fixtureId: demoFixture.fixtureId,
    seq: 1,
    id: "headless-test-score-1",
    ts: Date.now(),
    connectionId: "headless-test",
    dedupeKey: "headless-test-score-1",
    action: "score_update",
    confirmed: null,
    finalised: false,
    statusId: 3,
    gameState: "in_running",
    score: { home: 0, away: 0 },
    redCards: { home: 0, away: 0 },
    participant1IsHome: true,
    coverage: { secondaryData: true, type: "synthetic-test" },
  });
  const mockFetch = (async (input: URL | RequestInfo) => {
    const url = new URL(input instanceof URL ? input : String(input));
    requestPaths.push(`${url.pathname}${url.search}`);
    if (url.pathname === "/api/access") {
      return Response.json({
        data: {
          required: false,
          configured: false,
          authenticated: false,
          expiresAt: null,
        },
      });
    }
    if (url.pathname === "/api/status") {
      return Response.json({
        data: {
          mode: "synthetic",
          network: "devnet",
          liveConfigured: false,
          liveReady: false,
          txline: {
            configured: false,
            origin: "https://txline-dev.txodds.com",
            apiTokenPresent: false,
            guestAuthentication: "on-demand",
            preferredFixtureId: demoFixture.fixtureId,
          },
          solana: {
            network: "devnet",
            rpcConfigured: true,
            walletConfigured: false,
            simulationPayerConfigured: false,
            runtimeConfigured: false,
            validationEnabled: false,
            programId: "6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J",
          },
          policy: defaultLivePolicy,
          capabilities: {
            fixtures: true,
            odds: true,
            scores: true,
            streaming: true,
            paperExecution: true,
            onchainValidation: false,
          },
          limitations: ["Synthetic test"],
        },
      });
    }
    if (url.pathname === "/api/fixtures") {
      return Response.json({ data: [demoFixture] });
    }
    if (url.pathname === "/api/odds") {
      return Response.json({ data: demoOdds() });
    }
    if (url.pathname === "/api/scores") {
      return Response.json({ data: demoScore() });
    }
    if (url.pathname === "/api/stream") {
      const body =
        url.searchParams.get("kind") === "odds"
          ? "event: odds\ndata: {not-json}\n\n"
          : "event: heartbeat\ndata: {}\n\n";
      return new Response(body, {
        headers: { "Content-Type": "text/event-stream" },
      });
    }
    throw new Error(`Unexpected mock request: ${url.pathname}`);
  }) as typeof fetch;

  const result = await runHeadlessAgent({
    durationMs: 2_000,
    requestTimeoutMs: 100,
    fetchImplementation: mockFetch,
  });
  assert.equal(result.report.engine.status, "CLOSED");
  assert.match(result.report.engine.reason, /odds stream failed the local data contract/);
  assert.equal(result.report.transport.contractErrors.length, 1);
  assert.equal(result.report.transport.contractErrors[0].code, "LOCAL_INVALID_JSON");
  assert.equal(result.report.transport.contractErrorsDropped, 0);
  assert.deepEqual(result.report.proof, {
    state: "SKIPPED_CONTRACT_FAILURE",
    verified: false,
    message: "Proof request skipped after odds:LOCAL_INVALID_JSON.",
  });
  assert.equal(result.trace.events.at(-1)?.kind, "SESSION_END");
  assert.equal(requestPaths.some((path) => path.startsWith("/api/verify")), false);
});
