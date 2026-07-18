import assert from "node:assert/strict";
import test from "node:test";
import {
  activeLivePaperOrders,
  createDeterministicPaperFillEvent,
  createLiveEngineState,
  liveQuoteRows,
  normaliseLivePrices,
  remainingLivePaperOrderQuantity,
  reduceLiveEngineEvent,
  selectLiveEngineHealth,
  selectLivePaperRisk,
  type LiveEngineEvent,
  type LiveEngineState,
  type LivePrices,
} from "../app/live-engine.ts";

const fixtureId = "18241006";
const initial: LivePrices = { HOME: 0.45, DRAW: 0.3, AWAY: 0.25 };

function score(
  atMs: number,
  seq: number,
  values: { home: number | null; away: number | null } = { home: 0, away: 0 },
  redCards: { home: number | null; away: number | null } = { home: 0, away: 0 },
  extra: Partial<Extract<LiveEngineEvent, { kind: "SCORE" }>> = {},
): Extract<LiveEngineEvent, { kind: "SCORE" }> {
  return {
    kind: "SCORE",
    atMs,
    clock: `${atMs}ms`,
    fixtureId,
    seq,
    scoreTsMs: atMs,
    score: values,
    redCards,
    ...extra,
  };
}

function odds(
  atMs: number,
  messageId: string,
  pct: LivePrices = initial,
  priceTsMs = atMs,
  sseId = `sse-${messageId}`,
): Extract<LiveEngineEvent, { kind: "ODDS" }> {
  return {
    kind: "ODDS",
    atMs,
    clock: `${atMs}ms`,
    fixtureId,
    messageId,
    sseId,
    priceTsMs,
    pct,
    inRunning: true,
    gameState: "in_running",
  };
}

function reduce(state: LiveEngineState, ...events: LiveEngineEvent[]) {
  return events.reduce(reduceLiveEngineEvent, state);
}

function quotingState() {
  return reduce(createLiveEngineState({ fixtureId }), score(0, 1), odds(100, "m1"));
}

test("opens six deterministic paper orders from normalised StablePrice without provider quorum", () => {
  const state = quotingState();
  const rows = liveQuoteRows(state);

  assert.equal(state.status, "QUOTING");
  assert.equal(activeLivePaperOrders(state).length, 6);
  assert.equal(state.executionCommands.length, 1);
  assert.equal(state.executionCommands[0].id, `${fixtureId}:place:1`);
  assert.deepEqual(
    state.paperOrders.map((order) => order.id),
    [
      `${fixtureId}:1:HOME:BID`,
      `${fixtureId}:1:HOME:ASK`,
      `${fixtureId}:1:DRAW:BID`,
      `${fixtureId}:1:DRAW:ASK`,
      `${fixtureId}:1:AWAY:BID`,
      `${fixtureId}:1:AWAY:ASK`,
    ],
  );
  assert.deepEqual(rows[0], {
    outcome: "HOME",
    fair: 0.45,
    bid: 0.438,
    ask: 0.462,
    quantity: 250,
    state: "OPEN",
  });
  assert.equal("providerConfirmations" in state, false);
});

test("records deterministic partial fills with inventory, cash and mark-to-market P&L", () => {
  let state = quotingState();
  const fill = createDeterministicPaperFillEvent(state, {
    fillId: "paper-fill-1",
    atMs: 200,
    clock: "200ms",
    outcome: "HOME",
    side: "BID",
    fraction: 0.5,
  });
  state = reduceLiveEngineEvent(state, fill);
  const risk = selectLivePaperRisk(state);

  assert.equal(state.paperFills.length, 1);
  assert.deepEqual(state.paperFills[0], {
    id: "paper-fill-1",
    fixtureId,
    orderId: `${fixtureId}:1:HOME:BID`,
    atMs: 200,
    outcome: "HOME",
    side: "BID",
    price: 0.438,
    quantity: 125,
    notional: 54.75,
    cashDelta: -54.75,
    inventoryDelta: 125,
  });
  assert.equal(risk.cash, -54.75);
  assert.deepEqual(risk.inventory, { HOME: 125, DRAW: 0, AWAY: 0 });
  assert.deepEqual(risk.outcomePnl, {
    HOME: 70.25,
    DRAW: -54.75,
    AWAY: -54.75,
  });
  assert.equal(risk.markToMarketPnl, 1.5);
  assert.equal(risk.liability, 54.75);
  assert.equal(
    remainingLivePaperOrderQuantity(state, `${fixtureId}:1:HOME:BID`),
    125,
  );

  const duplicate = reduceLiveEngineEvent(state, { ...fill, atMs: 300 });
  assert.deepEqual(duplicate, state, "fill identifiers are exactly-once evidence");
});

