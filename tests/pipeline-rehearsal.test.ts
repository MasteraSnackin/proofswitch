import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
import {
  activeLivePaperOrders,
  createLiveEngineState,
  reduceLiveEngineEvent,
  type LiveEngineEvent,
  type LiveEngineState,
} from "../app/live-engine.ts";

// The application bundler resolves extensionless TypeScript imports. Register a
// test-process-only equivalent before loading the real synthetic server adapter.
register(
  `data:text/javascript,${encodeURIComponent(`
    export async function resolve(specifier, context, nextResolve) {
      try {
        return await nextResolve(specifier, context);
      } catch (error) {
        const relative = specifier.startsWith("./") || specifier.startsWith("../");
        const filename = specifier.split("/").at(-1) ?? "";
        if (error?.code === "ERR_MODULE_NOT_FOUND" && relative && !filename.includes(".")) {
          return nextResolve(specifier + ".ts", context);
        }
        throw error;
      }
    }
  `)}`,
  import.meta.url,
);

const {
  SYNTHETIC_FIXTURE_ID,
  syntheticOdds,
  syntheticScore,
} = await import("../server/synthetic.ts");

const fixtureId = String(SYNTHETIC_FIXTURE_ID);
const startedAtMs = Date.UTC(2026, 6, 18, 19, 0, 0);

function clock(atMs: number) {
  return `T+${atMs - startedAtMs}ms`;
}

function oddsEvent(
  sequence: number,
  atMs: number,
): Extract<LiveEngineEvent, { kind: "ODDS" }> {
  const snapshot = syntheticOdds(sequence, atMs);
  return {
    kind: "ODDS",
    fixtureId: String(snapshot.fixtureId),
    messageId: snapshot.messageId ?? `synthetic-odds-${sequence}`,
    sseId: `synthetic-odds-sse-${sequence}`,
    priceTsMs: snapshot.ts,
    pct: snapshot.probabilities,
    inRunning: snapshot.inRunning,
    gameState: snapshot.gameState,
    atMs,
    clock: clock(atMs),
  };
}

function scoreEvent(
  sequence: number,
  atMs: number,
): Extract<LiveEngineEvent, { kind: "SCORE" }> {
  const snapshot = syntheticScore(sequence, atMs);
  return {
    kind: "SCORE",
    fixtureId: String(snapshot.fixtureId),
    seq: snapshot.seq,
    scoreTsMs: snapshot.ts,
    score: snapshot.score,
    redCards: snapshot.redCards,
    action: snapshot.action ?? undefined,
    confirmed: snapshot.confirmed,
    finalised: snapshot.finalised,
    atMs,
    clock: clock(atMs),
  };
}

function reduce(state: LiveEngineState, ...events: LiveEngineEvent[]) {
  return events.reduce(reduceLiveEngineEvent, state);
}

test("rehearses the synthetic adapter through the production paper engine", () => {
  let state = createLiveEngineState({ fixtureId });

  state = reduce(
    state,
    scoreEvent(1, startedAtMs),
    oddsEvent(1, startedAtMs + 100),
  );

  assert.equal(state.status, "QUOTING");
  assert.equal(activeLivePaperOrders(state).length, 6);
  assert.deepEqual(
    state.executionCommands.map((command) => command.kind),
    ["PLACE_QUOTES"],
  );

  state = reduce(
    state,
    oddsEvent(2, startedAtMs + 600),
    oddsEvent(3, startedAtMs + 1_200),
  );

  assert.equal(state.status, "SUSPENDED");
  assert.ok(state.lastMovement >= 0.04);
  assert.equal(activeLivePaperOrders(state).length, 0);
  assert.deepEqual(state.suspensionCauses, ["PRICE_SHOCK"]);
  assert.equal(
    state.executionCommands.filter((command) => command.kind === "CANCEL_ALL").length,
    1,
  );

  state = reduce(state, scoreEvent(4, startedAtMs + 1_500));

  assert.deepEqual(state.score, { home: 1, away: 0 });
  assert.equal(state.lastScoreSeq, 4);
  assert.equal(state.scoreConfirmationRequired, false);
  assert.equal(state.stableObservations, 0);
  assert.equal(state.holdUntilMs, startedAtMs + 4_500);
  assert.equal(
    state.executionCommands.filter((command) => command.kind === "CANCEL_ALL").length,
    1,
    "the confirmed goal must not duplicate the shock cancellation",
  );

  state = reduce(
    state,
    oddsEvent(4, startedAtMs + 1_800),
    oddsEvent(6, startedAtMs + 2_400),
    oddsEvent(7, startedAtMs + 3_000),
  );

  assert.equal(state.stableObservations, 3);
  assert.equal(state.status, "SUSPENDED", "the minimum hold has not expired");

  state = reduce(state, {
    kind: "TIMER",
    atMs: startedAtMs + 4_500,
    clock: clock(startedAtMs + 4_500),
  });

  assert.equal(state.status, "QUOTING");
  assert.equal(state.quoteEpoch, 2);
  assert.equal(activeLivePaperOrders(state).length, 6);
  assert.deepEqual(
    state.executionCommands.map((command) => command.kind),
    ["PLACE_QUOTES", "CANCEL_ALL", "PLACE_QUOTES"],
  );
  assert.equal(
    state.executionCommands.filter((command) => command.kind === "CANCEL_ALL").length,
    1,
  );

  assert.deepEqual(syntheticScore(9, startedAtMs).redCards, { home: 0, away: 0 });
  assert.deepEqual(syntheticScore(10, startedAtMs).redCards, { home: 0, away: 1 });
});
