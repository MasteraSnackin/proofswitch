import assert from "node:assert/strict";
import test from "node:test";

import {
  buildLiveEvidencePack,
  LIVE_EVIDENCE_MAX_UTF8_BYTES,
  LIVE_EVIDENCE_RECORD_LIMITS,
  parseLiveProofResult,
  SCORE_PROOF_STAT_KEYS,
  serialiseLiveEvidencePack,
  scoreProofStatLabel,
  type LiveProofResult,
} from "../app/live-evidence.ts";
import {
  createDeterministicPaperFillEvent,
  createLiveEngineState,
  reduceLiveEngineEvent,
  selectLiveEngineHealth,
} from "../app/live-engine.ts";
import {
  PAPER_SESSION_ENGINE_SCHEMA,
  PAPER_SESSION_SCHEMA,
  PAPER_SESSION_VERSION,
  type PaperSessionV1,
} from "../app/live-session.ts";
import type { AppStatus, Fixture } from "../lib/contracts.ts";

const fixtureId = 18_241_006;
const fixture: Fixture = {
  fixtureId,
  fixtureGroupId: 18_241,
  competitionId: 2_026,
  competition: "World Cup",
  startTime: 1_783_300_000_000,
  updatedAt: 1_783_300_000_000,
  participant1IsHome: false,
  participant1: { id: 20, name: "Pacifica" },
  participant2: { id: 10, name: "Aurora" },
  home: { id: 10, name: "Aurora" },
  away: { id: 20, name: "Pacifica" },
};

function liveEngine() {
  let engine = createLiveEngineState({ fixtureId: String(fixtureId) });
  engine = reduceLiveEngineEvent(engine, {
    kind: "SCORE",
    fixtureId: String(fixtureId),
    seq: 81,
    scoreTsMs: 100,
    score: { home: 1, away: 0 },
    redCards: { home: 0, away: 0 },
    confirmed: true,
    atMs: 100,
    clock: "00:01",
  });
  return reduceLiveEngineEvent(engine, {
    kind: "ODDS",
    fixtureId: String(fixtureId),
    messageId: "stable-price-1",
    sseId: "odds-1",
    priceTsMs: 200,
    pct: { HOME: 0.45, DRAW: 0.3, AWAY: 0.25 },
    inRunning: true,
    gameState: "in_running",
    atMs: 200,
    clock: "00:02",
  });
}

function status(engine = liveEngine()): AppStatus {
  return {
    mode: "live",
    network: "devnet",
    liveConfigured: true,
    liveReady: true,
    liveReadiness: {
      state: "ready",
      missing: [],
      configured: [
        "PROOFSWITCH_MODE=live",
        "TXLINE_API_TOKEN",
        "PROOFSWITCH_ACCESS_CODE",
        "PROOFSWITCH_ACCESS_SIGNING_SECRET",
        "SOLANA_VALIDATION_ENABLED=true",
        "SOLANA_SIMULATION_PAYER_PUBLIC_KEY",
      ],
      nextAction: "Unlock operator access, load fixtures and connect a covered live fixture.",
    },
    txline: {
      configured: true,
      origin: "https://txline-dev.txodds.com",
      apiTokenPresent: true,
      guestAuthentication: "on-demand",
      preferredFixtureId: fixtureId,
    },
    solana: {
      network: "devnet",
      rpcConfigured: true,
      walletConfigured: false,
      simulationPayerConfigured: true,
      runtimeConfigured: true,
      validationEnabled: true,
      programId: "6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J",
    },
    policy: {
      shockWindowMs: engine.policy.shockWindowMs,
      shockDelta: engine.policy.shockDelta,
      transportTimeoutMs: engine.policy.transportTimeoutMs,
      maximumPriceSilenceMs: engine.policy.maximumPriceSilenceMs,
      maximumPriceSourceAgeMs: engine.policy.maximumPriceSourceAgeMs,
      minimumSuspendMs: engine.policy.minimumSuspendMs,
      stableObservationsRequired: engine.policy.stableObservationsRequired,
      stableObservationDelta: engine.policy.stableObservationDelta,
      maximumLiability: engine.policy.maximumLiability,
      requoteDelta: engine.policy.requoteDelta,
      minimumRequoteIntervalMs: engine.policy.minimumRequoteIntervalMs,
    },
    capabilities: {
      fixtures: true,
      odds: true,
      scores: true,
      streaming: true,
      paperExecution: true,
      onchainValidation: true,
    },
    limitations: ["Paper execution only."],
  };
}