test("accounts for ASK fills and nets equal opposing fills to captured spread", () => {
  let state = quotingState();
  state = reduceLiveEngineEvent(
    state,
    createDeterministicPaperFillEvent(state, {
      fillId: "paper-fill-home-ask",
      atMs: 200,
      clock: "200ms",
      outcome: "HOME",
      side: "ASK",
      fraction: 0.4,
    }),
  );

  assert.deepEqual(state.paperFills[0], {
    id: "paper-fill-home-ask",
    fixtureId,
    orderId: `${fixtureId}:1:HOME:ASK`,
    atMs: 200,
    outcome: "HOME",
    side: "ASK",
    price: 0.462,
    quantity: 100,
    notional: 46.2,
    cashDelta: 46.2,
    inventoryDelta: -100,
  });
  assert.deepEqual(selectLivePaperRisk(state).outcomePnl, {
    HOME: -53.8,
    DRAW: 46.2,
    AWAY: 46.2,
  });

  state = reduceLiveEngineEvent(
    state,
    createDeterministicPaperFillEvent(state, {
      fillId: "paper-fill-home-bid",
      atMs: 300,
      clock: "300ms",
      outcome: "HOME",
      side: "BID",
      fraction: 0.4,
    }),
  );
  const risk = selectLivePaperRisk(state);

  assert.equal(risk.cash, 2.4);
  assert.deepEqual(risk.inventory, { HOME: 0, DRAW: 0, AWAY: 0 });
  assert.deepEqual(risk.outcomePnl, { HOME: 2.4, DRAW: 2.4, AWAY: 2.4 });
  assert.equal(risk.markToMarketPnl, 2.4);
  assert.equal(risk.liability, 0);
  assert.equal(risk.filledNotional, 90);
});

test("closes a fully filled paper order while leaving the rest of the quote book open", () => {
  let state = quotingState();
  const orderId = `${fixtureId}:1:DRAW:ASK`;
  state = reduceLiveEngineEvent(
    state,
    createDeterministicPaperFillEvent(state, {
      fillId: "paper-fill-draw-ask-full",
      atMs: 200,
      clock: "200ms",
      outcome: "DRAW",
      side: "ASK",
      fraction: 1,
    }),
  );

  assert.equal(state.paperOrders.find((order) => order.id === orderId)?.state, "CLOSED");
  assert.equal(remainingLivePaperOrderQuantity(state, orderId), 0);
  assert.equal(activeLivePaperOrders(state).length, 5);
  assert.equal(state.paperFills.length, 1);
  assert.throws(
    () =>
      createDeterministicPaperFillEvent(state, {
        fillId: "paper-fill-draw-ask-after-close",
        atMs: 300,
        clock: "300ms",
        outcome: "DRAW",
        side: "ASK",
      }),
    /No open DRAW ASK paper order is available/,
  );
});

test("rejects an overfill without mutating the paper ledger or closing the order", () => {
  const orderId = `${fixtureId}:1:AWAY:BID`;
  const state = reduceLiveEngineEvent(quotingState(), {
    kind: "PAPER_FILL",
    fixtureId,
    fillId: "paper-fill-away-overfill",
    orderId,
    quantity: 250.0001,
    atMs: 200,
    clock: "200ms",
  });

  assert.equal(state.status, "QUOTING");
  assert.equal(state.paperFillRejects, 1);
  assert.equal(state.paperFills.length, 0);
  assert.equal(state.paperCash, 0);
  assert.deepEqual(state.paperInventory, { HOME: 0, DRAW: 0, AWAY: 0 });
  assert.equal(state.paperOrders.find((order) => order.id === orderId)?.state, "OPEN");
  assert.equal(remainingLivePaperOrderQuantity(state, orderId), 250);
});

