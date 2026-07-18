export type Outcome = "HOME" | "DRAW" | "AWAY";

export type EngineStatus =
  | "BOOTSTRAPPING"
  | "QUOTING"
  | "SUSPENDED"
  | "REPRICING"
  | "STALE"
  | "CLOSED";

export type ProofStatus = "NOT_REQUESTED" | "MOCK_PENDING" | "MOCK_READY";
export type Prices = Record<Outcome, number>;

export interface SourceBook {
  provider: string;
  decimal: Prices;
  sequence?: number;
  observedAtMs?: number;
}

export interface QuoteSnapshot {
  outcome: Outcome;
  bid: number;
  ask: number;
  quantity: number;
}

export interface QuoteRow {
  outcome: Outcome;
  label: string;
  fair: number;
  bid: number | null;
  ask: number | null;
  quantity: number;
  state: "OPEN" | "PROTECTED" | "CLOSED";
}

export interface AuditEntry {
  id: string;
  clock: string;
  source: "FEED" | "AGENT" | "EXECUTION" | "PROOF";
  title: string;
  detail: string;
  tone: "neutral" | "healthy" | "warning" | "danger";
}

export interface ScenarioEvent {
  id: string;
  atMs: number;
  clock: string;
  kind:
    | "SCORE_SNAPSHOT"
    | "ODDS_FRAME"
    | "GOAL_PENDING"
    | "SCORE_CONFIRMED"
    | "TIMER"
    | "PARTIAL_FILL"
    | "FEED_TIMEOUT"
    | "RECOVERY_FRAME"
    | "MOCK_PROOF"
    | "FULL_TIME";
  title: string;
  detail: string;
  books?: SourceBook[];
  score?: { home: number; away: number };
  outcome?: Outcome;
  quantity?: number;
  price?: number;
  stable?: boolean;
}

export interface EngineState {
  cursor: number;
  status: EngineStatus;
  reason: string;
  score: { home: number; away: number };
  matchClock: string;
  fair: Prices;
  previousFair: Prices;
  quotedFair: Prices;
  stableFrames: number;
  quoteEpoch: number;
  openOrders: number;
  cancelledOrders: number;
  inventory: Prices;
  cash: number;
  counterfactualLoss: number;
  counterfactualBreakdown: Prices;
  proofStatus: ProofStatus;
  lastEvent: ScenarioEvent | null;
  audit: AuditEntry[];
  nowMs: number;
  lastOddsAtMs: number | null;
  holdUntilMs: number | null;
  scoreConfirmed: boolean;
  recoveryMode: boolean;
  stableDeltas: number[];
  lastStableFair: Prices | null;
  fairHistory: Array<{ atMs: number; fair: Prices }>;
  sourceSequences: Record<string, number>;
  sourceBaselines: Record<string, Prices>;
  latestBooks: SourceBook[];
  providerConfirmations: number;
  triggerMovement: number;
  quoteHalfSpread: number;
  suspendedQuotes: QuoteSnapshot[] | null;
  rejectedFrames: number;
}

export const policy = {
  minimumProviders: 3,
  staleAfterMs: 2_500,
  shockWindowMs: 2_000,
  shockDelta: 0.04,
  minimumConfirmations: 2,
  minimumSuspendMs: 3_000,
  stableFramesRequired: 3,
  stableFrameDelta: 0.0075,
  baseHalfSpread: 0.012,
  maximumHalfSpread: 0.04,
  baseQuantity: 250,
  minimumQuantity: 50,
  inventoryLimit: 1_000,
  inventorySkewAtLimit: 0.01,
  priceTick: 0.0001,
} as const;

const outcomes: Outcome[] = ["HOME", "DRAW", "AWAY"];
const zeroPrices = (): Prices => ({ HOME: 0, DRAW: 0, AWAY: 0 });

const initialBookValues: SourceBook[] = [
  { provider: "NORTHSTAR", decimal: { HOME: 2.24, DRAW: 3.2, AWAY: 3.36 } },
  { provider: "MERIDIAN", decimal: { HOME: 2.3, DRAW: 3.05, AWAY: 3.4 } },
  { provider: "ATLAS", decimal: { HOME: 2.28, DRAW: 3.1, AWAY: 3.45 } },
];

