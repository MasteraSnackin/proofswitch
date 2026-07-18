import type { TxlineNetwork } from "../lib/contracts";
import {
  defaultLivePolicy,
  normaliseLivePolicy,
  normaliseLivePrices,
  type LiveAuditEntry,
  type LiveEngineState,
  type LiveExecutionCommand,
  type LivePaperFill,
  type LivePaperInventory,
  type LivePaperOrder,
  type LivePolicy,
  type LivePrices,
  type LiveTransportChannel,
  type SuspensionCause,
} from "./live-engine.ts";

export const PAPER_SESSION_STORAGE_KEY = "proofswitch.live.paper-session";
export const PAPER_SESSION_SCHEMA = "proofswitch.paper-session";
export const PAPER_SESSION_VERSION = 1;
export const PAPER_SESSION_ENGINE_SCHEMA = "proofswitch.live-engine.v1";
export const PAPER_SESSION_MAX_BYTES = 512 * 1024;

export const PAPER_SESSION_LIMITS = Object.freeze({
  audit: 250,
  commands: 200,
  fills: 1_000,
  seenIdentities: 500,
  orders: 2_206,
  priceHistory: 256,
});

const STRICT_LIMITS = Object.freeze({
  audit: 100,
  commands: 50,
  fills: 250,
  seenIdentities: 100,
});

const MAX_ID_LENGTH = 256;
const MAX_SHORT_TEXT_LENGTH = 256;
const MAX_DETAIL_LENGTH = 2_000;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface PaperSessionFixture {
  fixtureId: number;
  competition: string;
  startTime: number;
  home: { id: number; name: string };
  away: { id: number; name: string };
}

export interface PaperSessionRetention {
  auditDropped: number;
  commandsDropped: number;
  fillsDropped: number;
  ordersDropped: number;
  seenIdentitiesDropped: number;
}

export interface PaperSessionV1 {
  schema: typeof PAPER_SESSION_SCHEMA;
  version: typeof PAPER_SESSION_VERSION;
  engineSchema: typeof PAPER_SESSION_ENGINE_SCHEMA;
  integrity: "device-local-unsigned";
  sessionId: string;
  revision: number;
  writerId: string;
  savedAtMs: number;
  scope: {
    mode: "live";
    network: TxlineNetwork;
    fixture: PaperSessionFixture;
  };
  engine: LiveEngineState;
  retention: PaperSessionRetention;
}

export interface PaperSessionDraft {
  sessionId: string;
  writerId: string;
  savedAtMs: number;
  network: TxlineNetwork;
  fixture: PaperSessionFixture;
  engine: LiveEngineState;
  /**
   * Cumulative omissions already recorded before this in-memory engine was
   * restored. This is a baseline, not the result of the immediately preceding
   * save of the same un-compacted engine.
   */
  priorRetention?: PaperSessionRetention;
}

export type PaperSessionDecodeResult =
  | { status: "ready"; session: PaperSessionV1; bytes: number }
  | { status: "invalid"; message: string }
  | { status: "incompatible"; message: string; foundVersion: number | null }
  | { status: "too-large"; message: string; bytes: number };

export type PaperSessionReadResult =
  | { status: "empty" }
  | { status: "ready"; session: PaperSessionV1; bytes: number }
  | { status: "network-mismatch"; session: PaperSessionV1; bytes: number }
  | Exclude<PaperSessionDecodeResult, { status: "ready" }>
  | { status: "unavailable"; message: string };

export type PaperSessionWriteResult =
  | { status: "saved"; session: PaperSessionV1; bytes: number }
  | { status: "invalid" | "conflict" | "unavailable"; message: string }
  | { status: "too-large"; message: string; bytes: number };

export type PaperSessionClearResult =
  | { status: "cleared" }
  | { status: "unavailable"; message: string };

class SessionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionValidationError";
  }
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown, path: string): UnknownRecord {
  if (!isRecord(value)) throw new SessionValidationError(`${path} must be an object.`);
  return value;
}

function text(value: unknown, path: string, maximum = MAX_SHORT_TEXT_LENGTH) {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum) {
    throw new SessionValidationError(
      `${path} must be a non-empty string no longer than ${maximum} characters.`,
    );
  }
  return value;
}

function optionalText(value: unknown, path: string, maximum = MAX_SHORT_TEXT_LENGTH) {
  if (value === null) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  return text(value, path, maximum);
}

function finite(value: unknown, path: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new SessionValidationError(
      `${path} must be a finite number between ${minimum} and ${maximum}.`,
    );
  }
  return value;
}

function integer(value: unknown, path: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = finite(value, path, minimum, maximum);
  if (!Number.isSafeInteger(parsed)) {
    throw new SessionValidationError(`${path} must be a safe integer.`);
  }
  return parsed;
}

function nullableFinite(value: unknown, path: string) {
  return value === null ? null : finite(value, path);
}