test("accepts a candidate fill exactly at the configured maximum-liability boundary", () => {
  let state = reduce(
    createLiveEngineState({ fixtureId, policy: { maximumLiability: 54.75 } }),
    score(0, 1),
    odds(100, "m1"),
  );
  state = reduceLiveEngineEvent(
    state,
    createDeterministicPaperFillEvent(state, {
      fillId: "paper-fill-at-limit",
      atMs: 200,
      clock: "200ms",
      outcome: "HOME",
      side: "BID",
      fraction: 0.5,
    }),
  );

  const risk = selectLivePaperRisk(state);
  assert.equal(state.status, "QUOTING");
  assert.equal(state.paperFills.length, 1);
  assert.equal(state.paperFillRejects, 0);
  assert.equal(risk.liability, 54.75);
  assert.equal(risk.maximumLiability, 54.75);
  assert.equal(risk.remainingLiability, 0);
  assert.deepEqual(state.suspensionCauses, []);
});

test("blocks a fill that would breach maximum liability and keeps the guard latched", () => {
  let state = reduce(
    createLiveEngineState({ fixtureId, policy: { maximumLiability: 50 } }),
    score(0, 1),
    odds(100, "m1"),
  );
  const fill = createDeterministicPaperFillEvent(state, {
    fillId: "paper-fill-over-limit",
    atMs: 200,
    clock: "200ms",
    outcome: "HOME",
    side: "BID",
    fraction: 1,
  });
  state = reduceLiveEngineEvent(state, fill);

  assert.equal(state.status, "SUSPENDED");
  assert.deepEqual(state.suspensionCauses, ["MAXIMUM_LIABILITY"]);
  assert.equal(state.paperFills.length, 0);
  assert.equal(state.paperFillRejects, 1);
  assert.equal(state.cancelledOrders, 6);
  assert.equal(selectLivePaperRisk(state).liability, 0);

  const repeated = reduceLiveEngineEvent(state, { ...fill, atMs: 300 });
  assert.deepEqual(repeated, state);
  state = reduce(
    state,
    odds(4_000, "after-limit", { HOME: 0.451, DRAW: 0.299, AWAY: 0.25 }),
    { kind: "TIMER", atMs: 8_000, clock: "8s" },
  );
  assert.equal(state.status, "SUSPENDED");
  assert.ok(state.suspensionCauses.includes("MAXIMUM_LIABILITY"));
  assert.equal(activeLivePaperOrders(state).length, 0);
});

test("emergency stop is idempotent, fail-closed and only a new session can reset it", () => {
  let state = reduceLiveEngineEvent(quotingState(), {
    kind: "EMERGENCY_STOP",
    fixtureId,
    stopId: "operator-stop-1",
    reason: "Operator risk review",
    atMs: 500,
    clock: "500ms",
  });
  assert.equal(state.status, "SUSPENDED");
  assert.deepEqual(state.suspensionCauses, ["EMERGENCY_STOP"]);
  assert.equal(state.emergencyStop?.stopId, "operator-stop-1");
  assert.equal(state.cancelledOrders, 6);

  const repeated = reduceLiveEngineEvent(state, {
    kind: "EMERGENCY_STOP",
    fixtureId,
    stopId: "operator-stop-2",
    reason: "Repeated request",
    atMs: 600,
    clock: "600ms",
  });
  assert.deepEqual(repeated, state);

  state = reduce(
    state,
    odds(4_000, "after-stop", { HOME: 0.451, DRAW: 0.299, AWAY: 0.25 }),
    { kind: "TIMER", atMs: 8_000, clock: "8s" },
  );
  assert.equal(state.status, "SUSPENDED");
  assert.match(state.reason, /^Emergency stop:/);
  assert.equal(activeLivePaperOrders(state).length, 0);
  assert.equal(createLiveEngineState({ fixtureId }).emergencyStop, null);
});

test("settles paper P&L against the final winning outcome", () => {
  let state = quotingState();
  state = reduceLiveEngineEvent(
    state,
    createDeterministicPaperFillEvent(state, {
      fillId: "paper-fill-home",
      atMs: 200,
      clock: "200ms",
      outcome: "HOME",
      side: "BID",
      fraction: 0.5,
    }),
  );
  state = reduceLiveEngineEvent(
    state,
    score(
      5_000,
      2,
      { home: 1, away: 0 },
      { home: 0, away: 0 },
      { finalised: true },
    ),
  );

  assert.equal(state.status, "CLOSED");
  assert.equal(state.settledOutcome, "HOME");
  assert.equal(state.settledPnl, 70.25);
  assert.equal(selectLivePaperRisk(state).settledPnl, 70.25);
});