const outlierBookValues: SourceBook[] = [
  { provider: "NORTHSTAR", decimal: { HOME: 1.5, DRAW: 4.6, AWAY: 8 } },
  initialBookValues[1],
  initialBookValues[2],
];

const shockBookValues: SourceBook[] = [
  outlierBookValues[0],
  { provider: "MERIDIAN", decimal: { HOME: 1.54, DRAW: 4.4, AWAY: 7.5 } },
  initialBookValues[2],
];

const stableBookValuesOne: SourceBook[] = [
  { provider: "NORTHSTAR", decimal: { HOME: 1.5, DRAW: 4.6, AWAY: 8 } },
  { provider: "MERIDIAN", decimal: { HOME: 1.54, DRAW: 4.4, AWAY: 7.5 } },
  { provider: "ATLAS", decimal: { HOME: 1.52, DRAW: 4.5, AWAY: 7.8 } },
];

const stableBookValuesTwo: SourceBook[] = [
  { provider: "NORTHSTAR", decimal: { HOME: 1.51, DRAW: 4.55, AWAY: 7.9 } },
  { provider: "MERIDIAN", decimal: { HOME: 1.53, DRAW: 4.45, AWAY: 7.6 } },
  { provider: "ATLAS", decimal: { HOME: 1.52, DRAW: 4.48, AWAY: 7.75 } },
];

const stableBookValuesThree: SourceBook[] = [
  { provider: "NORTHSTAR", decimal: { HOME: 1.5, DRAW: 4.58, AWAY: 7.95 } },
  { provider: "MERIDIAN", decimal: { HOME: 1.52, DRAW: 4.47, AWAY: 7.7 } },
  { provider: "ATLAS", decimal: { HOME: 1.51, DRAW: 4.5, AWAY: 7.82 } },
];

function sequencedBooks(books: SourceBook[], sequence: number, observedAtMs: number) {
  return books.map((book) => ({
    provider: book.provider,
    decimal: { ...book.decimal },
    sequence,
    observedAtMs,
  }));
}

const sharedSnapshot: ScenarioEvent = {
  id: "snapshot",
  atMs: 0,
  clock: "62:14.000",
  kind: "SCORE_SNAPSHOT",
  title: "Synthetic score snapshot accepted",
  detail: "Aurora 0–0 Pacifica. The World Cup agent is waiting for a complete reference book.",
  score: { home: 0, away: 0 },
};

const sharedInitialFrame: ScenarioEvent = {
  id: "initial-book",
  atMs: 100,
  clock: "62:14.100",
  kind: "ODDS_FRAME",
  title: "Three-provider reference established",
  detail: "Margin removed and six paper quotes placed across three outcomes.",
  books: sequencedBooks(initialBookValues, 1, 100),
};

const sharedFreshFrame: ScenarioEvent = {
  id: "fresh-book",
  atMs: 2_000,
  clock: "62:16.000",
  kind: "ODDS_FRAME",
  title: "Reference remains stable",
  detail: "Movement is below the replacement threshold; no quote churn.",
  books: sequencedBooks(initialBookValues, 2, 2_000),
};

const outlierFrame: ScenarioEvent = {
  id: "outlier",
  atMs: 4_000,
  clock: "62:18.000",
  kind: "ODDS_FRAME",
  title: "Single-provider outlier quarantined",
  detail: "Only one source diverged; median consensus stayed below the intervention threshold.",
  books: sequencedBooks(outlierBookValues, 3, 4_000),
};

const shockFrame: ScenarioEvent = {
  id: "shock",
  atMs: 4_400,
  clock: "62:18.400",
  kind: "ODDS_FRAME",
  title: "Second provider confirms the move",
  detail: "The engine must decide whether the observed consensus movement breaches policy.",
  books: sequencedBooks(shockBookValues, 4, 4_400),
};

