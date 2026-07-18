export type LiveOutcome = "HOME" | "DRAW" | "AWAY";
export type LivePrices = Record<LiveOutcome, number>;
export type LiveTransportChannel = "ODDS" | "SCORES";
export type MaterialEventKind = "GOAL" | "RED_CARD";

export type LiveEngineStatus =
  | "BOOTSTRAPPING"
  | "QUOTING"
  | "SUSPENDED"
  | "STALE"
  | "CLOSED";

export type SuspensionCause =
  | "PRICE_SHOCK"
  | "MATERIAL_EVENT"
  | "TRANSPORT_TIMEOUT"
  | "PRICE_STALE"
  | "MARKET_NOT_IN_RUNNING"
  | "MAXIMUM_LIABILITY"
  | "EMERGENCY_STOP"
  | "SESSION_ENDED";

export interface LivePolicy {
  shockWindowMs: number;
  shockDelta: number;
  transportTimeoutMs: number;
  maximumPriceSilenceMs: number;
  maximumPriceSourceAgeMs: number;
  maximumFutureClockSkewMs: number;
  minimumSuspendMs: number;
  stableObservationsRequired: number;
  stableObservationDelta: number;
  baseHalfSpread: number;
  baseQuantity: number;
  /** Maximum worst-case paper loss across the mutually exclusive outcomes. */
  maximumLiability: number;
  priceTick: number;
  requoteDelta: number;
  minimumRequoteIntervalMs: number;
  requiredTransportChannels: readonly LiveTransportChannel[];
}

const defaultRequiredTransportChannels: readonly LiveTransportChannel[] = Object.freeze([
  "ODDS",
  "SCORES",
]);

export const defaultLivePolicy: Readonly<LivePolicy> = Object.freeze({
  shockWindowMs: 2_000,
  shockDelta: 0.04,
  // TxLINE sends heartbeats even when the price itself does not change. Transport
  // health must therefore be measured from stream traffic, not from price age.
  transportTimeoutMs: 20_000,
  maximumPriceSilenceMs: 120_000,
  // The World Cup free tier may be delayed, so source age and transport age use
  // deliberately different limits.
  maximumPriceSourceAgeMs: 120_000,
  maximumFutureClockSkewMs: 5_000,
  minimumSuspendMs: 3_000,
  stableObservationsRequired: 3,
  stableObservationDelta: 0.0075,
  baseHalfSpread: 0.012,
  baseQuantity: 250,
  maximumLiability: 1_000,
  priceTick: 0.0001,
  // Normal price movement should update the working paper book without being
  // confused with a circuit-breaker event. The threshold is cumulative from
  // the fair value used for the current quote epoch.
  requoteDelta: 0.005,
  minimumRequoteIntervalMs: 1_000,
  requiredTransportChannels: defaultRequiredTransportChannels,
});

interface TimedEvent {
  atMs: number;
  clock: string;
}

export interface LiveHeartbeatEvent extends TimedEvent {
  kind: "HEARTBEAT";
  channel: LiveTransportChannel;
  fixtureId?: string;
  sseId?: string;
}

export interface LiveOddsEvent extends TimedEvent {
  kind: "ODDS";
  fixtureId: string;
  messageId: string;
  sseId?: string;
  priceTsMs: number;
  pct: LivePrices;
  /** Missing lifecycle data is deliberately treated as not in-running. */
  inRunning?: boolean;
  gameState?: string | null;
}

export interface LiveScoreEvent extends TimedEvent {
  kind: "SCORE";
  fixtureId: string;
  seq: number;
  scoreTsMs: number;
  score: { home: number | null; away: number | null };
  redCards: { home: number | null; away: number | null };
  action?: string;
  /** `false` is an explicit provisional signal; null/undefined is unknown. */
  confirmed?: boolean | null;
  finalised?: boolean;
}

export interface LiveMaterialSignalEvent extends TimedEvent {
  kind: "MATERIAL_SIGNAL";
  fixtureId: string;
  signalId: string;
  material: MaterialEventKind;
}

export interface LiveTimerEvent extends TimedEvent {
  kind: "TIMER";
}

export interface LiveSessionEndEvent extends TimedEvent {
  kind: "SESSION_END";
  fixtureId: string;
  reason?: string;
}

/**
 * A credential-independent fill request. Price is deliberately omitted: the
 * engine always uses the working order price, so a caller cannot forge P&L.
 */
export interface LivePaperFillEvent extends TimedEvent {
  kind: "PAPER_FILL";
  fixtureId: string;
  fillId: string;
  orderId: string;
  quantity: number;
}

export interface LiveEmergencyStopEvent extends TimedEvent {
  kind: "EMERGENCY_STOP";
  fixtureId: string;
  stopId: string;
  reason?: string;
}

export type LiveEngineEvent =
  | LiveHeartbeatEvent
  | LiveOddsEvent
  | LiveScoreEvent
  | LiveMaterialSignalEvent
  | LivePaperFillEvent
  | LiveEmergencyStopEvent
  | LiveTimerEvent
  | LiveSessionEndEvent;

export interface LivePaperOrder {
  id: string;
  fixtureId: string;
  epoch: number;
  outcome: LiveOutcome;
  side: "BID" | "ASK";
  price: number;
  quantity: number;
  state: "OPEN" | "CANCELLED" | "CLOSED";
  createdAtMs: number;
  cancelledAtMs: number | null;
}

export interface LiveExecutionCommand {
  id: string;
  kind: "PLACE_QUOTES" | "CANCEL_ALL";
  atMs: number;
  orderIds: string[];
}

export type LivePaperInventory = Record<LiveOutcome, number>;

export interface LivePaperFill {
  id: string;
  fixtureId: string;
  orderId: string;
  atMs: number;
  outcome: LiveOutcome;
  side: "BID" | "ASK";
  price: number;
  quantity: number;
  notional: number;
  cashDelta: number;
  inventoryDelta: number;
}

export interface LiveEmergencyStop {
  stopId: string;
  engagedAtMs: number;
  reason: string;
}

export interface LivePaperRisk {
  cash: number;
  inventory: LivePaperInventory;
  outcomePnl: LivePaperInventory;
  markToMarketPnl: number | null;
  worstCasePnl: number;
  bestCasePnl: number;
  liability: number;
  maximumLiability: number;
  remainingLiability: number;
  filledNotional: number;
  settledOutcome: LiveOutcome | null;
  settledPnl: number | null;
}

export interface LiveAuditEntry {
  id: string;
  atMs: number;
  clock: string;
  /** FEED is source-neutral; TXLINE remains accepted for legacy stored sessions. */
  source: "FEED" | "TXLINE" | "AGENT" | "EXECUTION";
  tone: "neutral" | "healthy" | "warning" | "danger";
  title: string;
  detail: string;
}

interface PriceFrame {
  priceTsMs: number;
  fair: LivePrices;
}

interface PendingMaterialSignal {
  signalId: string;
  material: MaterialEventKind;
  receivedAtMs: number;
}