test("settles a losing paper position to its realised loss", () => {
  let state = quotingState();
  state = reduceLiveEngineEvent(
    state,
    createDeterministicPaperFillEvent(state, {
      fillId: "paper-fill-home-loser",
      atMs: 200,
      clock: "200ms",
      outcome: "HOME",
      side: "BID",
      fraction: 0.5,
    }),
  );
  state = reduceLiveEngineEvent(
    state,
    score(
      5_000,
      2,
      { home: 0, away: 1 },
      { home: 0, away: 0 },
      { finalised: true },
    ),
  );

  assert.equal(state.status, "CLOSED");
  assert.equal(state.settledOutcome, "AWAY");
  assert.equal(state.settledPnl, -54.75);
  assert.equal(selectLivePaperRisk(state).settledPnl, -54.75);
});

test("rejects a zero price tick and clamps coarse rounded quotes to probability bounds", () => {
  assert.throws(
    () => createLiveEngineState({ fixtureId, policy: { priceTick: 0 } }),
    /priceTick must be greater than zero/,
  );

  const state = reduce(
    createLiveEngineState({
      fixtureId,
      policy: { priceTick: 0.6, baseHalfSpread: 0 },
    }),
    score(0, 1),
    odds(100, "coarse-tick", { HOME: 0.98, DRAW: 0.01, AWAY: 0.01 }),
  );
  const orders = activeLivePaperOrders(state);

  assert.equal(state.status, "QUOTING");
  assert.equal(orders.length, 6);
  assert.ok(orders.every((order) => Number.isFinite(order.price)));
  assert.ok(orders.every((order) => order.price >= 0 && order.price <= 1));
  assert.ok(
    orders
      .filter((order) => order.outcome === "HOME")
      .every((order) => order.price === 1),
  );
});

test("fires on an inclusive four-percentage-point StablePrice move inside two seconds", () => {
  const state = reduce(
    quotingState(),
    odds(1_500, "m2", { HOME: 0.49, DRAW: 0.27, AWAY: 0.24 }),
  );

  assert.equal(state.status, "SUSPENDED");
  assert.equal(state.lastMovement, 0.04);
  assert.equal(activeLivePaperOrders(state).length, 0);
  assert.equal(state.cancelledOrders, 6);
  assert.deepEqual(state.suspensionCauses, ["PRICE_SHOCK"]);
  assert.equal(state.executionCommands.at(-1)?.kind, "CANCEL_ALL");
});

test("treats the same move outside the shock window as a normal deterministic re-quote", () => {
  const state = reduce(
    quotingState(),
    odds(2_501, "m2", { HOME: 0.49, DRAW: 0.27, AWAY: 0.24 }),
  );
  assert.equal(state.status, "QUOTING");
  assert.equal(state.lastMovement, 0);
  assert.equal(state.cancelledOrders, 6);
  assert.equal(state.quoteEpoch, 2);
  assert.deepEqual(
    state.executionCommands.slice(-2).map((command) => command.kind),
    ["CANCEL_ALL", "PLACE_QUOTES"],
  );
});

test("deduplicates odds by either MessageId or SSE id and scores by fixture and seq", () => {
  let state = quotingState();
  const before = state.fair;
  state = reduce(
    state,
    odds(200, "m1", { HOME: 0.6, DRAW: 0.2, AWAY: 0.2 }, 200, "new-sse"),
    odds(300, "new-message", { HOME: 0.6, DRAW: 0.2, AWAY: 0.2 }, 300, "sse-m1"),
    score(400, 1, { home: 1, away: 0 }),
  );

  assert.deepEqual(state.fair, before);
  assert.deepEqual(state.score, { home: 0, away: 0 });
  assert.equal(state.rejectedEvents, 3);
  assert.equal(state.cancelledOrders, 0);
  assert.equal(state.lastTransportAtMs.ODDS, 300, "duplicate traffic still proves transport life");
  assert.equal(state.lastTransportAtMs.SCORES, 400);
});

