import assert from "node:assert/strict";
import test from "node:test";
import {
  applyNextEvent,
  calculateCounterfactual,
  consensusFromBooks,
  createInitialState,
  demoScenarios,
  quoteRows,
  reduceEvent,
  scenario,
  type EngineState,
  type ScenarioEvent,
} from "../app/simulation.ts";

function advance(
  state: EngineState,
  events: readonly ScenarioEvent[] = scenario,
  count = 1,
) {
  let next = state;
  for (let index = 0; index < count; index += 1) {
    next = applyNextEvent(next, events);
  }
  return next;
}

test("builds a normalised consensus and deterministic initial quote set", () => {
  const state = advance(createInitialState(), demoScenarios.goalShock, 2);
  const total = state.fair.HOME + state.fair.DRAW + state.fair.AWAY;
  const quotes = quoteRows(state);

  assert.equal(state.status, "QUOTING");
  assert.equal(state.openOrders, 6);
  assert.ok(Math.abs(total - 1) < 1e-12);
  assert.ok(Math.abs(state.fair.HOME - 0.416245) < 0.00001);
  assert.ok(Math.abs(state.fair.DRAW - 0.306141) < 0.00001);
  assert.ok(Math.abs(state.fair.AWAY - 0.277614) < 0.00001);
  assert.equal(quotes[0].bid, 0.4042);
  assert.equal(quotes[0].ask, 0.4282);
  assert.equal(quotes[0].quantity, 250);
});

test("rejects one-provider noise and suspends only after provider quorum", () => {
  const outlier = advance(
    createInitialState(),
    demoScenarios.outlierResilience,
    demoScenarios.outlierResilience.length,
  );
  assert.equal(outlier.status, "QUOTING");
  assert.equal(outlier.providerConfirmations, 1);
  assert.equal(outlier.openOrders, 6);
  assert.equal(outlier.cancelledOrders, 0);

  const shocked = advance(createInitialState(), demoScenarios.goalShock, 5);
  assert.equal(shocked.status, "SUSPENDED");
  assert.equal(shocked.providerConfirmations, 2);
  assert.ok(shocked.triggerMovement > 0.22);
  assert.equal(shocked.openOrders, 0);
  assert.equal(shocked.cancelledOrders, 6);
  assert.ok(shocked.suspendedQuotes);
});

test("derives stable frames, hold expiry and a calculated counterfactual", () => {
  let state = advance(createInitialState(), demoScenarios.goalShock, 5);
  assert.equal(state.counterfactualLoss, 0, "loss is not known at intervention time");

  state = advance(state, demoScenarios.goalShock, 1);
  assert.equal(state.scoreConfirmed, false);
  assert.equal(state.cancelledOrders, 6, "goal signal must not duplicate cancellations");

  state = advance(state, demoScenarios.goalShock, 1);
  assert.equal(state.scoreConfirmed, true);
  assert.equal(state.holdUntilMs, 8_000);

  state = advance(state, demoScenarios.goalShock, 1);
  assert.equal(state.stableFrames, 1);
  assert.equal(state.status, "SUSPENDED");

  state = advance(state, demoScenarios.goalShock, 1);
  assert.equal(state.stableFrames, 2);
  assert.equal(state.status, "SUSPENDED");

  state = advance(state, demoScenarios.goalShock, 1);
  assert.equal(state.proofStatus, "MOCK_READY");

  state = advance(state, demoScenarios.goalShock, 1);
  assert.equal(state.stableFrames, 3);
  assert.equal(state.status, "REPRICING");
  assert.equal(state.counterfactualLoss, 109.96);
  assert.deepEqual(state.counterfactualBreakdown, {
    HOME: 56.49,
    DRAW: 18.65,
    AWAY: 34.82,
  });

  state = advance(state, demoScenarios.goalShock, 1);
  assert.equal(state.status, "QUOTING");
  assert.equal(state.openOrders, 6);
  assert.equal(state.quoteEpoch, 2);
});

test("derives feed staleness only after the exact 2,500ms boundary", () => {
  let state = advance(createInitialState(), demoScenarios.staleFeedRecovery, 4);
  assert.equal(state.nowMs - (state.lastOddsAtMs ?? 0), 2_500);
  assert.equal(state.status, "QUOTING");
  assert.equal(state.openOrders, 6);

  state = advance(state, demoScenarios.staleFeedRecovery, 1);
  assert.equal(state.nowMs - (state.lastOddsAtMs ?? 0), 2_501);
  assert.equal(state.status, "STALE");
  assert.equal(state.openOrders, 0);
  assert.equal(state.cancelledOrders, 6);

  state = advance(state, demoScenarios.staleFeedRecovery, 3);
  assert.equal(state.stableFrames, 3);
  assert.equal(state.status, "REPRICING");

  state = advance(state, demoScenarios.staleFeedRecovery, 1);
  assert.equal(state.status, "QUOTING");
  assert.equal(state.openOrders, 6);
  assert.equal(state.quoteEpoch, 2);
});