function signedFinite(value: unknown, path: string) {
  return finite(value, path, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
}

function nullableSignedFinite(value: unknown, path: string) {
  return value === null ? null : signedFinite(value, path);
}

function nullableInteger(value: unknown, path: string) {
  return value === null ? null : integer(value, path);
}

function boolean(value: unknown, path: string) {
  if (typeof value !== "boolean") {
    throw new SessionValidationError(`${path} must be a boolean.`);
  }
  return value;
}

function oneOf<T extends string>(
  value: unknown,
  path: string,
  accepted: readonly T[],
): T {
  if (typeof value !== "string" || !accepted.includes(value as T)) {
    throw new SessionValidationError(`${path} contains an unsupported value.`);
  }
  return value as T;
}

function array(value: unknown, path: string, maximum: number) {
  if (!Array.isArray(value) || value.length > maximum) {
    throw new SessionValidationError(`${path} must contain no more than ${maximum} entries.`);
  }
  return value;
}

function unique(values: readonly string[], path: string) {
  if (new Set(values).size !== values.length) {
    throw new SessionValidationError(`${path} must not contain duplicate identifiers.`);
  }
}

function stringArray(value: unknown, path: string, maximum: number) {
  const parsed = array(value, path, maximum).map((entry, index) =>
    text(entry, `${path}[${index}]`, MAX_ID_LENGTH),
  );
  unique(parsed, path);
  return parsed;
}

function fixtureIdString(value: unknown, path: string) {
  const parsed = text(value, path, 32);
  if (!/^[1-9]\d*$/.test(parsed) || !Number.isSafeInteger(Number(parsed))) {
    throw new SessionValidationError(`${path} must be a positive safe integer string.`);
  }
  return parsed;
}

function pairOfIntegers(value: unknown, path: string) {
  const parsed = record(value, path);
  return {
    home: integer(parsed.home, `${path}.home`),
    away: integer(parsed.away, `${path}.away`),
  };
}

function pairOfBooleans(value: unknown, path: string) {
  const parsed = record(value, path);
  return {
    home: boolean(parsed.home, `${path}.home`),
    away: boolean(parsed.away, `${path}.away`),
  };
}

function outcomeValues(value: unknown, path: string): LivePaperInventory {
  const parsed = record(value, path);
  return {
    HOME: signedFinite(parsed.HOME, `${path}.HOME`),
    DRAW: signedFinite(parsed.DRAW, `${path}.DRAW`),
    AWAY: signedFinite(parsed.AWAY, `${path}.AWAY`),
  };
}

function prices(value: unknown, path: string): LivePrices {
  const parsed = record(value, path);
  try {
    return normaliseLivePrices({
      HOME: finite(parsed.HOME, `${path}.HOME`, 0, 1),
      DRAW: finite(parsed.DRAW, `${path}.DRAW`, 0, 1),
      AWAY: finite(parsed.AWAY, `${path}.AWAY`, 0, 1),
    });
  } catch (error) {
    throw new SessionValidationError(
      `${path} is invalid: ${error instanceof Error ? error.message : "invalid probabilities"}.`,
    );
  }
}

function nullablePrices(value: unknown, path: string) {
  return value === null ? null : prices(value, path);
}

function validateStoredPolicy(value: unknown): LivePolicy {
  const parsed = record(value, "session.engine.policy");
  const channels = stringArray(
    parsed.requiredTransportChannels,
    "session.engine.policy.requiredTransportChannels",
    2,
  );
  if (
    channels.length === 0 ||
    channels.some((channel) => channel !== "ODDS" && channel !== "SCORES")
  ) {
    throw new SessionValidationError(
      "session.engine.policy.requiredTransportChannels contains an unsupported channel.",
    );
  }
  try {
    return normaliseLivePolicy({
      shockWindowMs: finite(
        parsed.shockWindowMs,
        "session.engine.policy.shockWindowMs",
      ),
      shockDelta: finite(parsed.shockDelta, "session.engine.policy.shockDelta"),
      transportTimeoutMs: finite(
        parsed.transportTimeoutMs,
        "session.engine.policy.transportTimeoutMs",
      ),
      maximumPriceSilenceMs: finite(
        parsed.maximumPriceSilenceMs,
        "session.engine.policy.maximumPriceSilenceMs",
      ),
      maximumPriceSourceAgeMs: finite(
        parsed.maximumPriceSourceAgeMs,
        "session.engine.policy.maximumPriceSourceAgeMs",
      ),
      maximumFutureClockSkewMs: finite(
        parsed.maximumFutureClockSkewMs,
        "session.engine.policy.maximumFutureClockSkewMs",
      ),
      minimumSuspendMs: finite(
        parsed.minimumSuspendMs,
        "session.engine.policy.minimumSuspendMs",
      ),
      stableObservationsRequired: integer(
        parsed.stableObservationsRequired,
        "session.engine.policy.stableObservationsRequired",
        1,
      ),
      stableObservationDelta: finite(
        parsed.stableObservationDelta,
        "session.engine.policy.stableObservationDelta",
      ),
      baseHalfSpread: finite(
        parsed.baseHalfSpread,
        "session.engine.policy.baseHalfSpread",
      ),
      baseQuantity: finite(
        parsed.baseQuantity,
        "session.engine.policy.baseQuantity",
      ),
      maximumLiability: finite(
        parsed.maximumLiability === undefined
          ? defaultLivePolicy.maximumLiability
          : parsed.maximumLiability,
        "session.engine.policy.maximumLiability",
      ),
      priceTick: finite(parsed.priceTick, "session.engine.policy.priceTick"),
      requoteDelta: finite(
        parsed.requoteDelta,
        "session.engine.policy.requoteDelta",
      ),
      minimumRequoteIntervalMs: finite(
        parsed.minimumRequoteIntervalMs,
        "session.engine.policy.minimumRequoteIntervalMs",
      ),
      requiredTransportChannels: channels as LiveTransportChannel[],
    });
  } catch (error) {
    throw new SessionValidationError(
      `session.engine.policy is invalid: ${error instanceof Error ? error.message : "unsupported policy"}.`,
    );
  }
}

function transportTimes(value: unknown, path: string) {
  const parsed = record(value, path);
  return {
    ODDS: nullableFinite(parsed.ODDS, `${path}.ODDS`),
    SCORES: nullableFinite(parsed.SCORES, `${path}.SCORES`),
  } satisfies Record<LiveTransportChannel, number | null>;
}

function paperOrder(value: unknown, index: number, fixtureId: string): LivePaperOrder {
  const path = `session.engine.paperOrders[${index}]`;
  const parsed = record(value, path);
  const orderFixtureId = fixtureIdString(parsed.fixtureId, `${path}.fixtureId`);
  if (orderFixtureId !== fixtureId) {
    throw new SessionValidationError(`${path}.fixtureId does not match the session fixture.`);
  }
  const state = oneOf(parsed.state, `${path}.state`, ["OPEN", "CANCELLED", "CLOSED"] as const);
  const cancelledAtMs = nullableFinite(parsed.cancelledAtMs, `${path}.cancelledAtMs`);
  if (state === "OPEN" && cancelledAtMs !== null) {
    throw new SessionValidationError(`${path} cannot be OPEN with a cancellation timestamp.`);
  }
  if (state === "CANCELLED" && cancelledAtMs === null) {
    throw new SessionValidationError(`${path} must retain its cancellation timestamp.`);
  }
  return {
    id: text(parsed.id, `${path}.id`, MAX_ID_LENGTH),
    fixtureId: orderFixtureId,
    epoch: integer(parsed.epoch, `${path}.epoch`, 1),
    outcome: oneOf(parsed.outcome, `${path}.outcome`, ["HOME", "DRAW", "AWAY"] as const),
    side: oneOf(parsed.side, `${path}.side`, ["BID", "ASK"] as const),
    price: finite(parsed.price, `${path}.price`, 0, 1),
    quantity: finite(parsed.quantity, `${path}.quantity`, 0),
    state,
    createdAtMs: finite(parsed.createdAtMs, `${path}.createdAtMs`),
    cancelledAtMs,
  };
}

function paperFill(value: unknown, index: number): LivePaperFill {
  const path = `session.engine.paperFills[${index}]`;
  const parsed = record(value, path);
  const quantity = finite(parsed.quantity, `${path}.quantity`);
  if (quantity <= 0) {
    throw new SessionValidationError(`${path}.quantity must be greater than zero.`);
  }
  return {
    id: text(parsed.id, `${path}.id`, MAX_ID_LENGTH),
    fixtureId: fixtureIdString(parsed.fixtureId, `${path}.fixtureId`),
    orderId: text(parsed.orderId, `${path}.orderId`, MAX_ID_LENGTH),
    atMs: finite(parsed.atMs, `${path}.atMs`),
    outcome: oneOf(parsed.outcome, `${path}.outcome`, ["HOME", "DRAW", "AWAY"] as const),
    side: oneOf(parsed.side, `${path}.side`, ["BID", "ASK"] as const),
    price: finite(parsed.price, `${path}.price`, 0, 1),
    quantity,
    notional: finite(parsed.notional, `${path}.notional`),
    cashDelta: signedFinite(parsed.cashDelta, `${path}.cashDelta`),
    inventoryDelta: signedFinite(
      parsed.inventoryDelta,
      `${path}.inventoryDelta`,
    ),
  };
}

function executionCommand(value: unknown, index: number): LiveExecutionCommand {
  const path = `session.engine.executionCommands[${index}]`;
  const parsed = record(value, path);
  const orderIds = stringArray(parsed.orderIds, `${path}.orderIds`, 6);
  if (orderIds.length === 0) {
    throw new SessionValidationError(`${path}.orderIds must not be empty.`);
  }
  return {
    id: text(parsed.id, `${path}.id`, MAX_ID_LENGTH),
    kind: oneOf(parsed.kind, `${path}.kind`, ["PLACE_QUOTES", "CANCEL_ALL"] as const),
    atMs: finite(parsed.atMs, `${path}.atMs`),
    orderIds,
  };
}

function auditEntry(value: unknown, index: number): LiveAuditEntry {
  const path = `session.engine.audit[${index}]`;
  const parsed = record(value, path);
  return {
    id: text(parsed.id, `${path}.id`, MAX_ID_LENGTH),
    atMs: finite(parsed.atMs, `${path}.atMs`),
    clock: text(parsed.clock, `${path}.clock`, 64),
    source: oneOf(
      parsed.source,
      `${path}.source`,
      ["FEED", "TXLINE", "AGENT", "EXECUTION"] as const,
    ),
    tone: oneOf(parsed.tone, `${path}.tone`, ["neutral", "healthy", "warning", "danger"] as const),
    title: text(parsed.title, `${path}.title`, MAX_SHORT_TEXT_LENGTH),
    detail: text(parsed.detail, `${path}.detail`, MAX_DETAIL_LENGTH),
  };
}

function validateEngine(value: unknown): LiveEngineState {
  const parsed = record(value, "session.engine");
  const fixtureId = fixtureIdString(parsed.fixtureId, "session.engine.fixtureId");
  const policy = validateStoredPolicy(parsed.policy);

  const paperOrders = array(
    parsed.paperOrders,
    "session.engine.paperOrders",
    PAPER_SESSION_LIMITS.orders,
  ).map((entry, index) => paperOrder(entry, index, fixtureId));
  unique(paperOrders.map((order) => order.id), "session.engine.paperOrders");

  const paperFills = (
    parsed.paperFills === undefined
      ? []
      : array(
          parsed.paperFills,
          "session.engine.paperFills",
          PAPER_SESSION_LIMITS.fills,
        )
  ).map((entry, index) => paperFill(entry, index));
  unique(paperFills.map((fill) => fill.id), "session.engine.paperFills");
  const orderById = new Map(paperOrders.map((order) => [order.id, order]));
  const filledByOrder = new Map<string, number>();
  for (const fill of paperFills) {
    if (fill.fixtureId !== fixtureId) {
      throw new SessionValidationError(
        "session.engine.paperFills contains a cross-fixture fill.",
      );
    }
    const order = orderById.get(fill.orderId);
    if (!order) {
      throw new SessionValidationError(
        "session.engine.paperFills contains an unknown order reference.",
      );
    }
    const expectedNotional = order.price * fill.quantity;
    const direction = order.side === "BID" ? 1 : -1;
    if (
      fill.outcome !== order.outcome ||
      fill.side !== order.side ||
      Math.abs(fill.price - order.price) > 1e-10 ||
      Math.abs(fill.notional - expectedNotional) > 1e-8 ||
      Math.abs(fill.cashDelta + direction * expectedNotional) > 1e-8 ||
      Math.abs(fill.inventoryDelta - direction * fill.quantity) > 1e-8
    ) {
      throw new SessionValidationError(
        "session.engine.paperFills contains values that do not match its paper order.",
      );
    }
    const total = (filledByOrder.get(order.id) ?? 0) + fill.quantity;
    if (total > order.quantity + 1e-10) {
      throw new SessionValidationError(
        "session.engine.paperFills exceeds a paper order's quantity.",
      );
    }
    filledByOrder.set(order.id, total);
  }

  const executionCommands = array(
    parsed.executionCommands,
    "session.engine.executionCommands",
    PAPER_SESSION_LIMITS.commands,
  ).map(executionCommand);
  unique(executionCommands.map((command) => command.id), "session.engine.executionCommands");

  const knownOrders = new Set(paperOrders.map((order) => order.id));
  for (const command of executionCommands) {
    if (command.orderIds.some((orderId) => !knownOrders.has(orderId))) {
      throw new SessionValidationError(
        `session.engine.executionCommands contains an order reference that was not retained.`,
      );
    }
  }

  const audit = array(parsed.audit, "session.engine.audit", PAPER_SESSION_LIMITS.audit).map(
    auditEntry,
  );
  unique(audit.map((entry) => entry.id), "session.engine.audit");

  const status = oneOf(
    parsed.status,
    "session.engine.status",
    ["BOOTSTRAPPING", "QUOTING", "SUSPENDED", "STALE", "CLOSED"] as const,
  );
  const quoteEpoch = integer(parsed.quoteEpoch, "session.engine.quoteEpoch");
  const openOrders = paperOrders.filter((order) => order.state === "OPEN");
  if (openOrders.length > 6) {
    throw new SessionValidationError("session.engine.paperOrders contains more than six OPEN orders.");
  }
  if (openOrders.some((order) => order.epoch !== quoteEpoch)) {
    throw new SessionValidationError("OPEN paper orders must belong to the current quote epoch.");
  }
  if (status === "CLOSED" && openOrders.length > 0) {
    throw new SessionValidationError("A CLOSED session cannot retain OPEN paper orders.");
  }

  const causes = array(parsed.suspensionCauses, "session.engine.suspensionCauses", 8).map(
    (cause, index) =>
      oneOf(
        cause,
        `session.engine.suspensionCauses[${index}]`,
        [
          "PRICE_SHOCK",
          "MATERIAL_EVENT",
          "TRANSPORT_TIMEOUT",
          "PRICE_STALE",
          "MARKET_NOT_IN_RUNNING",
          "MAXIMUM_LIABILITY",
          "EMERGENCY_STOP",
          "SESSION_ENDED",
        ] as const,
      ),
  );
  unique(causes, "session.engine.suspensionCauses");

  const pending = parsed.pendingMaterialSignal === null
    ? null
    : (() => {
        const signal = record(
          parsed.pendingMaterialSignal,
          "session.engine.pendingMaterialSignal",
        );
        return {
          signalId: text(
            signal.signalId,
            "session.engine.pendingMaterialSignal.signalId",
            MAX_ID_LENGTH,
          ),
          material: oneOf(
            signal.material,
            "session.engine.pendingMaterialSignal.material",
            ["GOAL", "RED_CARD"] as const,
          ),
          receivedAtMs: finite(
            signal.receivedAtMs,
            "session.engine.pendingMaterialSignal.receivedAtMs",
          ),
        };
      })();

  const emergencyStop = parsed.emergencyStop === undefined || parsed.emergencyStop === null
    ? null
    : (() => {
        const stop = record(parsed.emergencyStop, "session.engine.emergencyStop");
        return {
          stopId: text(
            stop.stopId,
            "session.engine.emergencyStop.stopId",
            MAX_ID_LENGTH,
          ),
          engagedAtMs: finite(
            stop.engagedAtMs,
            "session.engine.emergencyStop.engagedAtMs",
          ),
          reason: text(
            stop.reason,
            "session.engine.emergencyStop.reason",
            MAX_DETAIL_LENGTH,
          ),
        };
      })();

  const priceHistory = array(
    parsed.priceHistory,
    "session.engine.priceHistory",
    PAPER_SESSION_LIMITS.priceHistory,
  ).map((entry, index) => {
    const frame = record(entry, `session.engine.priceHistory[${index}]`);
    return {
      priceTsMs: finite(
        frame.priceTsMs,
        `session.engine.priceHistory[${index}].priceTsMs`,
      ),
      fair: prices(frame.fair, `session.engine.priceHistory[${index}].fair`),
    };
  });

  const paperCash = parsed.paperCash === undefined && paperFills.length === 0
    ? 0
    : signedFinite(parsed.paperCash, "session.engine.paperCash");
  const paperInventory = parsed.paperInventory === undefined && paperFills.length === 0
    ? { HOME: 0, DRAW: 0, AWAY: 0 }
    : outcomeValues(parsed.paperInventory, "session.engine.paperInventory");
  const paperFilledNotional = parsed.paperFilledNotional === undefined && paperFills.length === 0
    ? 0
    : finite(parsed.paperFilledNotional, "session.engine.paperFilledNotional");
  const retainedNotional = paperFills.reduce(
    (total, fill) => total + fill.notional,
    0,
  );
  if (paperFilledNotional + 1e-8 < retainedNotional) {
    throw new SessionValidationError(
      "session.engine.paperFilledNotional is lower than its retained fill notional.",
    );
  }
  const settledOutcome = parsed.settledOutcome === undefined || parsed.settledOutcome === null
    ? null
    : oneOf(
        parsed.settledOutcome,
        "session.engine.settledOutcome",
        ["HOME", "DRAW", "AWAY"] as const,
      );
  const settledPnl = parsed.settledPnl === undefined || parsed.settledPnl === null
    ? null
    : nullableSignedFinite(parsed.settledPnl, "session.engine.settledPnl");
  if ((settledOutcome === null) !== (settledPnl === null)) {
    throw new SessionValidationError(
      "session.engine settlement outcome and P&L must either both be present or both be null.",
    );
  }

  const engine: LiveEngineState = {
    fixtureId,
    // The policy is historical evidence. The dashboard closes a restored
    // engine before exposing it and creates a fresh engine for any new run.
    policy,
    status,
    reason: text(parsed.reason, "session.engine.reason", MAX_DETAIL_LENGTH),
    nowMs: finite(parsed.nowMs, "session.engine.nowMs"),
    matchClock: text(parsed.matchClock, "session.engine.matchClock", 64),
    score: pairOfIntegers(parsed.score, "session.engine.score"),
    redCards: pairOfIntegers(parsed.redCards, "session.engine.redCards"),
    scoreKnown: pairOfBooleans(parsed.scoreKnown, "session.engine.scoreKnown"),
    redCardsKnown: pairOfBooleans(parsed.redCardsKnown, "session.engine.redCardsKnown"),
    scoreInitialised: boolean(parsed.scoreInitialised, "session.engine.scoreInitialised"),
    lastScoreSeq: nullableInteger(parsed.lastScoreSeq, "session.engine.lastScoreSeq"),
    fair: nullablePrices(parsed.fair, "session.engine.fair"),
    quotedFair: nullablePrices(parsed.quotedFair, "session.engine.quotedFair"),
    marketInRunning: boolean(parsed.marketInRunning, "session.engine.marketInRunning"),
    marketGameState: optionalText(
      parsed.marketGameState,
      "session.engine.marketGameState",
      MAX_SHORT_TEXT_LENGTH,
    ),
    lastPriceTsMs: nullableFinite(parsed.lastPriceTsMs, "session.engine.lastPriceTsMs"),
    lastOddsReceivedAtMs: nullableFinite(
      parsed.lastOddsReceivedAtMs,
      "session.engine.lastOddsReceivedAtMs",
    ),
    lastQuoteAtMs: nullableFinite(parsed.lastQuoteAtMs, "session.engine.lastQuoteAtMs"),
    lastTransportAtMs: transportTimes(
      parsed.lastTransportAtMs,
      "session.engine.lastTransportAtMs",
    ),
    lastHeartbeatAtMs: transportTimes(
      parsed.lastHeartbeatAtMs,
      "session.engine.lastHeartbeatAtMs",
    ),
    priceHistory,
    lastMovement: finite(parsed.lastMovement, "session.engine.lastMovement", 0, 1),
    stableObservations: integer(
      parsed.stableObservations,
      "session.engine.stableObservations",
    ),
    lastStableFair: nullablePrices(parsed.lastStableFair, "session.engine.lastStableFair"),
    holdUntilMs: nullableFinite(parsed.holdUntilMs, "session.engine.holdUntilMs"),
    scoreConfirmationRequired: boolean(
      parsed.scoreConfirmationRequired,
      "session.engine.scoreConfirmationRequired",
    ),
    pendingMaterialSignal: pending,
    suspensionCauses: causes as SuspensionCause[],
    quoteEpoch,
    paperOrders,
    cancelledOrders: integer(parsed.cancelledOrders, "session.engine.cancelledOrders"),
    executionCommands,
    paperFills,
    paperCash,
    paperInventory,
    paperFilledNotional,
    paperFillRejects:
      parsed.paperFillRejects === undefined
        ? 0
        : integer(parsed.paperFillRejects, "session.engine.paperFillRejects"),
    settledOutcome,
    settledPnl,
    emergencyStop,
    seenOddsMessageIds: stringArray(
      parsed.seenOddsMessageIds,
      "session.engine.seenOddsMessageIds",
      PAPER_SESSION_LIMITS.seenIdentities,
    ),
    seenOddsSseIds: stringArray(
      parsed.seenOddsSseIds,
      "session.engine.seenOddsSseIds",
      PAPER_SESSION_LIMITS.seenIdentities,
    ),
    seenScoreKeys: stringArray(
      parsed.seenScoreKeys,
      "session.engine.seenScoreKeys",
      PAPER_SESSION_LIMITS.seenIdentities,
    ),
    seenMaterialSignalIds: stringArray(
      parsed.seenMaterialSignalIds,
      "session.engine.seenMaterialSignalIds",
      PAPER_SESSION_LIMITS.seenIdentities,
    ),
    seenPaperFillIds:
      parsed.seenPaperFillIds === undefined
        ? []
        : stringArray(
            parsed.seenPaperFillIds,
            "session.engine.seenPaperFillIds",
            PAPER_SESSION_LIMITS.seenIdentities,
          ),
    rejectedEvents: integer(parsed.rejectedEvents, "session.engine.rejectedEvents"),
    auditSequence: integer(parsed.auditSequence, "session.engine.auditSequence"),
    audit,
    auditTruncated: integer(parsed.auditTruncated, "session.engine.auditTruncated"),
  };

  if (engine.quoteEpoch < Math.max(0, ...paperOrders.map((order) => order.epoch))) {
    throw new SessionValidationError("session.engine.quoteEpoch precedes a retained order epoch.");
  }
  if (
    engine.cancelledOrders <
    paperOrders.filter((order) => order.state === "CANCELLED").length
  ) {
    throw new SessionValidationError(
      "session.engine.cancelledOrders is lower than the retained cancelled-order count.",
    );
  }
  if (
    engine.status !== "CLOSED" &&
    (engine.emergencyStop !== null) !==
      engine.suspensionCauses.includes("EMERGENCY_STOP")
  ) {
    throw new SessionValidationError(
      "session.engine emergency-stop evidence does not match its suspension cause.",
    );
  }
  if (engine.settledOutcome !== null) {
    if (engine.status !== "CLOSED") {
      throw new SessionValidationError(
        "session.engine can record settlement P&L only after the fixture closes.",
      );
    }
    const expectedPnl =
      engine.paperCash + engine.paperInventory[engine.settledOutcome];
    if (Math.abs(expectedPnl - engine.settledPnl!) > 1e-8) {
      throw new SessionValidationError(
        "session.engine settled P&L does not match its cash and winning-outcome inventory.",
      );
    }
  }
  return engine;
}

function validateFixture(value: unknown): PaperSessionFixture {
  const parsed = record(value, "session.scope.fixture");
  const participant = (candidate: unknown, path: string) => {
    const item = record(candidate, path);
    return {
      id: integer(item.id, `${path}.id`, 1),
      name: text(item.name, `${path}.name`, MAX_SHORT_TEXT_LENGTH),
    };
  };
  return {
    fixtureId: integer(parsed.fixtureId, "session.scope.fixture.fixtureId", 1),
    competition: text(
      parsed.competition,
      "session.scope.fixture.competition",
      MAX_SHORT_TEXT_LENGTH,
    ),
    startTime: finite(parsed.startTime, "session.scope.fixture.startTime"),
    home: participant(parsed.home, "session.scope.fixture.home"),
    away: participant(parsed.away, "session.scope.fixture.away"),
  };
}

function validateRetention(value: unknown): PaperSessionRetention {
  const parsed = record(value, "session.retention");
  return {
    auditDropped: integer(parsed.auditDropped, "session.retention.auditDropped"),
    commandsDropped: integer(parsed.commandsDropped, "session.retention.commandsDropped"),
    fillsDropped:
      parsed.fillsDropped === undefined
        ? 0
        : integer(parsed.fillsDropped, "session.retention.fillsDropped"),
    ordersDropped: integer(parsed.ordersDropped, "session.retention.ordersDropped"),
    seenIdentitiesDropped: integer(
      parsed.seenIdentitiesDropped,
      "session.retention.seenIdentitiesDropped",
    ),
  };
}

function validateSession(value: unknown): PaperSessionV1 {
  const parsed = record(value, "session");
  if (parsed.schema !== PAPER_SESSION_SCHEMA) {
    throw new SessionValidationError("Stored data is not a ProofSwitch paper session.");
  }
  if (parsed.version !== PAPER_SESSION_VERSION) {
    throw new SessionValidationError("Stored paper-session version is not supported.");
  }
  if (parsed.engineSchema !== PAPER_SESSION_ENGINE_SCHEMA) {
    throw new SessionValidationError("Stored live-engine schema is not supported.");
  }
  if (parsed.integrity !== "device-local-unsigned") {
    throw new SessionValidationError("Stored session integrity label is invalid.");
  }
  const scope = record(parsed.scope, "session.scope");
  if (scope.mode !== "live") {
    throw new SessionValidationError("Stored session mode must be live.");
  }
  const network = oneOf(scope.network, "session.scope.network", ["devnet", "mainnet"] as const);
  const fixture = validateFixture(scope.fixture);
  const engine = validateEngine(parsed.engine);
  if (engine.fixtureId !== String(fixture.fixtureId)) {
    throw new SessionValidationError("Stored fixture metadata and engine fixture do not match.");
  }

  return {
    schema: PAPER_SESSION_SCHEMA,
    version: PAPER_SESSION_VERSION,
    engineSchema: PAPER_SESSION_ENGINE_SCHEMA,
    integrity: "device-local-unsigned",
    sessionId: text(parsed.sessionId, "session.sessionId", 128),
    revision: integer(parsed.revision, "session.revision", 1),
    writerId: text(parsed.writerId, "session.writerId", 128),
    savedAtMs: finite(parsed.savedAtMs, "session.savedAtMs"),
    scope: { mode: "live", network, fixture },
    engine,
    retention: validateRetention(parsed.retention),
  };
}

function utf8Bytes(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

function storageMessage(error: unknown, action: string) {
  const detail = error instanceof Error && error.message ? ` ${error.message}` : "";
  return `Device storage could not ${action}.${detail}`;
}

function compactionLimits(strict: boolean) {
  return strict
    ? STRICT_LIMITS
      : {
        audit: PAPER_SESSION_LIMITS.audit,
        commands: PAPER_SESSION_LIMITS.commands,
        fills: PAPER_SESSION_LIMITS.fills,
        seenIdentities: PAPER_SESSION_LIMITS.seenIdentities,
      };
}

export function compactLiveEngineState(
  state: LiveEngineState,
  options: { strict?: boolean } = {},
): { engine: LiveEngineState; retention: PaperSessionRetention } {
  const limits = compactionLimits(Boolean(options.strict));
  const audit = state.audit.slice(0, limits.audit);
  const executionCommands = state.executionCommands.slice(-limits.commands);
  const paperFills = state.paperFills.slice(-limits.fills);
  const referencedOrderIds = new Set(
    executionCommands.flatMap((command) => command.orderIds),
  );
  for (const fill of paperFills) referencedOrderIds.add(fill.orderId);
  for (const order of state.paperOrders) {
    if (order.state === "OPEN") referencedOrderIds.add(order.id);
  }
  const paperOrders = state.paperOrders.filter((order) => referencedOrderIds.has(order.id));
  const seenOddsMessageIds = state.seenOddsMessageIds.slice(-limits.seenIdentities);
  const seenOddsSseIds = state.seenOddsSseIds.slice(-limits.seenIdentities);
  const seenScoreKeys = state.seenScoreKeys.slice(-limits.seenIdentities);
  const seenMaterialSignalIds = state.seenMaterialSignalIds.slice(-limits.seenIdentities);
  const seenPaperFillIds = state.seenPaperFillIds.slice(-limits.seenIdentities);
  const seenBefore =
    state.seenOddsMessageIds.length +
    state.seenOddsSseIds.length +
    state.seenScoreKeys.length +
    state.seenMaterialSignalIds.length +
    state.seenPaperFillIds.length;
  const seenAfter =
    seenOddsMessageIds.length +
    seenOddsSseIds.length +
    seenScoreKeys.length +
    seenMaterialSignalIds.length +
    seenPaperFillIds.length;

  return {
    engine: {
      ...state,
      policy: normaliseLivePolicy(state.policy),
      priceHistory: state.priceHistory.slice(-PAPER_SESSION_LIMITS.priceHistory),
      paperOrders,
      executionCommands,
      paperFills,
      seenOddsMessageIds,
      seenOddsSseIds,
      seenScoreKeys,
      seenMaterialSignalIds,
      seenPaperFillIds,
      audit,
    },
    retention: {
      auditDropped: Math.max(0, state.audit.length - audit.length),
      commandsDropped: Math.max(
        0,
        state.executionCommands.length - executionCommands.length,
      ),
      fillsDropped: Math.max(0, state.paperFills.length - paperFills.length),
      ordersDropped: Math.max(0, state.paperOrders.length - paperOrders.length),
      seenIdentitiesDropped: Math.max(0, seenBefore - seenAfter),
    },
  };
}

function envelopeFor(
  draft: PaperSessionDraft,
  revision: number,
  strict: boolean,
): PaperSessionV1 {
  const compacted = compactLiveEngineState(draft.engine, { strict });
  const priorRetention = draft.priorRetention
    ? validateRetention(draft.priorRetention)
    : {
        auditDropped: 0,
        commandsDropped: 0,
        fillsDropped: 0,
        ordersDropped: 0,
        seenIdentitiesDropped: 0,
      };
  return validateSession({
    schema: PAPER_SESSION_SCHEMA,
    version: PAPER_SESSION_VERSION,
    engineSchema: PAPER_SESSION_ENGINE_SCHEMA,
    integrity: "device-local-unsigned",
    sessionId: draft.sessionId,
    revision,
    writerId: draft.writerId,
    savedAtMs: draft.savedAtMs,
    scope: {
      mode: "live",
      network: draft.network,
      fixture: draft.fixture,
    },
    engine: compacted.engine,
    retention: {
      auditDropped:
        priorRetention.auditDropped + compacted.retention.auditDropped,
      commandsDropped:
        priorRetention.commandsDropped + compacted.retention.commandsDropped,
      fillsDropped:
        priorRetention.fillsDropped + compacted.retention.fillsDropped,
      ordersDropped:
        priorRetention.ordersDropped + compacted.retention.ordersDropped,
      seenIdentitiesDropped:
        priorRetention.seenIdentitiesDropped +
        compacted.retention.seenIdentitiesDropped,
    },
  });
}

function encodeDraft(draft: PaperSessionDraft, revision: number) {
  let session = envelopeFor(draft, revision, false);
  let json = JSON.stringify(session);
  let bytes = utf8Bytes(json);
  if (bytes > PAPER_SESSION_MAX_BYTES) {
    session = envelopeFor(draft, revision, true);
    json = JSON.stringify(session);
    bytes = utf8Bytes(json);
  }
  return { session, json, bytes };
}

export function decodePaperSession(raw: string): PaperSessionDecodeResult {
  const bytes = utf8Bytes(raw);
  if (bytes > PAPER_SESSION_MAX_BYTES) {
    return {
      status: "too-large",
      bytes,
      message: `Stored paper session is ${bytes} bytes; the maximum is ${PAPER_SESSION_MAX_BYTES}.`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: "invalid", message: "Stored paper session is not valid JSON." };
  }

  if (isRecord(parsed) && parsed.schema === PAPER_SESSION_SCHEMA) {
    const foundVersion = typeof parsed.version === "number" ? parsed.version : null;
    if (parsed.version !== PAPER_SESSION_VERSION) {
      return {
        status: "incompatible",
        foundVersion,
        message: `Stored paper-session version ${String(parsed.version)} is not supported.`,
      };
    }
  }

  try {
    return { status: "ready", session: validateSession(parsed), bytes };
  } catch (error) {
    return {
      status: "invalid",
      message:
        error instanceof SessionValidationError
          ? error.message
          : "Stored paper session failed validation.",
    };
  }
}

export function readPaperSession(
  storage: StorageLike,
  expectedNetwork?: TxlineNetwork,
): PaperSessionReadResult {
  let raw: string | null;
  try {
    raw = storage.getItem(PAPER_SESSION_STORAGE_KEY);
  } catch (error) {
    return { status: "unavailable", message: storageMessage(error, "be read") };
  }
  if (raw === null) return { status: "empty" };
  const decoded = decodePaperSession(raw);
  if (decoded.status !== "ready") return decoded;
  if (expectedNetwork && decoded.session.scope.network !== expectedNetwork) {
    return {
      status: "network-mismatch",
      session: decoded.session,
      bytes: decoded.bytes,
    };
  }
  return decoded;
}

export function writePaperSession(
  storage: StorageLike,
  draft: PaperSessionDraft,
  options: { expectedRevision?: number; replaceSession?: boolean } = {},
): PaperSessionWriteResult {
  let previousRaw: string | null;
  try {
    previousRaw = storage.getItem(PAPER_SESSION_STORAGE_KEY);
  } catch (error) {
    return { status: "unavailable", message: storageMessage(error, "be read before saving") };
  }

  let current: PaperSessionV1 | null = null;
  if (previousRaw !== null) {
    const decoded = decodePaperSession(previousRaw);
    if (decoded.status !== "ready") {
      return {
        status: "conflict",
        message: "Existing device storage is invalid or incompatible and was preserved.",
      };
    }
    current = decoded.session;
  }

  const currentRevision = current?.revision ?? 0;
  if (
    options.expectedRevision !== undefined &&
    options.expectedRevision !== currentRevision
  ) {
    return {
      status: "conflict",
      message: `Stored revision is ${currentRevision}; expected ${options.expectedRevision}.`,
    };
  }
  if (
    current &&
    current.sessionId !== draft.sessionId &&
    options.replaceSession !== true
  ) {
    return {
      status: "conflict",
      message: "A different paper session is already stored and was preserved.",
    };
  }
  if (
    current &&
    (current.scope.network !== draft.network ||
      current.scope.fixture.fixtureId !== draft.fixture.fixtureId) &&
    options.replaceSession !== true
  ) {
    return {
      status: "conflict",
      message: "The stored paper session belongs to a different network or fixture and was preserved.",
    };
  }

  let encoded: ReturnType<typeof encodeDraft>;
  try {
    encoded = encodeDraft(draft, currentRevision + 1);
  } catch (error) {
    return {
      status: "invalid",
      message:
        error instanceof SessionValidationError
          ? error.message
          : "Paper session could not be serialised safely.",
    };
  }
  if (encoded.bytes > PAPER_SESSION_MAX_BYTES) {
    return {
      status: "too-large",
      bytes: encoded.bytes,
      message: `Paper session remains ${encoded.bytes} bytes after safe compaction; the previous snapshot was preserved.`,
    };
  }

  try {
    storage.setItem(PAPER_SESSION_STORAGE_KEY, encoded.json);
  } catch (error) {
    // Web Storage setItem is atomic, but restoring explicitly also protects
    // tests and non-browser StorageLike implementations that are not.
    try {
      if (previousRaw === null) storage.removeItem(PAPER_SESSION_STORAGE_KEY);
      else storage.setItem(PAPER_SESSION_STORAGE_KEY, previousRaw);
    } catch {
      // The original error is the useful failure. A second storage failure is
      // deliberately not allowed to escape into the live paper engine.
    }
    return { status: "unavailable", message: storageMessage(error, "be saved") };
  }

  return {
    status: "saved",
    session: encoded.session,
    bytes: encoded.bytes,
  };
}

export function clearPaperSession(storage: StorageLike): PaperSessionClearResult {
  try {
    storage.removeItem(PAPER_SESSION_STORAGE_KEY);
    return { status: "cleared" };
  } catch (error) {
    return { status: "unavailable", message: storageMessage(error, "be cleared") };
  }
}

export function serialisePaperSession(session: PaperSessionV1) {
  const safe = validateSession(session);
  const json = JSON.stringify(safe, null, 2);
  const bytes = utf8Bytes(json);
  if (bytes > PAPER_SESSION_MAX_BYTES) {
    throw new RangeError(
      `Paper session export is ${bytes} bytes; the maximum is ${PAPER_SESSION_MAX_BYTES}.`,
    );
  }
  return json;
}