test("uses heartbeats for transport freshness without rewriting price freshness", () => {
  let state = quotingState();
  state = reduce(
    state,
    {
      kind: "HEARTBEAT",
      channel: "ODDS",
      fixtureId,
      atMs: 19_000,
      clock: "19s",
    },
    {
      kind: "HEARTBEAT",
      channel: "SCORES",
      fixtureId,
      atMs: 19_100,
      clock: "19.1s",
    },
    { kind: "TIMER", atMs: 20_001, clock: "20.001s" },
  );
  const health = selectLiveEngineHealth(state);

  assert.equal(state.status, "QUOTING");
  assert.equal(state.lastPriceTsMs, 100);
  assert.equal(state.lastOddsReceivedAtMs, 100);
  assert.equal(health.transportHealthy, true);
  assert.equal(health.priceSourceAgeMs, 19_901);
  assert.equal(health.priceSilenceMs, 19_901);
  assert.equal(state.stableObservations, 0, "heartbeats are not price observations");
});

test("times out required stream transport after 20 seconds and cancellation stays idempotent", () => {
  let state = reduce(
    quotingState(),
    { kind: "TIMER", atMs: 20_001, clock: "20.001s" },
  );
  assert.equal(state.status, "STALE");
  assert.equal(state.cancelledOrders, 6);
  assert.equal(state.executionCommands.filter((command) => command.kind === "CANCEL_ALL").length, 1);

  state = reduce(
    state,
    { kind: "TIMER", atMs: 21_000, clock: "21s" },
    {
      kind: "MATERIAL_SIGNAL",
      fixtureId,
      signalId: "goal-1",
      material: "GOAL",
      atMs: 21_100,
      clock: "21.1s",
    },
  );
  assert.equal(state.cancelledOrders, 6);
  assert.equal(state.executionCommands.filter((command) => command.kind === "CANCEL_ALL").length, 1);
});

test("provisional goal requires a higher-sequence confirming score plus three stable observations and hold", () => {
  let state = reduce(
    quotingState(),
    {
      kind: "MATERIAL_SIGNAL",
      fixtureId,
      signalId: "goal-1",
      material: "GOAL",
      atMs: 1_000,
      clock: "1s",
    },
    odds(1_200, "m2", { HOME: 0.46, DRAW: 0.29, AWAY: 0.25 }),
    odds(1_400, "m3", { HOME: 0.461, DRAW: 0.289, AWAY: 0.25 }),
    odds(1_600, "m4", { HOME: 0.462, DRAW: 0.288, AWAY: 0.25 }),
    { kind: "TIMER", atMs: 4_000, clock: "4s" },
  );
  assert.equal(state.stableObservations, 3);
  assert.equal(state.status, "SUSPENDED");
  assert.equal(state.scoreConfirmationRequired, true);

  state = reduce(state, score(4_100, 2, { home: 1, away: 0 }));
  assert.equal(state.scoreConfirmationRequired, false);
  assert.equal(state.stableObservations, 0, "confirmation starts a fresh post-confirmation recovery window");
  assert.equal(state.holdUntilMs, 7_100);

  state = reduce(
    state,
    odds(4_200, "m5", { HOME: 0.62, DRAW: 0.23, AWAY: 0.15 }),
    odds(5_000, "m6", { HOME: 0.621, DRAW: 0.229, AWAY: 0.15 }),
    odds(6_000, "m7", { HOME: 0.622, DRAW: 0.228, AWAY: 0.15 }),
  );
  assert.equal(state.stableObservations, 3);
  assert.equal(state.status, "SUSPENDED", "minimum hold has not elapsed");

  state = reduce(
    state,
    { kind: "HEARTBEAT", channel: "ODDS", fixtureId, atMs: 7_100, clock: "7.1s" },
    { kind: "HEARTBEAT", channel: "SCORES", fixtureId, atMs: 7_100, clock: "7.1s" },
  );
  assert.equal(state.status, "QUOTING");
  assert.equal(state.quoteEpoch, 2);
  assert.equal(activeLivePaperOrders(state).length, 6);
  assert.equal(state.paperOrders.length, 12);
});

test("confirmed red-card delta suspends immediately without needing a provisional signal", () => {
  const state = reduce(
    quotingState(),
    score(1_000, 2, { home: 0, away: 0 }, { home: 0, away: 1 }),
  );
  assert.equal(state.status, "SUSPENDED");
  assert.equal(state.scoreConfirmationRequired, false);
  assert.equal(state.reason, "Red-card delta confirmed by score seq 2");
  assert.equal(state.cancelledOrders, 6);
});