const goalShock: ScenarioEvent[] = [
  sharedSnapshot,
  sharedInitialFrame,
  sharedFreshFrame,
  outlierFrame,
  shockFrame,
  {
    id: "goal-pending",
    atMs: 4_700,
    clock: "62:18.700",
    kind: "GOAL_PENDING",
    title: "Goal signal received",
    detail: "The market remains protected; duplicate cancellations must be suppressed.",
  },
  {
    id: "score-confirmed",
    atMs: 5_000,
    clock: "62:19.000",
    kind: "SCORE_CONFIRMED",
    title: "Score confirmed",
    detail: "Aurora leads 1–0. A three-second hold begins from confirmation.",
    score: { home: 1, away: 0 },
  },
  {
    id: "stable-one",
    atMs: 6_600,
    clock: "62:20.600",
    kind: "ODDS_FRAME",
    title: "Post-event observation 1",
    detail: "The engine derives stability from the observed prices; no stability flag is supplied.",
    books: sequencedBooks(stableBookValuesOne, 5, 6_600),
  },
  {
    id: "stable-two",
    atMs: 7_600,
    clock: "62:21.600",
    kind: "ODDS_FRAME",
    title: "Post-event observation 2",
    detail: "The price delta is tested against the 0.75pp stability boundary.",
    books: sequencedBooks(stableBookValuesTwo, 6, 7_600),
  },
  {
    id: "mock-proof",
    atMs: 8_000,
    clock: "62:22.000",
    kind: "MOCK_PROOF",
    title: "Mock proof payload prepared",
    detail: "No Solana call is made. The future validation boundary is exercised locally.",
  },
  {
    id: "stable-three",
    atMs: 8_600,
    clock: "62:22.600",
    kind: "ODDS_FRAME",
    title: "Post-event observation 3",
    detail: "The engine independently checks stability, score confirmation and hold expiry.",
    books: sequencedBooks(stableBookValuesThree, 7, 8_600),
  },
  {
    id: "reopen",
    atMs: 8_800,
    clock: "62:22.800",
    kind: "TIMER",
    title: "Freshness check",
    detail: "The timer asks the policy engine whether replacement quotes may be released.",
  },
];

const outlierResilience: ScenarioEvent[] = [
  sharedSnapshot,
  sharedInitialFrame,
  sharedFreshFrame,
  outlierFrame,
];

const staleFeedRecovery: ScenarioEvent[] = [
  sharedSnapshot,
  sharedInitialFrame,
  sharedFreshFrame,
  {
    id: "freshness-boundary",
    atMs: 4_500,
    clock: "62:18.500",
    kind: "TIMER",
    title: "Freshness boundary checked",
    detail: "Exactly 2,500ms has elapsed since the last valid frame.",
  },
  {
    id: "freshness-breach",
    atMs: 4_501,
    clock: "62:18.501",
    kind: "TIMER",
    title: "Freshness boundary exceeded",
    detail: "The timer is one millisecond beyond the configured feed-age limit.",
  },
  {
    id: "recovery-one",
    atMs: 5_000,
    clock: "62:19.000",
    kind: "ODDS_FRAME",
    title: "Recovery observation 1",
    detail: "A valid frame returned, but one observation is not enough to reopen.",
    books: sequencedBooks(initialBookValues, 3, 5_000),
  },
  {
    id: "recovery-two",
    atMs: 5_500,
    clock: "62:19.500",
    kind: "ODDS_FRAME",
    title: "Recovery observation 2",
    detail: "The reference remains consistent; quotes stay withdrawn.",
    books: sequencedBooks(initialBookValues, 4, 5_500),
  },
  {
    id: "recovery-three",
    atMs: 6_000,
    clock: "62:20.000",
    kind: "ODDS_FRAME",
    title: "Recovery observation 3",
    detail: "Three stable frames permit deterministic repricing.",
    books: sequencedBooks(initialBookValues, 5, 6_000),
  },
  {
    id: "recovery-reopen",
    atMs: 6_200,
    clock: "62:20.200",
    kind: "TIMER",
    title: "Recovery freshness check",
    detail: "The latest frame is fresh, so the replacement quote set may be released.",
  },
];

export const demoScenarios = {
  goalShock,
  outlierResilience,
  staleFeedRecovery,
} as const satisfies Record<string, readonly ScenarioEvent[]>;

export const scenario: ScenarioEvent[] = [...demoScenarios.goalShock];

