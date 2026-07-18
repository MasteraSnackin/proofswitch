import {
  activeLivePaperOrders,
  createLiveEngineState,
  reduceLiveEngineEvent,
  selectLivePaperRisk,
  type LiveEngineEvent,
  type LiveEngineState,
  type LivePolicy,
} from "./live-engine.ts";

export const AGENT_TRACE_SCHEMA = "proofswitch.agent-trace.v1" as const;
const MAX_AGENT_TRACE_EVENTS = 50_000;
const AGENT_EVENT_KINDS = new Set([
  "HEARTBEAT",
  "ODDS",
  "SCORE",
  "MATERIAL_SIGNAL",
  "PAPER_FILL",
  "EMERGENCY_STOP",
  "TIMER",
  "SESSION_END",
]);

export interface AgentTrace {
  schema: typeof AGENT_TRACE_SCHEMA;
  source: "synthetic" | "txline";
  fixtureId: string;
  capturedAt: string;
  policy?: Partial<LivePolicy>;
  events: LiveEngineEvent[];
}

export interface AgentReplayMetrics {
  eventCount: number;
  acceptedEvents: number;
  rejectedEvents: number;
  ignoredEvents: number;
  observedDurationMs: number;
  quoteUptimeMs: number;
  protectedTimeMs: number;
  bootstrappingTimeMs: number;
  quoteUptimePct: number;
  firstQuoteLatencyMs: number | null;
  suspensionEpisodes: number;
  recoveryEpisodes: number;
  quoteEpochs: number;
  placedOrders: number;
  cancelledOrders: number;
  peakOpenQuantity: number;
  largestMovementPp: number;
  paperFills: number;
  paperFillRejects: number;
  filledNotional: number;
  peakLiability: number;
  endingLiability: number;
  markToMarketPnl: number | null;
  settledPnl: number | null;
  emergencyStopEngaged: boolean;
  finalStatus: LiveEngineState["status"];
  finalReason: string;
}

export interface AgentReplayResult {
  source: AgentTrace["source"];
  fixtureId: string;
  metrics: AgentReplayMetrics;
  state: LiveEngineState;
}

export interface PolicySensitivityResult {
  shockDelta: number;
  suspensionEpisodes: number;
  recoveryEpisodes: number;
  quoteUptimePct: number;
  cancelledOrders: number;
  largestMovementPp: number;
}

function traceRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function traceString(
  record: Record<string, unknown>,
  key: string,
  label: string,
  optional = false,
) {
  const value = record[key];
  if (optional && value === undefined) return;
  if (typeof value !== "string" || !value.trim() || value.length > 512) {
    throw new TypeError(`${label}.${key} must be a non-empty bounded string`);
  }
}

function traceFiniteNumber(
  record: Record<string, unknown>,
  key: string,
  label: string,
  options: { integer?: boolean; nullable?: boolean } = {},
) {
  const value = record[key];
  if (options.nullable && value === null) return;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    (options.integer && !Number.isSafeInteger(value))
  ) {
    throw new TypeError(`${label}.${key} must be a finite${options.integer ? " safe integer" : " number"}`);
  }
}

function traceOptionalBoolean(
  record: Record<string, unknown>,
  key: string,
  label: string,
  nullable = false,
) {
  const value = record[key];
  if (value === undefined || (nullable && value === null)) return;
  if (typeof value !== "boolean") {
    throw new TypeError(`${label}.${key} must be a boolean${nullable ? ", null" : ""} when present`);
  }
}

function traceFixture(record: Record<string, unknown>, label: string, optional = false) {
  traceString(record, "fixtureId", label, optional);
}