export interface LiveEngineState {
  fixtureId: string;
  policy: LivePolicy;
  status: LiveEngineStatus;
  reason: string;
  nowMs: number;
  matchClock: string;
  score: { home: number; away: number };
  redCards: { home: number; away: number };
  scoreKnown: { home: boolean; away: boolean };
  redCardsKnown: { home: boolean; away: boolean };
  scoreInitialised: boolean;
  lastScoreSeq: number | null;
  fair: LivePrices | null;
  quotedFair: LivePrices | null;
  marketInRunning: boolean;
  marketGameState: string | null;
  lastPriceTsMs: number | null;
  lastOddsReceivedAtMs: number | null;
  lastQuoteAtMs: number | null;
  lastTransportAtMs: Record<LiveTransportChannel, number | null>;
  lastHeartbeatAtMs: Record<LiveTransportChannel, number | null>;
  priceHistory: PriceFrame[];
  lastMovement: number;
  stableObservations: number;
  lastStableFair: LivePrices | null;
  holdUntilMs: number | null;
  scoreConfirmationRequired: boolean;
  pendingMaterialSignal: PendingMaterialSignal | null;
  suspensionCauses: SuspensionCause[];
  quoteEpoch: number;
  paperOrders: LivePaperOrder[];
  cancelledOrders: number;
  executionCommands: LiveExecutionCommand[];
  paperFills: LivePaperFill[];
  paperCash: number;
  paperInventory: LivePaperInventory;
  paperFilledNotional: number;
  paperFillRejects: number;
  settledOutcome: LiveOutcome | null;
  settledPnl: number | null;
  emergencyStop: LiveEmergencyStop | null;
  seenOddsMessageIds: string[];
  seenOddsSseIds: string[];
  seenScoreKeys: string[];
  seenMaterialSignalIds: string[];
  seenPaperFillIds: string[];
  rejectedEvents: number;
  auditSequence: number;
  audit: LiveAuditEntry[];
  auditTruncated: number;
}

export interface LiveQuoteRow {
  outcome: LiveOutcome;
  fair: number | null;
  bid: number | null;
  ask: number | null;
  quantity: number;
  state: "WAITING" | "OPEN" | "PROTECTED" | "CLOSED";
}

export interface LiveEngineHealth {
  transportHealthy: boolean;
  timedOutChannels: LiveTransportChannel[];
  transportAgeMs: Record<LiveTransportChannel, number | null>;
  priceSourceAgeMs: number | null;
  priceSilenceMs: number | null;
  priceFresh: boolean;
}

const outcomes: readonly LiveOutcome[] = ["HOME", "DRAW", "AWAY"];
const channels: readonly LiveTransportChannel[] = ["ODDS", "SCORES"];
const liveEngineEventKinds = new Set([
  "HEARTBEAT",
  "ODDS",
  "SCORE",
  "MATERIAL_SIGNAL",
  "PAPER_FILL",
  "EMERGENCY_STOP",
  "TIMER",
  "SESSION_END",
]);

function clonePrices(prices: LivePrices): LivePrices {
  return { HOME: prices.HOME, DRAW: prices.DRAW, AWAY: prices.AWAY };
}

export function normaliseLivePolicy(
  overrides: Partial<LivePolicy> | undefined,
): LivePolicy {
  const merged = {
    ...defaultLivePolicy,
    ...overrides,
    requiredTransportChannels: [
      ...(overrides?.requiredTransportChannels ??
        defaultLivePolicy.requiredTransportChannels),
    ],
  };

  const positiveFields: Array<keyof LivePolicy> = [
    "shockWindowMs",
    "shockDelta",
    "transportTimeoutMs",
    "maximumPriceSilenceMs",
    "maximumPriceSourceAgeMs",
    "maximumFutureClockSkewMs",
    "minimumSuspendMs",
    "stableObservationsRequired",
    "stableObservationDelta",
    "baseHalfSpread",
    "baseQuantity",
    "maximumLiability",
    "priceTick",
    "requoteDelta",
    "minimumRequoteIntervalMs",
  ];
  for (const field of positiveFields) {
    const value = merged[field];
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      value < 0 ||
      value > Number.MAX_SAFE_INTEGER
    ) {
      throw new RangeError(
        `Live policy ${field} must be a finite non-negative safe number`,
      );
    }
  }
  const probabilityFields: Array<keyof LivePolicy> = [
    "shockDelta",
    "stableObservationDelta",
    "baseHalfSpread",
    "priceTick",
    "requoteDelta",
  ];
  if (probabilityFields.some((field) => (merged[field] as number) > 1)) {
    throw new RangeError("Probability-based live policy values cannot exceed one");
  }
  if (merged.priceTick <= 0) {
    throw new RangeError("Live policy priceTick must be greater than zero");
  }
  if (!Number.isInteger(merged.stableObservationsRequired) || merged.stableObservationsRequired < 1) {
    throw new RangeError("stableObservationsRequired must be a positive integer");
  }
  if (
    merged.requiredTransportChannels.length === 0 ||
    merged.requiredTransportChannels.some((channel) => !channels.includes(channel)) ||
    new Set(merged.requiredTransportChannels).size !==
      merged.requiredTransportChannels.length
  ) {
    throw new RangeError(
      "requiredTransportChannels must contain unique known stream channels",
    );
  }

  return merged;
}

export function createLiveEngineState(options: {
  fixtureId: string;
  policy?: Partial<LivePolicy>;
}): LiveEngineState {
  if (!options.fixtureId.trim()) throw new RangeError("fixtureId is required");
  return {
    fixtureId: options.fixtureId,
    policy: normaliseLivePolicy(options.policy),
    status: "BOOTSTRAPPING",
    reason: "Waiting for a score baseline and StablePrice",
    nowMs: 0,
    matchClock: "—",
    score: { home: 0, away: 0 },
    redCards: { home: 0, away: 0 },
    scoreKnown: { home: false, away: false },
    redCardsKnown: { home: false, away: false },
    scoreInitialised: false,
    lastScoreSeq: null,
    fair: null,
    quotedFair: null,
    marketInRunning: false,
    marketGameState: null,
    lastPriceTsMs: null,
    lastOddsReceivedAtMs: null,
    lastQuoteAtMs: null,
    lastTransportAtMs: { ODDS: null, SCORES: null },
    lastHeartbeatAtMs: { ODDS: null, SCORES: null },
    priceHistory: [],
    lastMovement: 0,
    stableObservations: 0,
    lastStableFair: null,
    holdUntilMs: null,
    scoreConfirmationRequired: false,
    pendingMaterialSignal: null,
    suspensionCauses: [],
    quoteEpoch: 0,
    paperOrders: [],
    cancelledOrders: 0,
    executionCommands: [],
    paperFills: [],
    paperCash: 0,
    paperInventory: { HOME: 0, DRAW: 0, AWAY: 0 },
    paperFilledNotional: 0,
    paperFillRejects: 0,
    settledOutcome: null,
    settledPnl: null,
    emergencyStop: null,
    seenOddsMessageIds: [],
    seenOddsSseIds: [],
    seenScoreKeys: [],
    seenMaterialSignalIds: [],
    seenPaperFillIds: [],
    rejectedEvents: 0,
    auditSequence: 0,
    audit: [],
    auditTruncated: 0,
  };
}