test("an explicitly unconfirmed goal preserves the confirmed baseline until a higher sequence confirms it", () => {
  let state = reduce(
    quotingState(),
    score(
      1_000,
      2,
      { home: 1, away: 0 },
      { home: null, away: null },
      { action: "goal", confirmed: false },
    ),
  );

  assert.equal(state.status, "SUSPENDED");
  assert.equal(state.scoreConfirmationRequired, true);
  assert.deepEqual(state.score, { home: 0, away: 0 });
  assert.deepEqual(state.redCards, { home: 0, away: 0 });
  assert.equal(state.lastScoreSeq, 2, "the real provisional sequence remains available as evidence");

  state = reduce(
    state,
    score(
      4_100,
      3,
      { home: 1, away: 0 },
      { home: null, away: null },
      { action: "goal_confirmed", confirmed: true },
    ),
  );

  assert.deepEqual(state.score, { home: 1, away: 0 });
  assert.equal(state.scoreConfirmationRequired, false);
  assert.equal(state.reason, "Goal delta confirmed by score seq 3");
  assert.equal(state.holdUntilMs, 7_100);
});

test("nullable score fields do not manufacture a red-card rollback", () => {
  let state = reduce(
    createLiveEngineState({ fixtureId }),
    score(0, 1, { home: 0, away: 0 }, { home: 1, away: 0 }),
    odds(100, "m1"),
  );
  assert.equal(state.status, "QUOTING");

  state = reduce(
    state,
    score(
      1_000,
      2,
      { home: 0, away: 0 },
      { home: null, away: null },
      { confirmed: true },
    ),
  );

  assert.deepEqual(state.redCards, { home: 1, away: 0 });
  assert.equal(state.status, "QUOTING");
  assert.equal(state.cancelledOrders, 0);
});

test("source-price age is inclusive at the limit and suspends one millisecond later", () => {
  let state = reduce(
    createLiveEngineState({
      fixtureId,
      policy: {
        maximumPriceSourceAgeMs: 1_000,
        maximumPriceSilenceMs: 10_000,
        transportTimeoutMs: 10_000,
      },
    }),
    score(0, 1),
    odds(100, "m1", initial, 100),
    { kind: "TIMER", atMs: 1_100, clock: "1.1s" },
  );
  assert.equal(state.status, "QUOTING");
  assert.equal(selectLiveEngineHealth(state).priceSourceAgeMs, 1_000);

  state = reduce(
    state,
    { kind: "TIMER", atMs: 1_101, clock: "1.101s" },
  );
  assert.equal(state.status, "STALE");
  assert.deepEqual(state.suspensionCauses, ["PRICE_STALE"]);
  assert.equal(activeLivePaperOrders(state).length, 0);
  assert.equal(state.cancelledOrders, 6);
});

test("normal re-quoting waits for cadence then emits deterministic cancel-replace commands", () => {
  let state = reduce(
    createLiveEngineState({
      fixtureId,
      policy: { requoteDelta: 0.01, minimumRequoteIntervalMs: 1_000 },
    }),
    score(0, 1),
    odds(100, "m1"),
    odds(500, "m2", { HOME: 0.46, DRAW: 0.295, AWAY: 0.245 }),
  );

  assert.equal(state.quoteEpoch, 1);
  assert.equal(state.cancelledOrders, 0, "the cadence guard keeps the first book working temporarily");

  state = reduce(state, { kind: "TIMER", atMs: 1_100, clock: "1.1s" });
  assert.equal(state.status, "QUOTING");
  assert.equal(state.quoteEpoch, 2);
  assert.equal(state.cancelledOrders, 6);
  assert.deepEqual(
    state.executionCommands.map((command) => command.kind),
    ["PLACE_QUOTES", "CANCEL_ALL", "PLACE_QUOTES"],
  );
  assert.equal(
    activeLivePaperOrders(state).find(
      (order) => order.outcome === "HOME" && order.side === "BID",
    )?.price,
    0.448,
  );
});

