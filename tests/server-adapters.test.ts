import assert from "node:assert/strict";
import test from "node:test";

import { publicAppStatus, readServerConfig } from "../server/config.ts";
import {
  DataContractError,
  normaliseMatchWinnerOdds,
  normaliseScoreRecord,
} from "../server/normalise.ts";
import { SseParser } from "../server/sse.ts";
import { TxlineClient, TxlineRequestError } from "../server/txline.ts";

function liveConfig() {
  return readServerConfig({
    PROOFSWITCH_MODE: "live",
    TXLINE_NETWORK: "devnet",
    TXLINE_API_TOKEN: "activated-api-token",
  });
}

test("public configuration reports readiness without serialising server secrets", () => {
  const config = liveConfig();
  const status = publicAppStatus(config);
  assert.equal(status.mode, "live");
  assert.equal(status.txline.apiTokenPresent, true);
  assert.equal(JSON.stringify(status).includes("activated-api-token"), false);
  assert.equal(status.solana.walletConfigured, false);
  assert.equal(status.capabilities.onchainValidation, false);
});

test("on-chain capability remains fail-closed without a simulation payer public key", () => {
  const config = readServerConfig({
    PROOFSWITCH_MODE: "live",
    TXLINE_API_TOKEN: "activated-api-token",
    SOLANA_RPC_URL: "https://api.devnet.solana.com",
    SOLANA_VALIDATION_ENABLED: "true",
  });
  const status = publicAppStatus(config);
  assert.equal(status.solana.validationEnabled, false);
  assert.equal(status.capabilities.onchainValidation, false);
  assert.equal(
    status.limitations.some((value) =>
      value.includes("SOLANA_SIMULATION_PAYER_PUBLIC_KEY"),
    ),
    true,
  );
});

test("reports the read-only devnet validator without claiming a wallet", () => {
  const config = readServerConfig({
    PROOFSWITCH_MODE: "live",
    TXLINE_NETWORK: "devnet",
    TXLINE_API_TOKEN: "activated-api-token",
    SOLANA_VALIDATION_ENABLED: "true",
    SOLANA_SIMULATION_PAYER_PUBLIC_KEY:
      "11111111111111111111111111111111",
  });
  const status = publicAppStatus(config);
  assert.equal(status.solana.walletConfigured, false);
  assert.equal(status.solana.simulationPayerConfigured, true);
  assert.equal(status.solana.runtimeConfigured, true);
  assert.equal(status.capabilities.onchainValidation, true);
  assert.equal(status.policy.maximumLiability, 1_000);
});

test("configuration rejects network/origin mismatches and malformed policy values", () => {
  assert.throws(
    () =>
      readServerConfig({
        TXLINE_NETWORK: "devnet",
        TXLINE_API_ORIGIN: "https://txline.txodds.com",
      }),
    /official devnet origin/,
  );
  assert.throws(
    () => readServerConfig({ PROOFSWITCH_SHOCK_DELTA: "not-a-number" }),
    /PROOFSWITCH_SHOCK_DELTA/,
  );
  assert.throws(
    () => readServerConfig({ PROOFSWITCH_MAXIMUM_LIABILITY: "0" }),
    /PROOFSWITCH_MAXIMUM_LIABILITY/,
  );
  assert.throws(
    () => readServerConfig({ SOLANA_VALIDATION_ENABLED: "yes" }),
    /true or false/,
  );
  assert.throws(
    () =>
      readServerConfig({
        SOLANA_SIMULATION_PAYER_PUBLIC_KEY: "not-a-solana-key",
      }),
    /valid Solana public key/,
  );
  assert.throws(
    () => readServerConfig({ SOLANA_RPC_URL: "ftp://rpc.invalid" }),
    /must use HTTPS/,
  );
});

test("TxLINE client starts a guest session and refreshes exactly once after 401", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const responses = [
    Response.json({ token: "guest-one" }),
    new Response(null, { status: 401 }),
    Response.json({ token: "guest-two" }),
    Response.json([]),
  ];
  const client = new TxlineClient(liveConfig(), async (input, init = {}) => {
    calls.push({ url: String(input), init });
    return responses.shift() ?? new Response(null, { status: 500 });
  });

  assert.deepEqual(await client.getFixtures(), []);
  assert.equal(calls.length, 4);
  assert.equal(calls[0].url.endsWith("/auth/guest/start"), true);
  assert.equal(calls[0].init.method, "POST");
  const firstDataHeaders = new Headers(calls[1].init.headers);
  const retryHeaders = new Headers(calls[3].init.headers);
  assert.equal(firstDataHeaders.get("Authorization"), "Bearer guest-one");
  assert.equal(retryHeaders.get("Authorization"), "Bearer guest-two");
  assert.equal(firstDataHeaders.get("X-Api-Token"), "activated-api-token");
});

test("TxLINE client does not refresh a guest session after 403", async () => {
  let calls = 0;
  const client = new TxlineClient(liveConfig(), async () => {
    calls += 1;
    return calls === 1
      ? Response.json({ token: "guest" })
      : new Response(null, { status: 403 });
  });

  await assert.rejects(
    () => client.getFixtures(),
    (error: unknown) =>
      error instanceof TxlineRequestError &&
      error.code === "TXLINE_FORBIDDEN" &&
      error.status === 403,
  );
  assert.equal(calls, 2);
});