test("quarantines malformed and duplicate source frames", () => {
  const state = advance(createInitialState(), demoScenarios.outlierResilience, 2);
  const initialBooks = demoScenarios.outlierResilience[1].books;
  assert.ok(initialBooks);

  const duplicate = reduceEvent(state, {
    id: "duplicate-frame",
    atMs: 200,
    clock: "62:14.200",
    kind: "ODDS_FRAME",
    title: "Duplicate frame",
    detail: "Test fixture",
    books: initialBooks,
  });
  assert.equal(duplicate.status, "QUOTING");
  assert.equal(duplicate.rejectedFrames, 1);
  assert.equal(duplicate.audit[0].title, "Reference frame quarantined");

  const malformedBooks = initialBooks.map((book, index) => ({
    ...book,
    sequence: 2,
    decimal: index === 0 ? { ...book.decimal, HOME: 1 } : { ...book.decimal },
  }));
  const malformed = reduceEvent(duplicate, {
    id: "malformed-frame",
    atMs: 300,
    clock: "62:14.300",
    kind: "ODDS_FRAME",
    title: "Malformed frame",
    detail: "Test fixture",
    books: malformedBooks,
  });
  assert.equal(malformed.rejectedFrames, 2);
  assert.throws(() => consensusFromBooks(initialBooks.slice(0, 2)), RangeError);
});

test("counterfactual output changes when the post-event fair value changes", () => {
  const shocked = advance(createInitialState(), demoScenarios.goalShock, 5);
  assert.ok(shocked.suspendedQuotes);
  const alternative = calculateCounterfactual(shocked.suspendedQuotes, {
    HOME: 0.5,
    DRAW: 0.3,
    AWAY: 0.2,
  });
  assert.notEqual(alternative.loss, 109.96);
  assert.ok(alternative.loss > 0);
});

test("applies paper fills to inventory, cash, quote skew and capacity", () => {
  const quoting = advance(createInitialState(), demoScenarios.outlierResilience, 2);
  const filled = reduceEvent(quoting, {
    id: "paper-fill",
    atMs: 200,
    clock: "62:14.200",
    kind: "PARTIAL_FILL",
    title: "Paper fill",
    detail: "Test fixture",
    outcome: "HOME",
    quantity: 100,
    price: 0.6412,
  });
  const home = quoteRows(filled)[0];

  assert.equal(filled.inventory.HOME, 100);
  assert.ok(Math.abs(filled.cash + 64.12) < 1e-12);
  assert.equal(home.quantity, 225);
  assert.equal(home.bid, 0.4032);
  assert.equal(home.ask, 0.4272);
});

test("full time is terminal and out-of-order events are ignored", () => {
  const quoting = advance(createInitialState(), demoScenarios.outlierResilience, 2);
  const outOfOrder = reduceEvent(quoting, {
    id: "late-clock",
    atMs: 50,
    clock: "62:14.050",
    kind: "TIMER",
    title: "Old timer",
    detail: "Test fixture",
  });
  assert.deepEqual(outOfOrder, quoting);

  const closed = reduceEvent(quoting, {
    id: "full-time",
    atMs: 9_000,
    clock: "90:00.000",
    kind: "FULL_TIME",
    title: "Full time",
    detail: "Test fixture",
    score: { home: 1, away: 0 },
  });
  const late = reduceEvent(closed, {
    id: "late-event",
    atMs: 9_100,
    clock: "90:00.100",
    kind: "TIMER",
    title: "Late timer",
    detail: "Test fixture",
  });
  assert.equal(closed.status, "CLOSED");
  assert.deepEqual(late, closed);
});

test("focused scenarios contain raw observations rather than verdict flags", () => {
  for (const events of Object.values(demoScenarios)) {
    for (const event of events) {
      assert.equal(event.stable, undefined);
      assert.notEqual(event.kind, "FEED_TIMEOUT");
      assert.notEqual(event.kind, "RECOVERY_FRAME");
    }
  }
});

test("every focused replay is deterministic", () => {
  for (const events of Object.values(demoScenarios)) {
    const run = () => advance(createInitialState(), events, events.length);
    assert.deepEqual(run(), run());
  }
});