function validateAgentEvent(value: unknown, index: number) {
  const label = `Agent trace event ${index}`;
  const event = traceRecord(value, label);
  traceString(event, "kind", label);
  if (!AGENT_EVENT_KINDS.has(event.kind as string)) {
    throw new RangeError(`${label}.kind is not recognised`);
  }
  traceFiniteNumber(event, "atMs", label, { integer: true });
  if ((event.atMs as number) < 0) {
    throw new RangeError(`${label}.atMs must be non-negative`);
  }
  traceString(event, "clock", label);

  switch (event.kind) {
    case "TIMER":
      return;
    case "HEARTBEAT":
      traceFixture(event, label, true);
      if (event.channel !== "ODDS" && event.channel !== "SCORES") {
        throw new RangeError(`${label}.channel is not recognised`);
      }
      traceString(event, "sseId", label, true);
      return;
    case "ODDS": {
      traceFixture(event, label);
      traceString(event, "messageId", label);
      traceString(event, "sseId", label, true);
      traceFiniteNumber(event, "priceTsMs", label);
      const prices = traceRecord(event.pct, `${label}.pct`);
      for (const outcome of ["HOME", "DRAW", "AWAY"]) {
        traceFiniteNumber(prices, outcome, `${label}.pct`);
      }
      traceOptionalBoolean(event, "inRunning", label);
      if (
        event.gameState !== undefined &&
        event.gameState !== null &&
        typeof event.gameState !== "string"
      ) {
        throw new TypeError(`${label}.gameState must be a string or null when present`);
      }
      return;
    }
    case "SCORE": {
      traceFixture(event, label);
      traceFiniteNumber(event, "seq", label, { integer: true });
      traceFiniteNumber(event, "scoreTsMs", label);
      const score = traceRecord(event.score, `${label}.score`);
      const redCards = traceRecord(event.redCards, `${label}.redCards`);
      for (const side of ["home", "away"]) {
        traceFiniteNumber(score, side, `${label}.score`, { nullable: true });
        traceFiniteNumber(redCards, side, `${label}.redCards`, { nullable: true });
      }
      traceString(event, "action", label, true);
      traceOptionalBoolean(event, "confirmed", label, true);
      traceOptionalBoolean(event, "finalised", label);
      return;
    }
    case "MATERIAL_SIGNAL":
      traceFixture(event, label);
      traceString(event, "signalId", label);
      if (event.material !== "GOAL" && event.material !== "RED_CARD") {
        throw new RangeError(`${label}.material is not recognised`);
      }
      return;
    case "PAPER_FILL":
      traceFixture(event, label);
      traceString(event, "fillId", label);
      traceString(event, "orderId", label);
      traceFiniteNumber(event, "quantity", label);
      return;
    case "EMERGENCY_STOP":
      traceFixture(event, label);
      traceString(event, "stopId", label);
      traceString(event, "reason", label, true);
      return;
    case "SESSION_END":
      traceFixture(event, label);
      traceString(event, "reason", label, true);
      return;
  }
}

export function assertValidAgentTrace(value: unknown): asserts value is AgentTrace {
  const trace = traceRecord(value, "Agent trace");
  if (trace.schema !== AGENT_TRACE_SCHEMA) {
    throw new RangeError(`Unsupported agent trace schema: ${String(trace.schema)}`);
  }
  if (trace.source !== "synthetic" && trace.source !== "txline") {
    throw new RangeError("Agent trace source must be synthetic or txline");
  }
  traceString(trace, "fixtureId", "Agent trace");
  traceString(trace, "capturedAt", "Agent trace");
  if (!Number.isFinite(Date.parse(trace.capturedAt as string))) {
    throw new RangeError("Agent trace capturedAt must be a valid timestamp");
  }
  if (trace.policy !== undefined) traceRecord(trace.policy, "Agent trace policy");
  if (!Array.isArray(trace.events) || trace.events.length === 0) {
    throw new RangeError("Agent trace must contain events");
  }
  if (trace.events.length > MAX_AGENT_TRACE_EVENTS) {
    throw new RangeError(`Agent trace cannot contain more than ${MAX_AGENT_TRACE_EVENTS} events`);
  }
  trace.events.forEach(validateAgentEvent);
}

function boundedPercentage(numerator: number, denominator: number) {
  if (denominator <= 0) return 0;
  return Math.max(0, Math.min(100, (numerator / denominator) * 100));
}

function openQuantity(state: LiveEngineState) {
  return activeLivePaperOrders(state).reduce(
    (sum, order) => sum + order.quantity,
    0,
  );
}

function transitionDuration(
  status: LiveEngineState["status"],
  durationMs: number,
  durations: {
    quoting: number;
    protected: number;
    bootstrapping: number;
  },
) {
  if (durationMs <= 0) return;
  if (status === "QUOTING") durations.quoting += durationMs;
  else if (status === "SUSPENDED" || status === "STALE") {
    durations.protected += durationMs;
  } else if (status === "BOOTSTRAPPING") {
    durations.bootstrapping += durationMs;
  }
}