function maxMovement(previous: LivePrices, next: LivePrices) {
  const movement = Math.max(
    ...outcomes.map((outcome) => Math.abs(next[outcome] - previous[outcome])),
  );
  // StablePrice values arrive at fixed decimal precision. Removing binary
  // floating-point residue keeps the inclusive 4pp boundary deterministic.
  return Math.round(movement * 1e12) / 1e12;
}

function precise(value: number) {
  return Math.round(value * 1e10) / 1e10;
}

function riskForLedger(
  state: Pick<
    LiveEngineState,
    | "fair"
    | "paperCash"
    | "paperInventory"
    | "paperFilledNotional"
    | "policy"
    | "settledOutcome"
    | "settledPnl"
  >,
): LivePaperRisk {
  const outcomePnl = Object.fromEntries(
    outcomes.map((outcome) => [
      outcome,
      precise(state.paperCash + state.paperInventory[outcome]),
    ]),
  ) as LivePaperInventory;
  const scenarios = outcomes.map((outcome) => outcomePnl[outcome]);
  const worstCasePnl = Math.min(...scenarios);
  const bestCasePnl = Math.max(...scenarios);
  const liability = precise(Math.max(0, -worstCasePnl));
  const markToMarketPnl = state.fair
    ? precise(
        state.paperCash +
          outcomes.reduce(
            (value, outcome) =>
              value + state.paperInventory[outcome] * state.fair![outcome],
            0,
          ),
      )
    : null;
  return {
    cash: state.paperCash,
    inventory: { ...state.paperInventory },
    outcomePnl,
    markToMarketPnl,
    worstCasePnl,
    bestCasePnl,
    liability,
    maximumLiability: state.policy.maximumLiability,
    remainingLiability: precise(
      Math.max(0, state.policy.maximumLiability - liability),
    ),
    filledNotional: state.paperFilledNotional,
    settledOutcome: state.settledOutcome,
    settledPnl: state.settledPnl,
  };
}

export function selectLivePaperRisk(state: LiveEngineState): LivePaperRisk {
  return riskForLedger(state);
}

export function remainingLivePaperOrderQuantity(
  state: LiveEngineState,
  orderId: string,
) {
  const order = state.paperOrders.find((candidate) => candidate.id === orderId);
  if (!order) return 0;
  const filled = state.paperFills
    .filter((fill) => fill.orderId === orderId)
    .reduce((quantity, fill) => quantity + fill.quantity, 0);
  return precise(Math.max(0, order.quantity - filled));
}

/**
 * Build a repeatable local fill from the current quote book. The caller chooses
 * the outcome and side; the price and quantity are derived from engine state.
 */
export function createDeterministicPaperFillEvent(
  state: LiveEngineState,
  options: {
    fillId: string;
    atMs: number;
    clock: string;
    outcome: LiveOutcome;
    side: "BID" | "ASK";
    fraction?: number;
  },
): LivePaperFillEvent {
  const fraction = options.fraction ?? 0.25;
  if (!Number.isFinite(fraction) || fraction <= 0 || fraction > 1) {
    throw new RangeError("Paper fill fraction must be greater than zero and no more than one");
  }
  const order = activeLivePaperOrders(state).find(
    (candidate) =>
      candidate.outcome === options.outcome && candidate.side === options.side,
  );
  if (!order) {
    throw new RangeError(
      `No open ${options.outcome} ${options.side} paper order is available`,
    );
  }
  const remaining = remainingLivePaperOrderQuantity(state, order.id);
  const quantity = precise(Math.min(remaining, order.quantity * fraction));
  if (quantity <= 0) {
    throw new RangeError(`Paper order ${order.id} has no remaining quantity`);
  }
  return {
    kind: "PAPER_FILL",
    fixtureId: state.fixtureId,
    fillId: options.fillId,
    orderId: order.id,
    quantity,
    atMs: options.atMs,
    clock: options.clock,
  };
}

export function normaliseLivePrices(prices: LivePrices): LivePrices {
  const values = outcomes.map((outcome) => prices[outcome]);
  if (values.some((value) => !Number.isFinite(value) || value < 0 || value > 1)) {
    throw new RangeError("StablePrice probabilities must be finite values between zero and one");
  }
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total < 0.995 || total > 1.005) {
    throw new RangeError("StablePrice probabilities must already be normalised");
  }
  return {
    HOME: prices.HOME / total,
    DRAW: prices.DRAW / total,
    AWAY: prices.AWAY / total,
  };
}

function roundToTick(value: number, tick: number) {
  return Math.round(value / tick) * tick;
}

function ordersFor(
  state: LiveEngineState,
  fair: LivePrices,
  epoch: number,
  atMs: number,
): LivePaperOrder[] {
  return outcomes.flatMap((outcome) => {
    const midpoint = Math.min(0.98, Math.max(0.02, fair[outcome]));
    const bid = Math.min(
      1,
      Math.max(
        0,
        roundToTick(
          Math.max(0, midpoint - state.policy.baseHalfSpread),
          state.policy.priceTick,
        ),
      ),
    );
    const ask = Math.min(
      1,
      Math.max(
        0,
        roundToTick(
          Math.min(1, midpoint + state.policy.baseHalfSpread),
          state.policy.priceTick,
        ),
      ),
    );
    return ([
      { side: "BID" as const, price: bid },
      { side: "ASK" as const, price: ask },
    ]).map(({ side, price }) => ({
      id: `${state.fixtureId}:${epoch}:${outcome}:${side}`,
      fixtureId: state.fixtureId,
      epoch,
      outcome,
      side,
      price,
      quantity: state.policy.baseQuantity,
      state: "OPEN" as const,
      createdAtMs: atMs,
      cancelledAtMs: null,
    }));
  });
}

function appendAudit(
  state: LiveEngineState,
  event: TimedEvent,
  entry: Omit<LiveAuditEntry, "id" | "atMs" | "clock">,
): LiveEngineState {
  const auditSequence = state.auditSequence + 1;
  const audit: LiveAuditEntry = {
    id: `live-audit-${auditSequence}`,
    atMs: event.atMs,
    clock: event.clock,
    ...entry,
  };
  const retainedAudit = [audit, ...state.audit].slice(0, 100);
  const discarded = state.audit.length + 1 - retainedAudit.length;
  return {
    ...state,
    auditSequence,
    audit: retainedAudit,
    auditTruncated: state.auditTruncated + Math.max(0, discarded),
  };
}

function addCause(causes: SuspensionCause[], cause: SuspensionCause) {
  return causes.includes(cause) ? causes : [...causes, cause];
}

function openQuotes(
  state: LiveEngineState,
  event: TimedEvent,
  reason: string,
): LiveEngineState {
  if (!state.fair) return state;
  const epoch = state.quoteEpoch + 1;
  const orders = ordersFor(state, state.fair, epoch, event.atMs);
  const next = {
    ...state,
    status: "QUOTING" as const,
    reason,
    quotedFair: clonePrices(state.fair),
    lastQuoteAtMs: event.atMs,
    quoteEpoch: epoch,
    paperOrders: [...state.paperOrders, ...orders],
    executionCommands: [
      ...state.executionCommands,
      {
        id: `${state.fixtureId}:place:${epoch}`,
        kind: "PLACE_QUOTES" as const,
        atMs: event.atMs,
        orderIds: orders.map((order) => order.id),
      },
    ],
    suspensionCauses: [],
    holdUntilMs: null,
    stableObservations: 0,
    lastStableFair: null,
    scoreConfirmationRequired: false,
    pendingMaterialSignal: null,
  };
  return appendAudit(next, event, {
    source: "EXECUTION",
    tone: "healthy",
    title: epoch === 1 ? "Paper market opened" : "Paper market reopened",
    detail: `Quote epoch ${epoch} placed six deterministic paper orders from StablePrice.`,
  });
}

