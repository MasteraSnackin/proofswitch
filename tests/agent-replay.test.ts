import assert from "node:assert/strict";
import test from "node:test";
import {
  AGENT_TRACE_SCHEMA,
  compareShockThresholds,
  replayAgentTrace,
  type AgentTrace,
} from "../app/agent-replay.ts";
import type { LiveEngineEvent, LivePrices } from "../app/live-engine.ts";

const fixtureId = "20260001";
const startedAtMs = Date.UTC(2026, 6, 18, 19, 0, 0);

function clock(atMs: number) {
  return `T+${atMs - startedAtMs}ms`;
}

function odds(
  sequence: number,
  offsetMs: number,
  pct: LivePrices,
): Extract<LiveEngineEvent, { kind: "ODDS" }> {
  const atMs = startedAtMs + offsetMs;
  return {
    kind: "ODDS",
    fixtureId,
    messageId: `odds-${sequence}`,
    sseId: `sse-${sequence}`,
    priceTsMs: atMs,
    pct,
    inRunning: true,
    gameState: "in_running",
    atMs,
    clock: clock(atMs),
  };
}

function trace(): AgentTrace {
  const events: LiveEngineEvent[] = [
    {
      kind: "SCORE",
      fixtureId,
      seq: 1,
      scoreTsMs: startedAtMs,
      score: { home: 0, away: 0 },
      redCards: { home: 0, away: 0 },
      confirmed: true,
      atMs: startedAtMs,
      clock: clock(startedAtMs),
    },
    odds(1, 100, { HOME: 0.423, DRAW: 0.286, AWAY: 0.291 }),
    odds(2, 600, { HOME: 0.424, DRAW: 0.285, AWAY: 0.291 }),
    odds(3, 1_200, { HOME: 0.481, DRAW: 0.264, AWAY: 0.255 }),
    odds(4, 1_800, { HOME: 0.477, DRAW: 0.266, AWAY: 0.257 }),
    odds(5, 2_400, { HOME: 0.478, DRAW: 0.265, AWAY: 0.257 }),
    odds(6, 3_000, { HOME: 0.478, DRAW: 0.266, AWAY: 0.256 }),
    {
      kind: "TIMER",
      atMs: startedAtMs + 4_200,
      clock: clock(startedAtMs + 4_200),
    },
  ];
  return {
    schema: AGENT_TRACE_SCHEMA,
    source: "synthetic",
    fixtureId,
    capturedAt: new Date(startedAtMs).toISOString(),
    events,
  };
}

test("reports deterministic quote uptime, protection and recovery metrics", () => {
  const first = replayAgentTrace(trace());
  const second = replayAgentTrace(trace());

  assert.deepEqual(first, second);
  assert.equal(first.metrics.eventCount, 8);
  assert.equal(first.metrics.firstQuoteLatencyMs, 100);
  assert.equal(first.metrics.suspensionEpisodes, 1);
  assert.equal(first.metrics.recoveryEpisodes, 1);
  assert.equal(first.metrics.placedOrders, 12);
  assert.equal(first.metrics.cancelledOrders, 6);
  assert.equal(first.metrics.largestMovementPp, 5.8);
  assert.equal(first.metrics.paperFills, 0);
  assert.equal(first.metrics.paperFillRejects, 0);
  assert.equal(first.metrics.peakLiability, 0);
  assert.equal(first.metrics.finalStatus, "QUOTING");
  assert.ok(first.metrics.quoteUptimePct > 0);
  assert.ok(first.metrics.protectedTimeMs > 0);
});

test("compares bounded shock thresholds through the same reducer", () => {
  const comparison = compareShockThresholds(trace(), [0.03, 0.04, 0.08]);
  assert.equal(comparison.length, 3);
  assert.equal(comparison[0].suspensionEpisodes, 1);
  assert.equal(comparison[1].suspensionEpisodes, 1);
  assert.equal(comparison[2].suspensionEpisodes, 0);
  assert.throws(() => compareShockThresholds(trace(), []), /Shock thresholds/);
});

test("rejects empty and out-of-order traces", () => {
  assert.throws(
    () => replayAgentTrace({ ...trace(), events: [] }),
    /must contain events/,
  );
  const invalid = trace();
  invalid.events = [invalid.events[1], invalid.events[0]];
  assert.throws(() => replayAgentTrace(invalid), /monotonic/);
});

test("reports paper fills, fill rejects and a latched emergency stop", () => {
  const accepted = trace();
  accepted.events.splice(
    2,
    0,
    {
      kind: "PAPER_FILL",
      fixtureId,
      fillId: "replay-fill-1",
      orderId: `${fixtureId}:1:HOME:BID`,
      quantity: 25,
      atMs: startedAtMs + 200,
      clock: clock(startedAtMs + 200),
    },
    {
      kind: "EMERGENCY_STOP",
      fixtureId,
      stopId: "replay-stop-1",
      reason: "Replay safety test",
      atMs: startedAtMs + 300,
      clock: clock(startedAtMs + 300),
    },
  );
  const protectedReplay = replayAgentTrace(accepted);
  assert.equal(protectedReplay.metrics.paperFills, 1);
  assert.equal(protectedReplay.metrics.paperFillRejects, 0);
  assert.equal(protectedReplay.metrics.emergencyStopEngaged, true);
  assert.equal(protectedReplay.metrics.finalStatus, "SUSPENDED");

  const rejected = trace();
  rejected.events.splice(2, 0, {
    kind: "PAPER_FILL",
    fixtureId,
    fillId: "replay-fill-rejected",
    orderId: `${fixtureId}:1:HOME:BID`,
    quantity: 10_000,
    atMs: startedAtMs + 200,
    clock: clock(startedAtMs + 200),
  });
  const rejectedReplay = replayAgentTrace(rejected);
  assert.equal(rejectedReplay.metrics.paperFills, 0);
  assert.equal(rejectedReplay.metrics.paperFillRejects, 1);
  assert.equal(rejectedReplay.metrics.rejectedEvents, 1);
  assert.equal(rejectedReplay.metrics.acceptedEvents, 8);
});

test("rejects unknown and malformed replay event shapes before reduction", () => {
  const unknown = trace() as unknown as { events: unknown[] };
  unknown.events = [
    {
      kind: "NOT_A_REAL_EVENT",
      atMs: startedAtMs,
      clock: clock(startedAtMs),
    },
  ];
  assert.throws(
    () => replayAgentTrace(unknown as unknown as AgentTrace),
    /kind is not recognised/,
  );

  const malformed = trace() as unknown as { events: unknown[] };
  malformed.events = [
    {
      kind: "ODDS",
      fixtureId,
      messageId: "missing-prices",
      priceTsMs: startedAtMs,
      atMs: startedAtMs,
      clock: clock(startedAtMs),
    },
  ];
  assert.throws(
    () => replayAgentTrace(malformed as unknown as AgentTrace),
    /pct must be an object/,
  );
});