test("missing or false in-running state cannot open or retain paper quotes", () => {
  const missingLifecycle = { ...odds(100, "missing-lifecycle") };
  delete missingLifecycle.inRunning;
  const preMatch = {
    ...odds(150, "prematch"),
    inRunning: false,
    gameState: "pre_match",
  };
  let state = reduce(
    createLiveEngineState({ fixtureId }),
    score(0, 1),
    missingLifecycle,
  );
  assert.equal(state.status, "BOOTSTRAPPING");
  assert.equal(activeLivePaperOrders(state).length, 0);

  state = reduce(state, preMatch);
  assert.equal(state.status, "BOOTSTRAPPING");
  assert.equal(activeLivePaperOrders(state).length, 0);

  state = reduce(state, odds(200, "live"));
  assert.equal(state.status, "QUOTING");
  assert.equal(activeLivePaperOrders(state).length, 6);

  state = reduce(state, {
    ...odds(300, "paused"),
    inRunning: false,
    gameState: "suspended",
  });
  assert.equal(state.status, "SUSPENDED");
  assert.deepEqual(state.suspensionCauses, ["MARKET_NOT_IN_RUNNING"]);
  assert.equal(activeLivePaperOrders(state).length, 0);
});

test("session end cancels once and is terminal and idempotent", () => {
  const ended = reduce(
    quotingState(),
    {
      kind: "SESSION_END",
      fixtureId,
      reason: "Operator disconnected",
      atMs: 500,
      clock: "0.5s",
    },
  );
  assert.equal(ended.status, "CLOSED");
  assert.equal(ended.reason, "Operator disconnected");
  assert.equal(ended.cancelledOrders, 6);
  assert.equal(activeLivePaperOrders(ended).length, 0);
  assert.equal(ended.executionCommands.at(-1)?.kind, "CANCEL_ALL");

  const repeated = reduceLiveEngineEvent(ended, {
    kind: "SESSION_END",
    fixtureId,
    reason: "Repeated disconnect",
    atMs: 600,
    clock: "0.6s",
  });
  assert.deepEqual(repeated, ended);
});

test("routine timers do not flood the bounded audit and truncation is counted", () => {
  let state = quotingState();
  const initialAuditLength = state.audit.length;
  state = reduce(state, { kind: "TIMER", atMs: 500, clock: "0.5s" });
  assert.equal(state.audit.length, initialAuditLength);

  for (let index = 0; index < 110; index += 1) {
    state = reduce(
      state,
      odds(600 + index, `steady-${index}`, initial, 600 + index),
    );
  }
  assert.equal(state.audit.length, 100);
  assert.ok(state.auditTruncated > 0);
});

test("malformed probabilities are quarantined instead of becoming fake consensus", () => {
  assert.throws(
    () => normaliseLivePrices({ HOME: 0.8, DRAW: 0.3, AWAY: 0.2 }),
    /already be normalised/,
  );
  const state = reduce(
    quotingState(),
    odds(500, "bad", { HOME: 0.8, DRAW: 0.3, AWAY: 0.2 }),
  );
  assert.equal(state.status, "QUOTING");
  assert.equal(state.rejectedEvents, 1);
  assert.deepEqual(state.fair, initial);
});

test("finalised is terminal and cancels at most once", () => {
  const closed = reduce(
    quotingState(),
    score(5_000, 2, { home: 2, away: 1 }, { home: 0, away: 0 }, { finalised: true }),
  );
  const late = reduceLiveEngineEvent(closed, odds(5_100, "late"));

  assert.equal(closed.status, "CLOSED");
  assert.equal(closed.cancelledOrders, 6);
  assert.deepEqual(late, closed);
  assert.equal(activeLivePaperOrders(closed).length, 0);
  assert.ok(closed.paperOrders.every((order) => order.state !== "OPEN"));
});

test("finalised nullable totals close safely without inventing a nil-nil score", () => {
  const closed = reduce(
    createLiveEngineState({ fixtureId }),
    score(
      5_000,
      1,
      { home: null, away: null },
      { home: null, away: null },
      { finalised: true },
    ),
  );

  assert.equal(closed.status, "CLOSED");
  assert.deepEqual(closed.scoreKnown, { home: false, away: false });
  assert.match(closed.audit[0].detail, /unknown–unknown/);
  assert.doesNotMatch(closed.audit[0].detail, /0–0/);
});

test("a complete replay is deterministic", () => {
  const events: LiveEngineEvent[] = [
    score(0, 1),
    odds(100, "m1"),
    odds(1_000, "m2", { HOME: 0.5, DRAW: 0.27, AWAY: 0.23 }),
    score(1_100, 2, { home: 1, away: 0 }),
    odds(2_000, "m3", { HOME: 0.63, DRAW: 0.22, AWAY: 0.15 }),
  ];
  const run = () => reduce(createLiveEngineState({ fixtureId }), ...events);
  assert.deepEqual(run(), run());
});