function cancelOpenOrders(state: LiveEngineState, event: TimedEvent) {
  const openIds = state.paperOrders
    .filter((order) => order.state === "OPEN")
    .map((order) => order.id);
  if (openIds.length === 0) return state;
  const commandId = `${state.fixtureId}:cancel:${state.quoteEpoch}`;
  return {
    ...state,
    paperOrders: state.paperOrders.map((order) =>
      order.state === "OPEN"
        ? { ...order, state: "CANCELLED" as const, cancelledAtMs: event.atMs }
        : order,
    ),
    cancelledOrders: state.cancelledOrders + openIds.length,
    executionCommands: state.executionCommands.some((command) => command.id === commandId)
      ? state.executionCommands
      : [
          ...state.executionCommands,
          {
            id: commandId,
            kind: "CANCEL_ALL" as const,
            atMs: event.atMs,
            orderIds: openIds,
          },
        ],
  };
}

function quoteMovement(state: LiveEngineState) {
  return state.fair && state.quotedFair
    ? maxMovement(state.quotedFair, state.fair)
    : 0;
}

function shouldRequote(state: LiveEngineState) {
  return (
    state.status === "QUOTING" &&
    state.emergencyStop === null &&
    !state.suspensionCauses.includes("MAXIMUM_LIABILITY") &&
    state.marketInRunning &&
    state.lastQuoteAtMs !== null &&
    quoteMovement(state) >= state.policy.requoteDelta &&
    state.nowMs - state.lastQuoteAtMs >= state.policy.minimumRequoteIntervalMs
  );
}

function replaceQuotes(
  state: LiveEngineState,
  event: TimedEvent,
): LiveEngineState {
  const movement = quoteMovement(state);
  const cancelled = cancelOpenOrders(state, event);
  return openQuotes(
    cancelled,
    event,
    `Paper quotes refreshed after a cumulative StablePrice move of ${(movement * 100).toFixed(2)}pp`,
  );
}

function suspend(
  state: LiveEngineState,
  event: TimedEvent,
  options: {
    cause: SuspensionCause;
    reason: string;
    title: string;
    detail: string;
    requireScoreConfirmation?: boolean;
    resetHold?: boolean;
  },
) {
  const cancelledBefore = state.cancelledOrders;
  const cancelled = cancelOpenOrders(state, event);
  const resetHold = options.resetHold ?? true;
  const holdUntilMs = resetHold
    ? Math.max(cancelled.holdUntilMs ?? 0, event.atMs + state.policy.minimumSuspendMs)
    : cancelled.holdUntilMs;
  const next: LiveEngineState = {
    ...cancelled,
    status: options.cause === "TRANSPORT_TIMEOUT" || options.cause === "PRICE_STALE"
      ? "STALE"
      : "SUSPENDED",
    reason: options.reason,
    suspensionCauses: addCause(cancelled.suspensionCauses, options.cause),
    holdUntilMs,
    stableObservations: resetHold ? 0 : cancelled.stableObservations,
    lastStableFair: resetHold ? null : cancelled.lastStableFair,
    scoreConfirmationRequired:
      cancelled.scoreConfirmationRequired || Boolean(options.requireScoreConfirmation),
  };
  const newlyCancelled = next.cancelledOrders - cancelledBefore;
  return appendAudit(next, event, {
    source: "AGENT",
    tone: "danger",
    title: options.title,
    detail:
      newlyCancelled > 0
        ? `${options.detail} CANCEL_ALL withdrew ${newlyCancelled} paper orders.`
        : `${options.detail} The market was already protected; no duplicate cancellation was emitted.`,
  });
}

function processPaperFill(
  state: LiveEngineState,
  event: LivePaperFillEvent,
): LiveEngineState {
  const fillId = event.fillId.trim();
  const seenPaperFillIds = fillId
    ? [...state.seenPaperFillIds, fillId].slice(-1_000)
    : state.seenPaperFillIds;
  const reject = (title: string, detail: string) =>
    appendAudit(
      {
        ...state,
        seenPaperFillIds,
        paperFillRejects: state.paperFillRejects + 1,
      },
      event,
      { source: "EXECUTION", tone: "warning", title, detail },
    );

  if (!fillId || fillId.length > 256) {
    return reject(
      "Paper fill rejected",
      "A non-empty fill identifier no longer than 256 characters is required.",
    );
  }
  if (!Number.isFinite(event.quantity) || event.quantity <= 0) {
    return reject(
      "Paper fill rejected",
      "Fill quantity must be a finite value greater than zero.",
    );
  }
  if (state.status !== "QUOTING" || state.emergencyStop !== null) {
    return reject(
      "Paper fill rejected",
      "The candidate fill arrived while the paper market was protected.",
    );
  }

  const order = state.paperOrders.find((candidate) => candidate.id === event.orderId);
  if (!order || order.state !== "OPEN") {
    return reject(
      "Paper fill rejected",
      `Order ${event.orderId || "unknown"} is not an open paper order.`,
    );
  }
  const remaining = remainingLivePaperOrderQuantity(state, order.id);
  if (event.quantity > remaining + 1e-10) {
    return reject(
      "Paper fill rejected",
      `Quantity ${event.quantity} exceeds the order's remaining quantity ${remaining}.`,
    );
  }

  const quantity = precise(event.quantity);
  const notional = precise(order.price * quantity);
  const direction = order.side === "BID" ? 1 : -1;
  const cashDelta = precise(-direction * notional);
  const inventoryDelta = precise(direction * quantity);
  const projected: LiveEngineState = {
    ...state,
    seenPaperFillIds,
    paperCash: precise(state.paperCash + cashDelta),
    paperInventory: {
      ...state.paperInventory,
      [order.outcome]: precise(
        state.paperInventory[order.outcome] + inventoryDelta,
      ),
    },
    paperFilledNotional: precise(state.paperFilledNotional + notional),
  };
  const projectedRisk = selectLivePaperRisk(projected);
  if (projectedRisk.liability > state.policy.maximumLiability + 1e-10) {
    const guarded: LiveEngineState = {
      ...state,
      seenPaperFillIds,
      paperFillRejects: state.paperFillRejects + 1,
    };
    return suspend(guarded, event, {
      cause: "MAXIMUM_LIABILITY",
      reason: `Candidate fill would exceed the ${state.policy.maximumLiability} maximum paper liability`,
      title: "Maximum liability guard fired",
      detail: `Fill ${fillId} was blocked before execution because projected worst-case liability was ${projectedRisk.liability}.`,
    });
  }

  const fill: LivePaperFill = {
    id: fillId,
    fixtureId: state.fixtureId,
    orderId: order.id,
    atMs: event.atMs,
    outcome: order.outcome,
    side: order.side,
    price: order.price,
    quantity,
    notional,
    cashDelta,
    inventoryDelta,
  };
  const fullyFilled = quantity >= remaining - 1e-10;
  const accepted: LiveEngineState = {
    ...projected,
    paperOrders: projected.paperOrders.map((candidate) =>
      candidate.id === order.id && fullyFilled
        ? { ...candidate, state: "CLOSED" as const }
        : candidate,
    ),
    paperFills: [...state.paperFills, fill],
  };
  return appendAudit(accepted, event, {
    source: "EXECUTION",
    tone: "healthy",
    title: "Deterministic paper fill recorded",
    detail: `${fill.side} ${fill.quantity} ${fill.outcome} at ${fill.price}; worst-case liability is ${projectedRisk.liability}/${state.policy.maximumLiability}.`,
  });
}