export function replayAgentTrace(
  trace: AgentTrace,
  policyOverrides: Partial<LivePolicy> = {},
): AgentReplayResult {
  assertValidAgentTrace(trace);

  let state = createLiveEngineState({
    fixtureId: trace.fixtureId,
    policy: { ...trace.policy, ...policyOverrides },
  });
  const firstAtMs = trace.events[0].atMs;
  let previousAtMs = firstAtMs;
  let firstQuoteAtMs: number | null = null;
  let acceptedEvents = 0;
  let ignoredEvents = 0;
  let suspensionEpisodes = 0;
  let recoveryEpisodes = 0;
  let hasQuoted = false;
  let peakOpenQuantity = 0;
  let peakLiability = 0;
  let largestMovementPp = 0;
  const durations = { quoting: 0, protected: 0, bootstrapping: 0 };

  if (!Number.isSafeInteger(firstAtMs) || firstAtMs < 0) {
    throw new RangeError("Agent trace timestamps must be non-negative safe integers");
  }

  for (const event of trace.events) {
    if (!Number.isSafeInteger(event.atMs) || event.atMs < previousAtMs) {
      throw new RangeError("Agent trace events must have monotonic safe-integer timestamps");
    }
    transitionDuration(state.status, event.atMs - previousAtMs, durations);

    const before = state;
    const rejectedBefore = state.rejectedEvents + state.paperFillRejects;
    state = reduceLiveEngineEvent(state, event);
    if (state === before) ignoredEvents += 1;
    else if (state.rejectedEvents + state.paperFillRejects === rejectedBefore) acceptedEvents += 1;

    const enteredProtected =
      (state.status === "SUSPENDED" || state.status === "STALE") &&
      before.status !== "SUSPENDED" &&
      before.status !== "STALE";
    if (enteredProtected) suspensionEpisodes += 1;

    if (state.status === "QUOTING" && before.status !== "QUOTING") {
      if (firstQuoteAtMs === null) firstQuoteAtMs = event.atMs;
      else if (hasQuoted) recoveryEpisodes += 1;
      hasQuoted = true;
    }

    peakOpenQuantity = Math.max(peakOpenQuantity, openQuantity(state));
    peakLiability = Math.max(peakLiability, selectLivePaperRisk(state).liability);
    largestMovementPp = Math.max(largestMovementPp, state.lastMovement * 100);
    previousAtMs = event.atMs;
  }

  const observedDurationMs = previousAtMs - firstAtMs;
  const placedOrders = state.executionCommands
    .filter((command) => command.kind === "PLACE_QUOTES")
    .reduce((sum, command) => sum + command.orderIds.length, 0);
  const cancelledOrders = state.paperOrders.filter(
    (order) => order.state === "CANCELLED",
  ).length;
  const finalRisk = selectLivePaperRisk(state);

  return {
    source: trace.source,
    fixtureId: trace.fixtureId,
    metrics: {
      eventCount: trace.events.length,
      acceptedEvents,
      rejectedEvents: state.rejectedEvents + state.paperFillRejects,
      ignoredEvents,
      observedDurationMs,
      quoteUptimeMs: durations.quoting,
      protectedTimeMs: durations.protected,
      bootstrappingTimeMs: durations.bootstrapping,
      quoteUptimePct: boundedPercentage(durations.quoting, observedDurationMs),
      firstQuoteLatencyMs:
        firstQuoteAtMs === null ? null : firstQuoteAtMs - firstAtMs,
      suspensionEpisodes,
      recoveryEpisodes,
      quoteEpochs: state.quoteEpoch,
      placedOrders,
      cancelledOrders,
      peakOpenQuantity,
      largestMovementPp: Number(largestMovementPp.toFixed(6)),
      paperFills: state.paperFills.length,
      paperFillRejects: state.paperFillRejects,
      filledNotional: finalRisk.filledNotional,
      peakLiability,
      endingLiability: finalRisk.liability,
      markToMarketPnl: finalRisk.markToMarketPnl,
      settledPnl: finalRisk.settledPnl,
      emergencyStopEngaged: state.emergencyStop !== null,
      finalStatus: state.status,
      finalReason: state.reason,
    },
    state,
  };
}

export function compareShockThresholds(
  trace: AgentTrace,
  shockDeltas: readonly number[] = [0.03, 0.04, 0.06],
): PolicySensitivityResult[] {
  if (
    shockDeltas.length === 0 ||
    shockDeltas.length > 20 ||
    shockDeltas.some(
      (value) => !Number.isFinite(value) || value <= 0 || value > 0.5,
    )
  ) {
    throw new RangeError("Shock thresholds must contain 1 to 20 values above zero and at most 0.5");
  }
  return shockDeltas.map((shockDelta) => {
    const replay = replayAgentTrace(trace, { shockDelta });
    return {
      shockDelta,
      suspensionEpisodes: replay.metrics.suspensionEpisodes,
      recoveryEpisodes: replay.metrics.recoveryEpisodes,
      quoteUptimePct: replay.metrics.quoteUptimePct,
      cancelledOrders: replay.metrics.cancelledOrders,
      largestMovementPp: replay.metrics.largestMovementPp,
    };
  });
}
