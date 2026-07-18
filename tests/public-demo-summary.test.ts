import assert from "node:assert/strict";
import test from "node:test";
import type { Fixture } from "../lib/contracts.ts";
import {
  createLiveEngineState,
  reduceLiveEngineEvent,
  type LiveEngineState,
} from "../app/live-engine.ts";
import {
  PUBLIC_DEMO_SUMMARY_SCHEMA,
  PUBLIC_DEMO_SUMMARY_VERSION,
  PUBLIC_DEMO_TXLINE_BLOCK_MESSAGE,
  buildPublicDemoSummary,
} from "../app/public-demo-summary.ts";

const startedAt = Date.UTC(2026, 6, 18, 19, 0, 0);
const fixture: Fixture = {
  fixtureId: 20260001,
  fixtureGroupId: 2026,
  competitionId: 1,
  competition: "Synthetic World Cup final rehearsal",
  startTime: startedAt,
  updatedAt: startedAt,
  participant1IsHome: true,
  participant1: { id: 1, name: "Northbridge" },
  participant2: { id: 2, name: "Riverside" },
  home: { id: 1, name: "Northbridge" },
  away: { id: 2, name: "Riverside" },
};

function syntheticEngine(): LiveEngineState {
  let engine = createLiveEngineState({ fixtureId: String(fixture.fixtureId) });
  engine = reduceLiveEngineEvent(engine, {
    kind: "SCORE",
    fixtureId: engine.fixtureId,
    seq: 1,
    scoreTsMs: startedAt,
    score: { home: 0, away: 0 },
    redCards: { home: 0, away: 0 },
    confirmed: true,
    atMs: startedAt,
    clock: "20:00:00",
  });
  return reduceLiveEngineEvent(engine, {
    kind: "ODDS",
    fixtureId: engine.fixtureId,
    messageId: "synthetic-odds-1",
    sseId: "synthetic-sse-1",
    priceTsMs: startedAt + 100,
    pct: { HOME: 0.423, DRAW: 0.286, AWAY: 0.291 },
    inRunning: true,
    gameState: "in_running",
    atMs: startedAt + 100,
    clock: "20:00:00.100",
  });
}

test("builds a versioned synthetic-only summary from aggregate agent metrics", () => {
  const engine = syntheticEngine();
  const first = buildPublicDemoSummary({
    generatedAt: startedAt + 1_000,
    source: "synthetic",
    fixture,
    engine,
  });
  const second = buildPublicDemoSummary({
    generatedAt: startedAt + 1_000,
    source: "synthetic",
    fixture,
    engine,
  });

  assert.deepEqual(first, second);
  assert.equal(first.schema, PUBLIC_DEMO_SUMMARY_SCHEMA);
  assert.equal(first.version, PUBLIC_DEMO_SUMMARY_VERSION);
  assert.equal(first.classification, "synthetic-public-demo");
  assert.equal(first.integrity, "device-local-unsigned");
  assert.equal(first.run.source, "synthetic");
  assert.equal(first.run.fixtureId, String(fixture.fixtureId));
  assert.equal(first.run.fixtureLabel, "Northbridge v Riverside");
  assert.equal(first.run.scoreSequence, 1);
  assert.equal(first.agent.decisionState, "QUOTING");
  assert.equal(first.agent.quoteEpochs, 1);
  assert.equal(first.agent.retainedOrderRecords, 6);
  assert.equal(first.agent.openOrders, 6);
  assert.equal(first.agent.retainedPaperFillRecords, 0);
  assert.equal(first.policy.shockDeltaPp, 4);
  assert.equal(first.boundaries.syntheticDataOnly, true);
  assert.equal(first.boundaries.containsTxlineDerivedData, false);
  assert.equal(first.boundaries.containsRawEventPayloads, false);
  assert.equal(first.boundaries.containsPriceHistory, false);
  assert.equal(first.boundaries.containsExecutableOrders, false);
  assert.equal(first.boundaries.containsSolanaProof, false);
});

test("omits raw events, working records, price values and proof material", () => {
  const summary = buildPublicDemoSummary({
    generatedAt: startedAt + 1_000,
    source: "synthetic",
    fixture,
    engine: syntheticEngine(),
  });
  const serialised = JSON.stringify(summary);

  for (const prohibited of [
    "priceHistory",
    "paperOrders",
    "paperFills\":[]",
    "executionCommands",
    "audit\"",
    "messageId",
    "sseId",
    "proof\"",
    "0.423",
  ]) {
    assert.equal(
      serialised.includes(prohibited),
      false,
      `public summary must omit ${prohibited}`,
    );
  }
});

test("blocks a TxLINE-derived public download with sponsor-permission wording", () => {
  assert.throws(
    () =>
      buildPublicDemoSummary({
        generatedAt: startedAt + 1_000,
        source: "txline",
        fixture,
        engine: syntheticEngine(),
      }),
    (error: unknown) =>
      error instanceof RangeError &&
      error.message === PUBLIC_DEMO_TXLINE_BLOCK_MESSAGE &&
      /explicit sponsor permission/i.test(error.message),
  );
});

test("rejects mismatched fixtures and invalid timestamps", () => {
  const engine = syntheticEngine();
  assert.throws(
    () =>
      buildPublicDemoSummary({
        generatedAt: startedAt,
        source: "synthetic",
        fixture: { ...fixture, fixtureId: fixture.fixtureId + 1 },
        engine,
      }),
    /fixture must match/i,
  );
  assert.throws(
    () =>
      buildPublicDemoSummary({
        generatedAt: Number.NaN,
        source: "synthetic",
        fixture,
        engine,
      }),
    /generatedAt/,
  );
});