function processEmergencyStop(
  state: LiveEngineState,
  event: LiveEmergencyStopEvent,
): LiveEngineState {
  const stopId = event.stopId.trim();
  const reason = event.reason?.trim() || "Operator emergency stop";
  if (!stopId || stopId.length > 256 || reason.length > 2_000) {
    return appendAudit(state, event, {
      source: "EXECUTION",
      tone: "warning",
      title: "Emergency stop request rejected",
      detail: "The stop identifier or reason did not satisfy the bounded evidence contract.",
    });
  }
  return suspend(
    {
      ...state,
      emergencyStop: { stopId, engagedAtMs: event.atMs, reason },
    },
    event,
    {
      cause: "EMERGENCY_STOP",
      reason: `Emergency stop: ${reason}`,
      title: "Emergency stop engaged",
      detail: `Stop ${stopId} latched the paper market until a new session is created.`,
    },
  );
}

function updateTransport(
  state: LiveEngineState,
  channel: LiveTransportChannel,
  atMs: number,
  heartbeat = false,
) {
  return {
    ...state,
    lastTransportAtMs: { ...state.lastTransportAtMs, [channel]: atMs },
    lastHeartbeatAtMs: heartbeat
      ? { ...state.lastHeartbeatAtMs, [channel]: atMs }
      : state.lastHeartbeatAtMs,
  };
}

export function selectLiveEngineHealth(state: LiveEngineState): LiveEngineHealth {
  const transportAgeMs = Object.fromEntries(
    channels.map((channel) => [
      channel,
      state.lastTransportAtMs[channel] === null
        ? null
        : Math.max(0, state.nowMs - state.lastTransportAtMs[channel]!),
    ]),
  ) as Record<LiveTransportChannel, number | null>;
  const timedOutChannels = state.policy.requiredTransportChannels.filter((channel) => {
    const age = transportAgeMs[channel];
    return age === null || age > state.policy.transportTimeoutMs;
  });
  const priceSourceAgeMs = state.lastPriceTsMs === null
    ? null
    : Math.max(0, state.nowMs - state.lastPriceTsMs);
  const priceSilenceMs = state.lastOddsReceivedAtMs === null
    ? null
    : Math.max(0, state.nowMs - state.lastOddsReceivedAtMs);
  return {
    transportHealthy: timedOutChannels.length === 0,
    timedOutChannels: [...timedOutChannels],
    transportAgeMs,
    priceSourceAgeMs,
    priceSilenceMs,
    priceFresh:
      priceSourceAgeMs !== null &&
      priceSourceAgeMs <= state.policy.maximumPriceSourceAgeMs &&
      priceSilenceMs !== null &&
      priceSilenceMs <= state.policy.maximumPriceSilenceMs,
  };
}

function canOpenInitialQuotes(state: LiveEngineState) {
  const health = selectLiveEngineHealth(state);
  return (
    state.emergencyStop === null &&
    !state.suspensionCauses.includes("MAXIMUM_LIABILITY") &&
    state.scoreInitialised &&
    state.marketInRunning &&
    state.fair !== null &&
    health.transportHealthy &&
    health.priceFresh
  );
}

function canReopen(state: LiveEngineState) {
  const health = selectLiveEngineHealth(state);
  return (
    state.emergencyStop === null &&
    !state.suspensionCauses.includes("MAXIMUM_LIABILITY") &&
    state.fair !== null &&
    state.marketInRunning &&
    state.stableObservations >= state.policy.stableObservationsRequired &&
    (state.holdUntilMs === null || state.nowMs >= state.holdUntilMs) &&
    !state.scoreConfirmationRequired &&
    health.transportHealthy &&
    health.priceFresh
  );
}

function processRecoveryObservation(
  state: LiveEngineState,
  event: LiveOddsEvent,
  fair: LivePrices,
) {
  const delta = state.lastStableFair ? maxMovement(state.lastStableFair, fair) : 0;
  const stable = state.lastStableFair === null || delta <= state.policy.stableObservationDelta;
  const stableObservations = stable ? state.stableObservations + 1 : 1;
  const next: LiveEngineState = {
    ...state,
    stableObservations,
    lastStableFair: clonePrices(fair),
    status: state.status === "STALE" ? "STALE" : "SUSPENDED",
    reason: stable
      ? `StablePrice recovery observation ${stableObservations}/${state.policy.stableObservationsRequired}`
      : "StablePrice recovery count reset after renewed movement",
  };

  if (canReopen(next)) {
    return openQuotes(next, event, "Fresh transport, hold and StablePrice recovery checks passed");
  }

  return appendAudit(next, event, {
    source: "AGENT",
    tone: "warning",
    title: stable ? "Recovery observation accepted" : "Recovery stability reset",
    detail: next.scoreConfirmationRequired
      ? `${stableObservations}/${state.policy.stableObservationsRequired} stable observations; score confirmation is still required.`
      : `${stableObservations}/${state.policy.stableObservationsRequired} stable observations; minimum hold and transport guards remain active.`,
  });
}

function oddsIdentity(event: LiveOddsEvent, kind: "message" | "sse") {
  const id = kind === "message" ? event.messageId : event.sseId;
  return id ? `${event.fixtureId}:${id}` : null;
}

function rejectEvent(
  state: LiveEngineState,
  event: TimedEvent,
  title: string,
  detail: string,
): LiveEngineState {
  return appendAudit(
    { ...state, rejectedEvents: state.rejectedEvents + 1 },
    event,
    { source: "FEED", tone: "warning", title, detail },
  );
}