test("proof boundary constructs a V2 query and returns payload status without claiming validation", async () => {
  const calls: string[] = [];
  const client = new TxlineClient(liveConfig(), async (input) => {
    calls.push(String(input));
    return calls.length === 1
      ? Response.json({ token: "guest" })
      : Response.json({ summary: { fixtureId: 18_241_006 } }, { status: 404 });
  });

  const result = await client.getScoreStatValidation({
    fixtureId: 18_241_006,
    seq: 941,
    statKeys: [1, 2, 3001],
  });
  assert.equal(result.status, 404);
  const url = new URL(calls[1]);
  assert.equal(url.pathname, "/api/scores/stat-validation");
  assert.equal(url.searchParams.get("fixtureId"), "18241006");
  assert.equal(url.searchParams.get("seq"), "941");
  assert.equal(url.searchParams.get("statKeys"), "1,2,3001");
});

test("match-winner normalisation uses official Pct strings divided by 100", () => {
  const odds = normaliseMatchWinnerOdds(
    [
      {
        FixtureId: 18_241_006,
        MessageId: "msg-17",
        Ts: 1_786_000_000_000,
        Bookmaker: "TXLINE_STABLE",
        BookmakerId: 77,
        SuperOddsType: "1X2",
        InRunning: true,
        GameState: "in_running",
        MarketParameters: null,
        MarketPeriod: "Full Time",
        PriceNames: ["1", "X", "2"],
        Prices: [2050, 3400, 4100],
        Pct: ["48.125", "27.500", "24.375"],
      },
    ],
    { expectedFixtureId: 18_241_006 },
  );

  assert.deepEqual(odds.probabilities, {
    HOME: 0.48125,
    DRAW: 0.275,
    AWAY: 0.24375,
  });
  assert.deepEqual(odds.source, {
    bookmaker: "TXLINE_STABLE",
    bookmakerId: 77,
  });
  assert.equal("providers" in odds, false);
});

test("match-winner normalisation rejects an unrelated three-label market", () => {
  assert.throws(
    () =>
      normaliseMatchWinnerOdds([
        {
          FixtureId: 18_241_006,
          MessageId: "msg-other",
          Ts: 1_786_000_000_000,
          Bookmaker: "TXLINE_STABLE",
          BookmakerId: 77,
          SuperOddsType: "NEXT_GOAL_3WAY",
          InRunning: true,
          GameState: "in_running",
          MarketParameters: null,
          MarketPeriod: "Full Time",
          PriceNames: ["1", "X", "2"],
          Prices: [1, 1, 1],
          Pct: ["40", "30", "30"],
        },
      ]),
    (error: unknown) =>
      error instanceof DataContractError &&
      error.code === "MATCH_WINNER_UNAVAILABLE",
  );
});

test("score normalisation preserves a real sequence and exposes decision fields", () => {
  const score = normaliseScoreRecord(
    {
      fixtureId: 18_241_006,
      seq: 941,
      id: "score-941",
      ts: 1_786_000_001_000,
      connectionId: "connection-a",
      action: "game_finalised",
      statusId: 100,
      gameState: "final",
      participant1IsHome: true,
      coverageSecondaryData: false,
      coverageType: "full",
      dataSoccer: {
        Stats: {
          Total: {
            Goals: { "1": 2, "2": 1 },
            RedCards: { "1": 0, "2": 1 },
          },
        },
      },
    },
    18_241_006,
  );

  assert.equal(score.seq, 941);
  assert.equal(score.dedupeKey, '[18241006,"connection-a",941,"score-941"]');
  assert.deepEqual(score.score, { home: 2, away: 1 });
  assert.deepEqual(score.redCards, { home: 0, away: 1 });
  assert.equal(score.confirmed, true);
  assert.equal(score.finalised, true);

  assert.throws(
    () => normaliseScoreRecord({ fixtureId: 18_241_006, seq: 0, ts: 1 }),
    (error: unknown) =>
      error instanceof DataContractError &&
      error.code === "TXLINE_SCHEMA_MISMATCH",
  );
});

test("score normalisation prefers official scoreSoccer cumulative participant totals", () => {
  const score = normaliseScoreRecord({
    fixtureId: 18_241_006,
    seq: 942,
    id: "score-942",
    ts: 1_786_000_002_000,
    connectionId: 314,
    action: "goal",
    participant1IsHome: false,
    dataSoccer: {
      Confirmed: false,
      Stats: {
        Total: {
          Goals: { "1": 9, "2": 9 },
          RedCards: { "1": 9, "2": 9 },
        },
      },
    },
    scoreSoccer: {
      Participant1: { Total: { Goals: 1, RedCards: 0 } },
      Participant2: { Total: { Goals: 2, RedCards: 1 } },
    },
  });

  assert.deepEqual(score.score, { home: 2, away: 1 });
  assert.deepEqual(score.redCards, { home: 1, away: 0 });
  assert.equal(score.confirmed, false);
  assert.equal(score.connectionId, "314");
});

test("fragmented SSE parser handles split CRLF, UTF-8, multiline data, retry and id persistence", () => {
  const source =
    ": keepalive\r\nretry: 1500\r\nid: event-42\r\nevent: odds\r\n" +
    'data: {"label":"café",\r\ndata: "ok":true}\r\n\r\n' +
    "id: rejected\0id\ndata: next\n\n" +
    "data: incomplete";
  const bytes = new TextEncoder().encode(source);
  const parser = new SseParser();
  const items = [];
  for (let index = 0; index < bytes.length; ) {
    const width = (index % 5) + 1;
    items.push(...parser.push(bytes.slice(index, index + width)));
    index += width;
  }
  items.push(...parser.finish());

  assert.deepEqual(items, [
    { type: "retry", retry: 1500 },
    {
      type: "event",
      event: "odds",
      id: "event-42",
      data: '{"label":"café",\n"ok":true}',
    },
    {
      type: "event",
      event: "message",
      id: "event-42",
      data: "next",
    },
  ]);
});