function verifiedProof(): unknown {
  const message = "validateStatV2 returned true in a read-only Solana devnet simulation.";
  return {
    state: "VERIFIED",
    verified: true,
    fixtureId,
    seq: 81,
    statKeys: [1, 2, 5, 6],
    message,
    proof: {
      proofTimestamp: 1_783_300_100_000,
      updateCount: 81,
      stats: [
        { key: 1, value: 0, period: 0 },
        { key: 2, value: 1, period: 0 },
        { key: 5, value: 0, period: 0 },
        { key: 6, value: 0, period: 0 },
      ],
    },
    validation: {
      state: "VERIFIED",
      verified: true,
      message,
      programId: "6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J",
      rpcNetwork: "devnet",
      epochDay: 20_640,
    },
  };
}

test("exposes the exact soccer proof stat contract with participant-aware labels", () => {
  assert.deepEqual(SCORE_PROOF_STAT_KEYS, [1, 2, 5, 6]);
  assert.equal(scoreProofStatLabel(1), "Participant 1 total goals");
  assert.equal(scoreProofStatLabel(1, fixture), "Pacifica (away) total goals");
  assert.equal(scoreProofStatLabel(2, fixture), "Aurora (home) total goals");
  assert.equal(scoreProofStatLabel(5, fixture), "Pacifica (away) total red cards");
  assert.equal(scoreProofStatLabel(6, fixture), "Aurora (home) total red cards");
  assert.equal(scoreProofStatLabel(99, fixture), "Score stat 99");
});

test("parses a fully bound verified proof and strips unknown fields", () => {
  const payload = { ...(verifiedProof() as Record<string, unknown>), secret: "discarded" };
  const parsed = parseLiveProofResult(payload, fixtureId, 81);
  assert.equal(parsed.verified, true);
  assert.equal(parsed.validation?.state, "VERIFIED");
  assert.equal("secret" in parsed, false);
  assert.deepEqual(parsed.proof?.stats.map(({ key }) => key), [1, 2, 5, 6]);
});

test("rejects a forged verified response without matching validation evidence", () => {
  const forged = verifiedProof() as Record<string, unknown>;
  forged.validation = null;
  assert.throws(
    () => parseLiveProofResult(forged, fixtureId, 81),
    /verified.*proof and validation both report VERIFIED/i,
  );
});

test("rejects top-level and proof-stat key order mismatches", () => {
  const topLevelMismatch = verifiedProof() as Record<string, unknown>;
  topLevelMismatch.statKeys = [2, 1, 5, 6];
  assert.throws(
    () => parseLiveProofResult(topLevelMismatch, fixtureId, 81),
    /exact order 1,2,5,6/,
  );

  const proofMismatch = verifiedProof() as {
    proof: { stats: Array<{ key: number; value: number; period: number }> };
  };
  proofMismatch.proof.stats[0].key = 2;
  assert.throws(
    () => parseLiveProofResult(proofMismatch, fixtureId, 81),
    /must be 1 to preserve requested stat order/,
  );
});

