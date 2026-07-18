import type {
  ApiSuccess,
  Fixture,
  MatchWinnerOdds,
  ScoreSnapshot,
  StreamEnvelope,
} from "../lib/contracts";
import { encodeSseMessage } from "./sse";
import { TxlineRequestError, type TxlineStreamKind } from "./txline";

export const SYNTHETIC_FIXTURE_ID = 20_260_001;
const SYNTHETIC_START_TIME = Date.UTC(2026, 6, 18, 19, 0, 0);

export const syntheticFixture: Fixture = {
  fixtureId: SYNTHETIC_FIXTURE_ID,
  fixtureGroupId: 20_260,
  competitionId: 2_026,
  competition: "International tournament demo",
  startTime: SYNTHETIC_START_TIME,
  updatedAt: SYNTHETIC_START_TIME,
  participant1IsHome: true,
  participant1: { id: 10_001, name: "Aurora" },
  participant2: { id: 10_002, name: "Pacifica" },
  home: { id: 10_001, name: "Aurora" },
  away: { id: 10_002, name: "Pacifica" },
};

export function syntheticFixtures() {
  return [syntheticFixture];
}

export function assertSyntheticFixture(fixtureId: number) {
  if (fixtureId !== SYNTHETIC_FIXTURE_ID) {
    throw new TxlineRequestError(
      "FIXTURE_NOT_FOUND",
      "The requested fixture is not available in the synthetic dataset.",
      404,
    );
  }
}

export function syntheticOdds(sequence = 1, ts = SYNTHETIC_START_TIME) {
  const frames = [
    { HOME: 0.423, DRAW: 0.286, AWAY: 0.291 },
    { HOME: 0.424, DRAW: 0.285, AWAY: 0.291 },
    // The third transport frame crosses the live engine's four-point shock
    // boundary. Later frames settle into one stable post-goal regime so the
    // same production reducer can demonstrate guarded recovery and requoting.
    { HOME: 0.481, DRAW: 0.264, AWAY: 0.255 },
    { HOME: 0.486, DRAW: 0.262, AWAY: 0.252 },
    { HOME: 0.487, DRAW: 0.2615, AWAY: 0.2515 },
    { HOME: 0.4865, DRAW: 0.262, AWAY: 0.2515 },
    { HOME: 0.4868, DRAW: 0.2618, AWAY: 0.2514 },
    { HOME: 0.4872, DRAW: 0.2616, AWAY: 0.2512 },
  ];
  const frameIndex = Math.min(Math.max(1, sequence), frames.length) - 1;
  const probabilities = frames[frameIndex];
  const rawPct = {
    HOME: (probabilities.HOME * 100).toFixed(3),
    DRAW: (probabilities.DRAW * 100).toFixed(3),
    AWAY: (probabilities.AWAY * 100).toFixed(3),
  };

  return {
    fixtureId: SYNTHETIC_FIXTURE_ID,
    messageId: `synthetic-odds-${sequence}`,
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
    rawPct,
    probabilities,
  } satisfies MatchWinnerOdds;
}

export function syntheticScore(sequence = 1, ts = SYNTHETIC_START_TIME) {
  const goalScored = sequence >= 4;
  const redCardShown = sequence >= 10;
  const finalised = sequence >= 12;
  const action = finalised
    ? "game_finalised"
    : sequence === 4
      ? "goal_confirmed"
      : sequence === 10
        ? "red_card_confirmed"
        : "score_update";

  return {
    fixtureId: SYNTHETIC_FIXTURE_ID,
    seq: Math.max(1, sequence),
    id: `synthetic-score-${Math.max(1, sequence)}`,
    ts,
    connectionId: "synthetic-demo",
    dedupeKey: JSON.stringify([
      SYNTHETIC_FIXTURE_ID,
      "synthetic-demo",
      Math.max(1, sequence),
      `synthetic-score-${Math.max(1, sequence)}`,
    ]),
    action,
    confirmed:
      action === "goal_confirmed" ||
      action === "red_card_confirmed" ||
      finalised
        ? true
        : null,
    finalised,
    statusId: finalised ? 100 : 3,
    gameState: finalised ? "final" : "in_running",
    score: { home: goalScored ? 1 : 0, away: 0 },
    redCards: { home: 0, away: redCardShown ? 1 : 0 },
    participant1IsHome: true,
    coverage: { secondaryData: false, type: "synthetic" },
  } satisfies ScoreSnapshot;
}

export function syntheticEnvelope<T>(data: T): ApiSuccess<T> {
  return {
    data,
    mode: "synthetic",
    source: "synthetic",
    receivedAt: new Date().toISOString(),
  };
}

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

export function createSyntheticStream(
  kind: TxlineStreamKind,
  fixtureId: number,
) {
  assertSyntheticFixture(fixtureId);
  const encoder = new TextEncoder();
  let cursor = 0;
  let cancelled = false;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (cursor > 0) await wait(1_000);
      if (cancelled) return;
      cursor += 1;
      const now = Date.now();

      if (cursor % 5 === 0) {
        controller.enqueue(
          encoder.encode(
            encodeSseMessage({
              event: "heartbeat",
              id: `synthetic-heartbeat-${cursor}`,
              data: JSON.stringify({
                Ts: now,
                source: "synthetic",
                receivedAt: new Date(now).toISOString(),
              }),
            }),
          ),
        );
        return;
      }

      const data =
        kind === "odds"
          ? syntheticOdds(cursor, now)
          : syntheticScore(cursor, now);
      const eventId = `synthetic-${kind}-${cursor}`;
      const envelope: StreamEnvelope<typeof data> = {
        data,
        mode: "synthetic",
        source: "synthetic",
        receivedAt: new Date(now).toISOString(),
        eventId,
      };
      controller.enqueue(
        encoder.encode(
          encodeSseMessage({
            event: kind === "odds" ? "odds" : "score",
            id: eventId,
            retry: 1_000,
            data: JSON.stringify(envelope),
          }),
        ),
      );
    },
    cancel() {
      cancelled = true;
    },
  });
}