function processOdds(state: LiveEngineState, event: LiveOddsEvent): LiveEngineState {
  let received = updateTransport(state, "ODDS", event.atMs);
  const messageKey = oddsIdentity(event, "message")!;
  const sseKey = oddsIdentity(event, "sse");
  const duplicate =
    received.seenOddsMessageIds.includes(messageKey) ||
    (sseKey !== null && received.seenOddsSseIds.includes(sseKey));
  if (duplicate) {
    return rejectEvent(
      received,
      event,
      "Duplicate odds ignored",
      "The feed MessageId or SSE id was already processed; transport freshness was retained.",
    );
  }

  received = {
    ...received,
    seenOddsMessageIds: [...received.seenOddsMessageIds, messageKey].slice(-1_000),
    seenOddsSseIds: sseKey
      ? [...received.seenOddsSseIds, sseKey].slice(-1_000)
      : received.seenOddsSseIds,
  };

  if (!event.messageId.trim()) {
    return rejectEvent(received, event, "Odds quarantined", "A feed MessageId is required.");
  }
  if (!Number.isFinite(event.priceTsMs)) {
    return rejectEvent(received, event, "Odds quarantined", "The source price timestamp is invalid.");
  }
  if (event.priceTsMs > event.atMs + state.policy.maximumFutureClockSkewMs) {
    return rejectEvent(received, event, "Odds quarantined", "The source price timestamp is too far in the future.");
  }
  if (received.lastPriceTsMs !== null && event.priceTsMs < received.lastPriceTsMs) {
    return rejectEvent(received, event, "Odds quarantined", "The source price timestamp regressed.");
  }

  let fair: LivePrices;
  try {
    fair = normaliseLivePrices(event.pct);
  } catch (error) {
    return rejectEvent(
      received,
      event,
      "Odds quarantined",
      error instanceof Error ? error.message : "StablePrice probabilities were invalid.",
    );
  }

  const priceHistory = [
    ...received.priceHistory,
    { priceTsMs: event.priceTsMs, fair: clonePrices(fair) },
  ].filter(
    (frame) =>
      frame.priceTsMs <= event.priceTsMs &&
      event.priceTsMs - frame.priceTsMs <= state.policy.shockWindowMs,
  );
  const movement = priceHistory.length > 1
    ? maxMovement(priceHistory[0].fair, fair)
    : 0;
  const next: LiveEngineState = {
    ...received,
    fair,
    marketInRunning: event.inRunning === true,
    marketGameState: event.gameState ?? null,
    lastPriceTsMs: event.priceTsMs,
    lastOddsReceivedAtMs: event.atMs,
    priceHistory,
    lastMovement: movement,
  };

  if (!next.marketInRunning) {
    if (received.status === "QUOTING") {
      return suspend(next, event, {
        cause: "MARKET_NOT_IN_RUNNING",
        reason: "The feed reports that the selected market is not in-running",
        title: "In-running lifecycle guard",
        detail: `Game state ${event.gameState ?? "unknown"} is not authorised for in-play paper quoting.`,
      });
    }
    return appendAudit(next, event, {
      source: "FEED",
      tone: "warning",
      title: "Market is not in-running",
      detail: `StablePrice was retained for observation, but game state ${event.gameState ?? "unknown"} cannot open paper quotes.`,
    });
  }

  const sourceAgeMs = Math.max(0, event.atMs - event.priceTsMs);
  if (sourceAgeMs > received.policy.maximumPriceSourceAgeMs) {
    if (received.status === "QUOTING") {
      return suspend(next, event, {
        cause: "PRICE_STALE",
        reason: `StablePrice source timestamp is ${sourceAgeMs}ms old`,
        title: "StablePrice source-age guard",
        detail: `Source age exceeded ${received.policy.maximumPriceSourceAgeMs}ms even though transport traffic may still be fresh.`,
      });
    }
    return appendAudit(next, event, {
      source: "AGENT",
      tone: "warning",
      title: "Stale StablePrice retained without quoting",
      detail: `Source age ${sourceAgeMs}ms exceeds the ${received.policy.maximumPriceSourceAgeMs}ms policy limit.`,
    });
  }

  if (received.status === "QUOTING" && movement >= received.policy.shockDelta) {
    return suspend(next, event, {
      cause: "PRICE_SHOCK",
      reason: `StablePrice moved ${(movement * 100).toFixed(2)}pp inside ${received.policy.shockWindowMs}ms`,
      title: "StablePrice circuit breaker fired",
      detail: `The consensus price moved ${(movement * 100).toFixed(2)}pp; no bookmaker quorum was fabricated.`,
    });
  }

  if (received.status === "SUSPENDED" || received.status === "STALE") {
    return processRecoveryObservation(next, event, fair);
  }

  if (received.status === "BOOTSTRAPPING" && canOpenInitialQuotes(next)) {
    return openQuotes(next, event, "Score baseline and StablePrice are ready");
  }

  if (shouldRequote(next)) {
    return replaceQuotes(next, event);
  }

  return appendAudit(next, event, {
    source: "FEED",
    tone: "neutral",
    title: "StablePrice accepted",
    detail: `Accepted ${event.messageId}; largest ${received.policy.shockWindowMs}ms movement is ${(movement * 100).toFixed(2)}pp.`,
  });
}

function actionMaterial(action: string | undefined): MaterialEventKind | null {
  const normalised = action?.toLowerCase().replace(/[\s-]+/g, "_") ?? "";
  if (normalised.includes("red_card") || normalised.includes("redcard")) return "RED_CARD";
  if (normalised.includes("goal")) return "GOAL";
  return null;
}

function validNullableCount(value: number | null) {
  return value === null || (Number.isSafeInteger(value) && value >= 0);
}