test("builds a chronological, paper-only evidence pack with saved-session retention", () => {
  let engine = liveEngine();
  engine = reduceLiveEngineEvent(
    engine,
    createDeterministicPaperFillEvent(engine, {
      fillId: "evidence-fill-1",
      atMs: 300,
      clock: "00:03",
      outcome: "HOME",
      side: "BID",
      fraction: 0.5,
    }),
  );
  const proof = parseLiveProofResult(verifiedProof(), fixtureId, 81);
  const savedSession: PaperSessionV1 = {
    schema: PAPER_SESSION_SCHEMA,
    version: PAPER_SESSION_VERSION,
    engineSchema: PAPER_SESSION_ENGINE_SCHEMA,
    integrity: "device-local-unsigned",
    sessionId: "world-cup-session",
    revision: 4,
    writerId: "tab-a",
    savedAtMs: 1_783_300_200_000,
    scope: {
      mode: "live",
      network: "devnet",
      fixture: {
        fixtureId,
        competition: fixture.competition,
        startTime: fixture.startTime,
        home: { ...fixture.home },
        away: { ...fixture.away },
      },
    },
    engine,
    retention: {
      auditDropped: 3,
      commandsDropped: 2,
      fillsDropped: 0,
      ordersDropped: 1,
      seenIdentitiesDropped: 5,
    },
  };

  const pack = buildLiveEvidencePack({
    generatedAt: "2026-07-18T10:00:00.000Z",
    source: "txline",
    appStatus: status(engine),
    fixture,
    engine,
    transport: {
      phase: "connected",
      channels: { odds: true, scores: true },
      health: selectLiveEngineHealth(engine),
    },
    proof,
    savedSession,
  });

  assert.equal(pack.schema, "proofswitch.live-evidence.v1");
  assert.equal(pack.generatedAt, "2026-07-18T10:00:00.000Z");
  assert.equal(pack.integrity, "device-local-unsigned");
  assert.equal(pack.execution, "paper-only");
  assert.equal(pack.source, "txline");
  assert.equal(pack.network, "devnet");
  assert.equal(pack.decision.status, "QUOTING");
  assert.equal("paperOrders" in pack.decision, false);
  assert.equal("priceHistory" in pack.decision, false);
  assert.equal("seenOddsMessageIds" in pack.decision, false);
  assert.equal("seenOddsSseIds" in pack.decision, false);
  assert.equal("seenScoreKeys" in pack.decision, false);
  assert.equal("seenMaterialSignalIds" in pack.decision, false);
  assert.equal("seenPaperFillIds" in pack.decision, false);
  assert.equal(pack.orders.length, 6);
  assert.equal(pack.fills.length, 1);
  assert.equal(pack.fills[0].id, "evidence-fill-1");
  assert.equal(pack.risk.cash, -54.75);
  assert.equal(pack.risk.liability, 54.75);
  assert.equal("paperFills" in pack.decision, false);
  assert.deepEqual(pack.executionCommands.map(({ kind }) => kind), ["PLACE_QUOTES"]);
  assert.deepEqual(
    pack.audit.map(({ atMs }) => atMs),
    [...pack.audit.map(({ atMs }) => atMs)].sort((left, right) => left - right),
  );
  assert.equal(pack.proofBinding.boundToCurrentDecision, true);
  assert.equal(pack.proofBinding.verified, true);
  assert.deepEqual(pack.savedSession?.retention, savedSession.retention);

  engine.paperOrders[0].quantity = 999;
  assert.equal(pack.orders[0].quantity, 250, "the export must be a detached snapshot");
});

test("serialises evidence canonically and reports its exact UTF-8 size", () => {
  const engine = liveEngine();
  const pack = buildLiveEvidencePack({
    generatedAt: "2026-07-18T10:00:00.000Z",
    source: "txline",
    appStatus: status(engine),
    fixture,
    engine,
    transport: {
      phase: "connected",
      channels: { odds: true, scores: true },
      health: selectLiveEngineHealth(engine),
    },
  });
  const reordered = {
    ...pack,
    capabilities: {
      onchainValidation: pack.capabilities.onchainValidation,
      paperExecution: pack.capabilities.paperExecution,
      streaming: pack.capabilities.streaming,
      scores: pack.capabilities.scores,
      odds: pack.capabilities.odds,
      fixtures: pack.capabilities.fixtures,
    },
  };

  const first = serialiseLiveEvidencePack(pack);
  const second = serialiseLiveEvidencePack(reordered);

  assert.equal(first.contents, second.contents);
  assert.equal(first.bytes, new TextEncoder().encode(first.contents).byteLength);
  assert.equal(first.contents, JSON.stringify(pack, null, 2));
  assert.ok(first.bytes < LIVE_EVIDENCE_MAX_UTF8_BYTES);
});