export function createInitialState(): EngineState {
  return {
    cursor: -1,
    status: "BOOTSTRAPPING",
    reason: "Awaiting synthetic fixture and reference prices",
    score: { home: 0, away: 0 },
    matchClock: "62:14.000",
    fair: zeroPrices(),
    previousFair: zeroPrices(),
    quotedFair: zeroPrices(),
    stableFrames: 0,
    quoteEpoch: 0,
    openOrders: 0,
    cancelledOrders: 0,
    inventory: zeroPrices(),
    cash: 0,
    counterfactualLoss: 0,
    counterfactualBreakdown: zeroPrices(),
    proofStatus: "NOT_REQUESTED",
    lastEvent: null,
    audit: [],
    nowMs: 0,
    lastOddsAtMs: null,
    holdUntilMs: null,
    scoreConfirmed: false,
    recoveryMode: false,
    stableDeltas: [],
    lastStableFair: null,
    fairHistory: [],
    sourceSequences: {},
    sourceBaselines: {},
    latestBooks: [],
    providerConfirmations: 0,
    triggerMovement: 0,
    quoteHalfSpread: policy.baseHalfSpread,
    suspendedQuotes: null,
    rejectedFrames: 0,
  };
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function deMargin(decimal: Prices): Prices {
  const raw = {
    HOME: 1 / decimal.HOME,
    DRAW: 1 / decimal.DRAW,
    AWAY: 1 / decimal.AWAY,
  };
  const total = raw.HOME + raw.DRAW + raw.AWAY;
  return {
    HOME: raw.HOME / total,
    DRAW: raw.DRAW / total,
    AWAY: raw.AWAY / total,
  };
}

function staticBookError(books: SourceBook[]) {
  if (books.length < policy.minimumProviders) {
    return `Expected at least ${policy.minimumProviders} providers; received ${books.length}.`;
  }
  const providers = new Set<string>();
  for (const book of books) {
    if (!book.provider.trim()) return "Provider identifier is missing.";
    if (providers.has(book.provider)) return `Duplicate provider ${book.provider}.`;
    providers.add(book.provider);
    for (const outcome of outcomes) {
      const price = book.decimal[outcome];
      if (!Number.isFinite(price) || price <= 1.01) {
        return `${book.provider} supplied an invalid ${outcome} price.`;
      }
    }
  }
  return null;
}

export function validateSourceBooks(
  books: SourceBook[],
  sourceSequences: Record<string, number> = {},
) {
  const staticError = staticBookError(books);
  if (staticError) return { valid: false as const, reason: staticError };
  for (const book of books) {
    if (book.sequence !== undefined) {
      if (!Number.isInteger(book.sequence) || book.sequence < 0) {
        return { valid: false as const, reason: `${book.provider} supplied an invalid sequence.` };
      }
      const previous = sourceSequences[book.provider];
      if (previous !== undefined && book.sequence <= previous) {
        return {
          valid: false as const,
          reason: `${book.provider} sequence ${book.sequence} is duplicate or out of order.`,
        };
      }
    }
  }
  return { valid: true as const, reason: null };
}

export function consensusFromBooks(books: SourceBook[]): Prices {
  const error = staticBookError(books);
  if (error) throw new RangeError(error);
  const fairBooks = books.map((book) => deMargin(book.decimal));
  const medians = {
    HOME: median(fairBooks.map((book) => book.HOME)),
    DRAW: median(fairBooks.map((book) => book.DRAW)),
    AWAY: median(fairBooks.map((book) => book.AWAY)),
  };
  const total = medians.HOME + medians.DRAW + medians.AWAY;
  return {
    HOME: medians.HOME / total,
    DRAW: medians.DRAW / total,
    AWAY: medians.AWAY / total,
  };
}

function maxMovement(a: Prices, b: Prices) {
  return Math.max(...outcomes.map((outcome) => Math.abs(a[outcome] - b[outcome])));
}

function providerFairs(books: SourceBook[]) {
  return Object.fromEntries(books.map((book) => [book.provider, deMargin(book.decimal)])) as Record<
    string,
    Prices
  >;
}

function providerConfirmationCount(books: SourceBook[], baselines: Record<string, Prices>) {
  return books.reduce((count, book) => {
    const baseline = baselines[book.provider];
    if (!baseline) return count;
    return count + (maxMovement(baseline, deMargin(book.decimal)) >= policy.shockDelta ? 1 : 0);
  }, 0);
}

function roundPrice(value: number) {
  return Math.round(value / policy.priceTick) * policy.priceTick;
}

function quoteQuantity(inventory: number) {
  const unrounded =
    policy.baseQuantity * (1 - 0.5 * Math.abs(inventory) / policy.inventoryLimit);
  return Math.max(policy.minimumQuantity, Math.floor(unrounded / 25) * 25);
}

function snapshotsFrom(
  fair: Prices,
  inventory: Prices,
  halfSpread: number,
): QuoteSnapshot[] {
  return outcomes.map((outcome) => {
    const inventorySkew = Math.max(
      -policy.inventorySkewAtLimit,
      Math.min(
        policy.inventorySkewAtLimit,
        (inventory[outcome] / policy.inventoryLimit) * policy.inventorySkewAtLimit,
      ),
    );
    const midpoint = Math.max(0.02, Math.min(0.98, fair[outcome] - inventorySkew));
    return {
      outcome,
      bid: roundPrice(Math.max(0, midpoint - halfSpread)),
      ask: roundPrice(Math.min(1, midpoint + halfSpread)),
      quantity: quoteQuantity(inventory[outcome]),
    };
  });
}

export function calculateCounterfactual(
  staleQuotes: QuoteSnapshot[],
  postEventFair: Prices,
) {
  const breakdown = zeroPrices();
  for (const quote of staleQuotes) {
    breakdown[quote.outcome] =
      quote.quantity *
      Math.max(
        postEventFair[quote.outcome] - quote.ask,
        quote.bid - postEventFair[quote.outcome],
        0,
      );
  }
  const loss = outcomes.reduce((total, outcome) => total + breakdown[outcome], 0);
  return {
    loss: Math.round(loss * 100) / 100,
    breakdown: Object.fromEntries(
      outcomes.map((outcome) => [outcome, Math.round(breakdown[outcome] * 100) / 100]),
    ) as Prices,
  };
}

function auditFor(
  event: ScenarioEvent,
  source: AuditEntry["source"],
  tone: AuditEntry["tone"],
  title = event.title,
  detail = event.detail,
): AuditEntry {
  return { id: event.id, clock: event.clock, source, title, detail, tone };
}

function withAudit(state: EngineState, audit: AuditEntry) {
  return { ...state, audit: [audit, ...state.audit].slice(0, 30) };
}

function measuredSpread(stableDeltas: number[]) {
  if (stableDeltas.length === 0) return policy.baseHalfSpread;
  const mean = stableDeltas.reduce((total, delta) => total + delta, 0) / stableDeltas.length;
  return Math.min(policy.maximumHalfSpread, policy.baseHalfSpread + mean * 0.5);
}

function processStableFrame(state: EngineState, event: ScenarioEvent, fair: Prices) {
  const delta = state.lastStableFair ? maxMovement(state.lastStableFair, fair) : 0;
  const stable = state.lastStableFair === null || delta <= policy.stableFrameDelta;
  const stableFrames = stable ? state.stableFrames + 1 : 1;
  const stableDeltas = [...(stable ? state.stableDeltas : []), delta].slice(
    -policy.stableFramesRequired,
  );
  const holdExpired = state.holdUntilMs === null || event.atMs >= state.holdUntilMs;
  const confirmationSatisfied = state.recoveryMode || state.scoreConfirmed;
  const canReprice =
    stableFrames >= policy.stableFramesRequired && holdExpired && confirmationSatisfied;
  const counterfactual = state.suspendedQuotes
    ? calculateCounterfactual(state.suspendedQuotes, fair)
    : { loss: state.counterfactualLoss, breakdown: state.counterfactualBreakdown };

  return {
    ...state,
    fair,
    stableFrames,
    stableDeltas,
    lastStableFair: fair,
    status: canReprice
      ? ("REPRICING" as const)
      : state.recoveryMode
        ? ("BOOTSTRAPPING" as const)
        : ("SUSPENDED" as const),
    reason: canReprice
      ? "Three stable frames derived; replacement quotes are ready"
      : !stable
        ? "Stability reset after a movement above 0.75pp"
        : !holdExpired
          ? `Stable observation ${stableFrames}/3; minimum hold remains active`
          : !confirmationSatisfied
            ? `Stable observation ${stableFrames}/3; waiting for score confirmation`
            : `Stable observation ${stableFrames}/3`,
    quoteHalfSpread: measuredSpread(stableDeltas),
    counterfactualLoss: counterfactual.loss,
    counterfactualBreakdown: counterfactual.breakdown,
  };
}

function processOddsFrame(state: EngineState, event: ScenarioEvent) {
  const books = event.books ?? [];
  const validation = validateSourceBooks(books, state.sourceSequences);
  if (!validation.valid) {
    return withAudit(
      {
        ...state,
        rejectedFrames: state.rejectedFrames + 1,
        reason: "Invalid reference frame quarantined",
      },
      auditFor(
        event,
        "FEED",
        "danger",
        "Reference frame quarantined",
        validation.reason,
      ),
    );
  }

  const fair = consensusFromBooks(books);
  const history = [...state.fairHistory, { atMs: event.atMs, fair }].filter(
    (frame) => event.atMs - frame.atMs <= policy.shockWindowMs,
  );
  const movement = history.length > 1 ? maxMovement(history[0].fair, fair) : 0;
  const confirmations = providerConfirmationCount(books, state.sourceBaselines);
  const sourceSequences = { ...state.sourceSequences };
  for (const book of books) {
    if (book.sequence !== undefined) sourceSequences[book.provider] = book.sequence;
  }

  let next: EngineState = {
    ...state,
    previousFair: state.fair,
    fair,
    fairHistory: history,
    latestBooks: books,
    lastOddsAtMs: event.atMs,
    sourceSequences,
  };

  if (state.quoteEpoch === 0 && state.status === "BOOTSTRAPPING") {
    next = {
      ...next,
      status: "QUOTING",
      reason: "Reference healthy; six deterministic paper quotes are active",
      quotedFair: fair,
      sourceBaselines: providerFairs(books),
      providerConfirmations: 0,
      openOrders: 6,
      quoteEpoch: 1,
    };
    return withAudit(
      next,
      auditFor(
        event,
        "EXECUTION",
        "healthy",
        "Six paper quotes placed",
        "A complete valid book produced six deterministic bid and ask orders.",
      ),
    );
  }

  if (state.status === "QUOTING") {
    const quoteMovement = maxMovement(state.quotedFair, fair);
    const shouldSuspend =
      movement >= policy.shockDelta &&
      quoteMovement >= policy.shockDelta &&
      confirmations >= policy.minimumConfirmations;

    if (shouldSuspend) {
      const suspendedQuotes = snapshotsFrom(
        state.quotedFair,
        state.inventory,
        state.quoteHalfSpread,
      );
      next = {
        ...next,
        status: "SUSPENDED",
        reason: "Two-provider consensus shock breached the 4pp policy",
        openOrders: 0,
        cancelledOrders: state.cancelledOrders + state.openOrders,
        holdUntilMs: event.atMs + policy.minimumSuspendMs,
        stableFrames: 0,
        stableDeltas: [],
        lastStableFair: null,
        providerConfirmations: confirmations,
        triggerMovement: movement,
        suspendedQuotes,
        proofStatus: "MOCK_PENDING",
      };
      return withAudit(
        next,
        auditFor(
          event,
          "AGENT",
          "danger",
          "Circuit breaker fired",
          `${confirmations} of ${books.length} providers confirmed a ${(movement * 100).toFixed(2)}pp move; CANCEL_ALL withdrew ${state.openOrders} orders.`,
        ),
      );
    }

    next = {
      ...next,
      providerConfirmations: confirmations,
      reason:
        confirmations === 1
          ? "Single-source divergence quarantined; guarded quotes remain active"
          : "Reference healthy; paper quotes remain active",
    };
    return withAudit(
      next,
      auditFor(
        event,
        confirmations === 1 ? "AGENT" : "FEED",
        confirmations === 1 ? "warning" : "neutral",
        confirmations === 1 ? "Outlier rejected by provider quorum" : event.title,
        confirmations === 1
          ? `Only 1 of ${books.length} sources diverged; consensus movement was ${(movement * 100).toFixed(2)}pp.`
          : event.detail,
      ),
    );
  }

  if (
    state.status === "SUSPENDED" ||
    state.status === "STALE" ||
    state.recoveryMode ||
    (state.status === "BOOTSTRAPPING" && state.quoteEpoch > 0)
  ) {
    next = processStableFrame(next, event, fair);
    return withAudit(
      next,
      auditFor(
        event,
        "AGENT",
        next.status === "REPRICING" ? "healthy" : "warning",
        next.status === "REPRICING" ? "Repricing conditions satisfied" : event.title,
        `${next.stableFrames} of ${policy.stableFramesRequired} stable observations derived from price deltas.`,
      ),
    );
  }

  return withAudit(next, auditFor(event, "FEED", "neutral"));
}

function processTimer(state: EngineState, event: ScenarioEvent) {
  const feedAge = state.lastOddsAtMs === null ? null : event.atMs - state.lastOddsAtMs;
  if (
    feedAge !== null &&
    feedAge > policy.staleAfterMs &&
    state.status !== "STALE" &&
    state.status !== "CLOSED"
  ) {
    const cancelled = state.openOrders;
    return withAudit(
      {
        ...state,
        status: "STALE",
        reason: `Feed age ${feedAge.toLocaleString()}ms exceeded the 2,500ms limit`,
        openOrders: 0,
        cancelledOrders: state.cancelledOrders + cancelled,
        stableFrames: 0,
        stableDeltas: [],
        lastStableFair: null,
        recoveryMode: true,
        holdUntilMs: null,
      },
      auditFor(
        event,
        "AGENT",
        "danger",
        "Feed timeout derived",
        `Feed age was ${feedAge.toLocaleString()}ms; ${cancelled} live paper orders were withdrawn.`,
      ),
    );
  }

  if (state.status === "REPRICING") {
    const baselines = state.latestBooks.length
      ? providerFairs(state.latestBooks)
      : state.sourceBaselines;
    return withAudit(
      {
        ...state,
        status: "QUOTING",
        reason: "Fresh replacement quotes are active",
        quotedFair: state.fair,
        sourceBaselines: baselines,
        openOrders: 6,
        quoteEpoch: state.quoteEpoch + 1,
        recoveryMode: false,
        holdUntilMs: null,
      },
      auditFor(
        event,
        "EXECUTION",
        "healthy",
        "Market reopened",
        "Freshness, hold and stability guards passed; six replacement paper orders were placed.",
      ),
    );
  }

  if (
    state.status === "SUSPENDED" &&
    state.stableFrames >= policy.stableFramesRequired &&
    state.scoreConfirmed &&
    (state.holdUntilMs === null || event.atMs >= state.holdUntilMs)
  ) {
    return withAudit(
      { ...state, status: "REPRICING", reason: "Hold expired; replacement quotes are ready" },
      auditFor(event, "AGENT", "healthy", "Hold and stability guards passed"),
    );
  }

  const boundaryDetail =
    feedAge === null
      ? "No valid odds frame has been accepted yet."
      : `Feed age is ${feedAge.toLocaleString()}ms; the limit is exceeded only above 2,500ms.`;
  return withAudit(
    state,
    auditFor(event, "AGENT", "neutral", "Freshness check passed", boundaryDetail),
  );
}

export function reduceEvent(state: EngineState, event: ScenarioEvent): EngineState {
  if (state.status === "CLOSED" || event.atMs < state.nowMs) return state;

  const next: EngineState = {
    ...state,
    nowMs: event.atMs,
    matchClock: event.clock,
    lastEvent: event,
  };

  if (event.kind === "SCORE_SNAPSHOT") {
    return withAudit(
      {
        ...next,
        score: event.score ?? next.score,
        scoreConfirmed: true,
        status: "BOOTSTRAPPING",
        reason: "Score known; waiting for a complete three-provider book",
      },
      auditFor(event, "FEED", "neutral"),
    );
  }

  if (event.kind === "ODDS_FRAME" || event.kind === "RECOVERY_FRAME") {
    return processOddsFrame(next, event);
  }

  if (event.kind === "GOAL_PENDING") {
    const newlyCancelled = state.openOrders;
    return withAudit(
      {
        ...next,
        status: "SUSPENDED",
        reason: "Material score event received; waiting for confirmation",
        openOrders: 0,
        cancelledOrders: state.cancelledOrders + newlyCancelled,
        holdUntilMs: event.atMs + policy.minimumSuspendMs,
        scoreConfirmed: false,
        stableFrames: 0,
        stableDeltas: [],
        lastStableFair: null,
        proofStatus: "MOCK_PENDING",
        suspendedQuotes:
          state.suspendedQuotes ??
          (state.openOrders
            ? snapshotsFrom(state.quotedFair, state.inventory, state.quoteHalfSpread)
            : null),
      },
      auditFor(
        event,
        "AGENT",
        "danger",
        "Goal guard active",
        newlyCancelled === 0
          ? "The market was already protected; no duplicate cancellation command was emitted."
          : `${newlyCancelled} live paper orders were cancelled.`,
      ),
    );
  }

  if (event.kind === "SCORE_CONFIRMED") {
    return withAudit(
      {
        ...next,
        score: event.score ?? next.score,
        status: "SUSPENDED",
        reason: "Score confirmed; minimum hold and stability checks are active",
        scoreConfirmed: true,
        holdUntilMs: event.atMs + policy.minimumSuspendMs,
      },
      auditFor(event, "FEED", "warning"),
    );
  }

  if (event.kind === "TIMER" || event.kind === "FEED_TIMEOUT") {
    return processTimer(next, event);
  }

  if (event.kind === "MOCK_PROOF") {
    return withAudit(
      { ...next, proofStatus: "MOCK_READY" },
      auditFor(event, "PROOF", "warning"),
    );
  }

  if (event.kind === "PARTIAL_FILL") {
    const outcome = event.outcome ?? "HOME";
    const quantity = event.quantity ?? 100;
    const price = event.price ?? 0.6412;
    return withAudit(
      {
        ...next,
        inventory: {
          ...state.inventory,
          [outcome]: state.inventory[outcome] + quantity,
        },
        cash: state.cash - quantity * price,
        reason: "Inventory-aware paper quotes are active",
      },
      auditFor(
        event,
        "EXECUTION",
        "neutral",
        "Paper fill applied",
        `${quantity} ${outcome} units filled at ${(price * 100).toFixed(2)}%.`,
      ),
    );
  }

  if (event.kind === "FULL_TIME") {
    return withAudit(
      {
        ...next,
        status: "CLOSED",
        reason: "Synthetic fixture completed",
        score: event.score ?? next.score,
        cancelledOrders: state.cancelledOrders + state.openOrders,
        openOrders: 0,
      },
      auditFor(event, "AGENT", "neutral"),
    );
  }

  return withAudit(next, auditFor(event, "FEED", "neutral"));
}

export function applyNextEvent(
  state: EngineState,
  events: readonly ScenarioEvent[] = scenario,
): EngineState {
  if (state.status === "CLOSED") return state;
  const nextCursor = state.cursor + 1;
  const event = events[nextCursor];
  if (!event) return state;
  return { ...reduceEvent(state, event), cursor: nextCursor };
}

export function quoteRows(state: EngineState): QuoteRow[] {
  const labels: Record<Outcome, string> = {
    HOME: "Aurora",
    DRAW: "Draw",
    AWAY: "Pacifica",
  };
  const active = state.status === "QUOTING";
  const snapshots = snapshotsFrom(state.quotedFair, state.inventory, state.quoteHalfSpread);

  return snapshots.map((snapshot) => ({
    outcome: snapshot.outcome,
    label: labels[snapshot.outcome],
    fair: state.fair[snapshot.outcome],
    bid: active ? snapshot.bid : null,
    ask: active ? snapshot.ask : null,
    quantity: snapshot.quantity,
    state: state.status === "CLOSED" ? "CLOSED" : active ? "OPEN" : "PROTECTED",
  }));
}

export function statusLabel(status: EngineStatus) {
  const labels: Record<EngineStatus, string> = {
    BOOTSTRAPPING: "BUILDING CONFIDENCE",
    QUOTING: "OPEN · GUARDED",
    SUSPENDED: "MARKET PROTECTED",
    REPRICING: "REPRICING",
    STALE: "FEED STALE · PROTECTED",
    CLOSED: "MATCH CLOSED",
  };
  return labels[status];
}