function processScore(state: LiveEngineState, event: LiveScoreEvent): LiveEngineState {
  let received = updateTransport(state, "SCORES", event.atMs);
  const scoreKey = `${event.fixtureId}:${event.seq}`;
  if (received.seenScoreKeys.includes(scoreKey)) {
    return rejectEvent(
      received,
      event,
      "Duplicate score ignored",
      `Score (${event.fixtureId}, ${event.seq}) was already processed; transport freshness was retained.`,
    );
  }

  if (!Number.isSafeInteger(event.seq) || event.seq < 1) {
    return rejectEvent(received, event, "Score quarantined", "Score seq must be a positive integer.");
  }
  if (received.lastScoreSeq !== null && event.seq <= received.lastScoreSeq) {
    return rejectEvent(received, event, "Score quarantined", "Score seq regressed.");
  }
  if (!Number.isFinite(event.scoreTsMs)) {
    return rejectEvent(received, event, "Score quarantined", "The score source timestamp is invalid.");
  }
  const counts = [
    event.score.home,
    event.score.away,
    event.redCards.home,
    event.redCards.away,
  ];
  if (counts.some((value) => !validNullableCount(value))) {
    return rejectEvent(received, event, "Score quarantined", "Known score and red-card counts must be non-negative integers.");
  }

  received = {
    ...received,
    seenScoreKeys: [...received.seenScoreKeys, scoreKey].slice(-1_000),
  };

  const wasInitialised = received.scoreInitialised;
  const score = {
    home: event.score.home ?? received.score.home,
    away: event.score.away ?? received.score.away,
  };
  const redCards = {
    home: event.redCards.home ?? received.redCards.home,
    away: event.redCards.away ?? received.redCards.away,
  };
  const scoreKnown = {
    home: received.scoreKnown.home || event.score.home !== null,
    away: received.scoreKnown.away || event.score.away !== null,
  };
  const redCardsKnown = {
    home: received.redCardsKnown.home || event.redCards.home !== null,
    away: received.redCardsKnown.away || event.redCards.away !== null,
  };
  const goalDelta = wasInitialised && (
    (event.score.home !== null && event.score.home !== received.score.home) ||
    (event.score.away !== null && event.score.away !== received.score.away)
  );
  const redCardDelta = wasInitialised && (
    (event.redCards.home !== null &&
      (received.redCardsKnown.home
        ? event.redCards.home !== received.redCards.home
        : event.redCards.home > 0)) ||
    (event.redCards.away !== null &&
      (received.redCardsKnown.away
        ? event.redCards.away !== received.redCards.away
        : event.redCards.away > 0))
  );
  const materialFromAction = actionMaterial(event.action);
  const cumulativeMaterial: MaterialEventKind | null = goalDelta
    ? "GOAL"
    : redCardDelta
      ? "RED_CARD"
      : null;
  const provisionalMaterial = cumulativeMaterial ?? materialFromAction ?? received.pendingMaterialSignal?.material ?? null;
  const explicitlyProvisional = event.confirmed === false;

  // A real sequence is retained for evidence even while its provisional totals
  // are withheld from the confirmed scoreboard.
  let next: LiveEngineState = {
    ...received,
    lastScoreSeq: event.seq,
  };

  if (event.finalised) {
    next = {
      ...next,
      score,
      redCards,
      scoreKnown,
      redCardsKnown,
      scoreInitialised: scoreKnown.home && scoreKnown.away,
    };
    const settledOutcome: LiveOutcome | null =
      scoreKnown.home && scoreKnown.away
        ? score.home > score.away
          ? "HOME"
          : score.home < score.away
            ? "AWAY"
            : "DRAW"
        : null;
    const cancelled = cancelOpenOrders(next, event);
    const closed: LiveEngineState = {
      ...cancelled,
      status: "CLOSED",
      reason: "Fixture finalised; the paper market is terminal",
      paperOrders: cancelled.paperOrders.map((order) =>
        order.state === "CANCELLED" ? order : { ...order, state: "CLOSED" as const },
      ),
      pendingMaterialSignal: null,
      scoreConfirmationRequired: false,
      suspensionCauses: [],
      settledOutcome,
      settledPnl:
        settledOutcome === null
          ? null
          : precise(cancelled.paperCash + cancelled.paperInventory[settledOutcome]),
    };
    return appendAudit(closed, event, {
      source: "AGENT",
      tone: "neutral",
      title: "Fixture finalised",
      detail: `Final score recorded as ${scoreKnown.home ? score.home : "unknown"}–${scoreKnown.away ? score.away : "unknown"}; later events are ignored.`,
    });
  }

  if (explicitlyProvisional) {
    if (!provisionalMaterial) {
      return appendAudit(next, event, {
        source: "FEED",
        tone: "warning",
        title: "Provisional score record withheld",
        detail: `Score seq ${event.seq} was explicitly unconfirmed; nullable totals did not overwrite the confirmed baseline.`,
      });
    }
    next = {
      ...next,
      pendingMaterialSignal: {
        signalId: `score:${event.fixtureId}:${event.seq}`,
        material: provisionalMaterial,
        receivedAtMs: event.atMs,
      },
    };
    return suspend(next, event, {
      cause: "MATERIAL_EVENT",
      reason: `${provisionalMaterial === "GOAL" ? "Goal" : "Red-card"} signal requires an explicitly confirmed score record`,
      title: "Provisional material event received",
      detail: `Score seq ${event.seq} was explicitly unconfirmed; confirmed cumulative totals were preserved.`,
      requireScoreConfirmation: true,
    });
  }

  next = {
    ...next,
    score,
    redCards,
    scoreKnown,
    redCardsKnown,
    scoreInitialised: scoreKnown.home && scoreKnown.away,
  };

  if (cumulativeMaterial) {
    next = {
      ...next,
      scoreConfirmationRequired: false,
      pendingMaterialSignal: null,
    };
    return suspend(next, event, {
      cause: "MATERIAL_EVENT",
      reason: `${cumulativeMaterial === "GOAL" ? "Goal" : "Red-card"} delta confirmed by score seq ${event.seq}`,
      title: `${cumulativeMaterial === "GOAL" ? "Goal" : "Red-card"} guard active`,
      detail: `The cumulative material change was accepted from score seq ${event.seq}.`,
      resetHold: true,
    });
  }

  if (received.scoreConfirmationRequired && event.confirmed === true) {
    const resolved: LiveEngineState = {
      ...next,
      status: received.status === "STALE" ? "STALE" : "SUSPENDED",
      reason: "The provisional material signal was resolved without a cumulative stat change",
      pendingMaterialSignal: null,
      scoreConfirmationRequired: false,
      stableObservations: 0,
      lastStableFair: null,
      holdUntilMs: Math.max(
        received.holdUntilMs ?? 0,
        event.atMs + received.policy.minimumSuspendMs,
      ),
    };
    return appendAudit(resolved, event, {
      source: "FEED",
      tone: "warning",
      title: "Provisional material signal resolved",
      detail: `Confirmed score seq ${event.seq} retained the cumulative totals; a fresh recovery window is required.`,
    });
  }

  if (wasInitialised && materialFromAction) {
    next = {
      ...next,
      pendingMaterialSignal: {
        signalId: `score:${event.fixtureId}:${event.seq}`,
        material: materialFromAction,
        receivedAtMs: event.atMs,
      },
    };
    return suspend(next, event, {
      cause: "MATERIAL_EVENT",
      reason: `${materialFromAction === "GOAL" ? "Goal" : "Red-card"} signal requires score confirmation`,
      title: "Provisional material event received",
      detail: `Feed action ${event.action} did not yet change the confirmed totals.`,
      requireScoreConfirmation: true,
    });
  }

  if (!wasInitialised && canOpenInitialQuotes(next)) {
    return openQuotes(next, event, "Score baseline and StablePrice are ready");
  }

  if (next.scoreConfirmationRequired) {
    return appendAudit(next, event, {
      source: "FEED",
      tone: "warning",
      title: "Score confirmation still pending",
      detail: `Score seq ${event.seq} did not explicitly resolve the provisional material event.`,
    });
  }

  return appendAudit(next, event, {
    source: "FEED",
    tone: "neutral",
    title: wasInitialised ? "Score update accepted" : "Score baseline accepted",
    detail: `Score seq ${event.seq}: ${score.home}–${score.away}, red cards ${redCards.home}–${redCards.away}.`,
  });
}

function processMaterialSignal(
  state: LiveEngineState,
  event: LiveMaterialSignalEvent,
): LiveEngineState {
  const key = `${event.fixtureId}:${event.signalId}`;
  if (state.seenMaterialSignalIds.includes(key)) {
    return rejectEvent(
      state,
      event,
      "Duplicate material signal ignored",
      `Signal ${event.signalId} was already processed.`,
    );
  }
  const next: LiveEngineState = {
    ...state,
    seenMaterialSignalIds: [...state.seenMaterialSignalIds, key].slice(-1_000),
    pendingMaterialSignal: {
      signalId: event.signalId,
      material: event.material,
      receivedAtMs: event.atMs,
    },
  };
  return suspend(next, event, {
    cause: "MATERIAL_EVENT",
    reason: `${event.material === "GOAL" ? "Goal" : "Red-card"} signal requires score confirmation`,
    title: "Provisional material event received",
    detail: `Signal ${event.signalId} protected the market pending a higher-sequence score record.`,
    requireScoreConfirmation: true,
  });
}