test("rejects every oversized evidence history before sorting without truncating it", () => {
  let engine = liveEngine();
  engine = reduceLiveEngineEvent(
    engine,
    createDeterministicPaperFillEvent(engine, {
      fillId: "boundary-fill-1",
      atMs: 300,
      clock: "00:03",
      outcome: "HOME",
      side: "BID",
      fraction: 0.5,
    }),
  );

  const cases = [
    {
      label: "orders",
      field: "paperOrders",
      maximum: LIVE_EVIDENCE_RECORD_LIMITS.orders,
      sample: engine.paperOrders[0],
    },
    {
      label: "fills",
      field: "paperFills",
      maximum: LIVE_EVIDENCE_RECORD_LIMITS.fills,
      sample: engine.paperFills[0],
    },
    {
      label: "executionCommands",
      field: "executionCommands",
      maximum: LIVE_EVIDENCE_RECORD_LIMITS.executionCommands,
      sample: engine.executionCommands[0],
    },
    {
      label: "audit",
      field: "audit",
      maximum: LIVE_EVIDENCE_RECORD_LIMITS.audit,
      sample: engine.audit[0],
    },
  ] as const;

  for (const { label, field, maximum, sample } of cases) {
    const oversizedEngine = {
      ...engine,
      [field]: Array.from({ length: maximum + 1 }, () => sample),
    };
    assert.throws(
      () =>
        buildLiveEvidencePack({
          source: "txline",
          appStatus: status(engine),
          fixture,
          engine: oversizedEngine,
          transport: {
            phase: "connected",
            channels: { odds: true, scores: true },
            health: selectLiveEngineHealth(engine),
          },
        }),
      new RegExp(
        `Evidence ${label} contains ${maximum + 1} records; the maximum is ${maximum}\\.`,
      ),
    );
  }
});

test("rejects an evidence document over the UTF-8 byte cap", () => {
  const engine = liveEngine();
  const oversizedStatus = status(engine);
  oversizedStatus.limitations = ["界".repeat(Math.ceil(LIVE_EVIDENCE_MAX_UTF8_BYTES / 3))];

  assert.throws(
    () =>
      buildLiveEvidencePack({
        source: "txline",
        appStatus: oversizedStatus,
        fixture,
        engine,
        transport: {
          phase: "connected",
          channels: { odds: true, scores: true },
          health: selectLiveEngineHealth(engine),
        },
      }),
    new RegExp(
      `UTF-8 bytes; the maximum is ${LIVE_EVIDENCE_MAX_UTF8_BYTES}\\. ` +
        "The evidence pack was not created\\.",
    ),
  );
});

test("rejects evidence that is labelled as a source or fixture it did not use", () => {
  const engine = liveEngine();
  assert.throws(
    () =>
      buildLiveEvidencePack({
        source: "synthetic",
        appStatus: status(engine),
        fixture,
        engine,
        transport: {
          phase: "idle",
          channels: { odds: false, scores: false },
          health: null,
        },
      }),
    /source must match/,
  );
  assert.throws(
    () =>
      buildLiveEvidencePack({
        source: "txline",
        appStatus: status(engine),
        fixture: { ...fixture, fixtureId: fixtureId + 1 },
        engine,
        transport: {
          phase: "idle",
          channels: { odds: false, scores: false },
          health: null,
        },
      }),
    /fixture IDs must match/,
  );
});

test("the parsed proof result remains assignable to the public result contract", () => {
  const proof: LiveProofResult = parseLiveProofResult(verifiedProof(), fixtureId, 81);
  assert.deepEqual(proof.statKeys, [1, 2, 5, 6]);
});