function processHeartbeat(state: LiveEngineState, event: LiveHeartbeatEvent) {
  const previousTransportAt = state.lastTransportAtMs[event.channel];
  const recovered =
    previousTransportAt !== null &&
    state.nowMs - previousTransportAt > state.policy.transportTimeoutMs;
  const next = updateTransport(state, event.channel, event.atMs, true);
  if (canReopen(next)) {
    return openQuotes(next, event, "Fresh transport, hold and StablePrice recovery checks passed");
  }
  if (previousTransportAt !== null && !recovered) return next;
  return appendAudit(next, event, {
    source: "FEED",
    tone: "healthy",
    title: recovered
      ? `${event.channel.toLowerCase()} transport recovered`
      : `${event.channel.toLowerCase()} transport established`,
    detail: "Transport freshness changed without rewriting the StablePrice timestamp or stability count.",
  });
}

function processTimer(state: LiveEngineState, event: LiveTimerEvent) {
  const next: LiveEngineState = state;
  const health = selectLiveEngineHealth(next);
  if (health.timedOutChannels.length > 0) {
    const newTimeout = !next.suspensionCauses.includes("TRANSPORT_TIMEOUT");
    if (newTimeout || next.status === "QUOTING") {
      return suspend(next, event, {
        cause: "TRANSPORT_TIMEOUT",
        reason: `Transport timeout on ${health.timedOutChannels.join(" and ")}`,
        title: "Required transport timeout",
        detail: `No stream traffic arrived within ${next.policy.transportTimeoutMs}ms on ${health.timedOutChannels.join(" and ")}.`,
      });
    }
  }

  if (
    health.priceSourceAgeMs !== null &&
    health.priceSourceAgeMs > next.policy.maximumPriceSourceAgeMs &&
    !next.suspensionCauses.includes("PRICE_STALE")
  ) {
    return suspend(next, event, {
      cause: "PRICE_STALE",
      reason: `StablePrice source timestamp is ${health.priceSourceAgeMs}ms old`,
      title: "StablePrice source-age guard",
      detail: `Source age exceeded ${next.policy.maximumPriceSourceAgeMs}ms even though transport traffic may still be fresh.`,
    });
  }

  if (
    health.priceSilenceMs !== null &&
    health.priceSilenceMs > next.policy.maximumPriceSilenceMs &&
    !next.suspensionCauses.includes("PRICE_STALE")
  ) {
    return suspend(next, event, {
      cause: "PRICE_STALE",
      reason: `No new StablePrice for ${health.priceSilenceMs}ms`,
      title: "StablePrice freshness guard",
      detail: `Transport and source-price freshness are tracked independently; price silence exceeded ${next.policy.maximumPriceSilenceMs}ms.`,
    });
  }

  if (canReopen(next)) {
    return openQuotes(next, event, "Fresh transport, hold and StablePrice recovery checks passed");
  }

  if (shouldRequote(next)) return replaceQuotes(next, event);

  // Routine one-second policy ticks advance deterministic time but do not flood
  // the bounded evidence log. State transitions above remain fully audited.
  return next;
}

function processSessionEnd(
  state: LiveEngineState,
  event: LiveSessionEndEvent,
) {
  const cancelled = cancelOpenOrders(state, event);
  const closed: LiveEngineState = {
    ...cancelled,
    status: "CLOSED",
    reason: event.reason?.trim() || "Live session ended",
    suspensionCauses: addCause(cancelled.suspensionCauses, "SESSION_ENDED"),
    pendingMaterialSignal: null,
    scoreConfirmationRequired: false,
  };
  return appendAudit(closed, event, {
    source: "EXECUTION",
    tone: "neutral",
    title: "Live session ended",
    detail:
      cancelled.cancelledOrders > state.cancelledOrders
        ? "Open paper orders were cancelled before the data transports were released."
        : "No open paper orders remained when the data transports were released.",
  });
}

function fixtureFor(event: LiveEngineEvent) {
  return event.kind === "TIMER" ? null : event.fixtureId ?? null;
}

function applyLatchedProtection(state: LiveEngineState): LiveEngineState {
  if (state.status === "CLOSED") return state;
  if (state.emergencyStop) {
    return {
      ...state,
      status: "SUSPENDED",
      reason: `Emergency stop: ${state.emergencyStop.reason}`,
      suspensionCauses: addCause(state.suspensionCauses, "EMERGENCY_STOP"),
    };
  }
  if (state.suspensionCauses.includes("MAXIMUM_LIABILITY")) {
    return {
      ...state,
      status: "SUSPENDED",
      reason: `Maximum liability guard is latched at ${state.policy.maximumLiability}`,
    };
  }
  return state;
}

export function reduceLiveEngineEvent(
  state: LiveEngineState,
  event: LiveEngineEvent,
): LiveEngineState {
  if (!liveEngineEventKinds.has((event as { kind?: unknown }).kind as string)) {
    return state;
  }
  if (state.status === "CLOSED" || event.atMs < state.nowMs) return state;
  const eventFixture = fixtureFor(event);
  if (eventFixture !== null && eventFixture !== state.fixtureId) {
    return rejectEvent(
      state,
      event,
      "Fixture mismatch",
      `Received ${eventFixture}; this engine is scoped to ${state.fixtureId}.`,
    );
  }
  if (
    event.kind === "PAPER_FILL" &&
    (state.seenPaperFillIds.includes(event.fillId.trim()) ||
      state.paperFills.some((fill) => fill.id === event.fillId.trim()))
  ) {
    return state;
  }
  if (event.kind === "EMERGENCY_STOP" && state.emergencyStop !== null) {
    return state;
  }

  const current: LiveEngineState = {
    ...state,
    nowMs: event.atMs,
    matchClock: event.clock,
  };
  const next = event.kind === "ODDS"
    ? processOdds(current, event)
    : event.kind === "SCORE"
      ? processScore(current, event)
      : event.kind === "MATERIAL_SIGNAL"
        ? processMaterialSignal(current, event)
        : event.kind === "PAPER_FILL"
          ? processPaperFill(current, event)
          : event.kind === "EMERGENCY_STOP"
            ? processEmergencyStop(current, event)
            : event.kind === "HEARTBEAT"
              ? processHeartbeat(current, event)
              : event.kind === "SESSION_END"
                ? processSessionEnd(current, event)
                : processTimer(current, event);
  return applyLatchedProtection(next);
}

export function activeLivePaperOrders(state: LiveEngineState) {
  return state.paperOrders.filter((order) => order.state === "OPEN");
}

export function liveQuoteRows(state: LiveEngineState): LiveQuoteRow[] {
  const active = activeLivePaperOrders(state);
  return outcomes.map((outcome) => {
    const bid = active.find((order) => order.outcome === outcome && order.side === "BID");
    const ask = active.find((order) => order.outcome === outcome && order.side === "ASK");
    return {
      outcome,
      fair: state.fair?.[outcome] ?? null,
      bid: bid?.price ?? null,
      ask: ask?.price ?? null,
      quantity: bid
        ? remainingLivePaperOrderQuantity(state, bid.id)
        : ask
          ? remainingLivePaperOrderQuantity(state, ask.id)
          : 0,
      state:
        state.status === "CLOSED"
          ? "CLOSED"
          : bid && ask
            ? "OPEN"
            : state.fair
              ? "PROTECTED"
              : "WAITING",
    };
  });
}
