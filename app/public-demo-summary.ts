import type { Fixture } from "../lib/contracts.ts";
import {
  activeLivePaperOrders,
  selectLivePaperRisk,
  type LiveEngineState,
} from "./live-engine.ts";

export const PUBLIC_DEMO_SUMMARY_SCHEMA =
  "proofswitch.public-demo-summary.v1" as const;
export const PUBLIC_DEMO_SUMMARY_VERSION = 1 as const;

export const PUBLIC_DEMO_TXLINE_BLOCK_MESSAGE =
  "Public demo summaries are synthetic-only. ProofSwitch will not create a public download from a TxLINE-derived session without explicit sponsor permission.";

export interface PublicDemoSummaryV1 {
  schema: typeof PUBLIC_DEMO_SUMMARY_SCHEMA;
  version: typeof PUBLIC_DEMO_SUMMARY_VERSION;
  classification: "synthetic-public-demo";
  integrity: "device-local-unsigned";
  generatedAt: string;
  run: {
    source: "synthetic";
    fixtureId: string;
    fixtureLabel: string;
    competition: string;
    scheduledStartTime: string;
    stateAt: string | null;
    scoreSequence: number | null;
  };
  agent: {
    decisionState: LiveEngineState["status"];
    quoteEpochs: number;
    retainedOrderRecords: number;
    openOrders: number;
    cancelledOrders: number;
    retainedPaperFillRecords: number;
    paperFillRejects: number;
    filledNotional: number;
    liability: number;
    maximumLiability: number;
    markToMarketPnl: number | null;
    settledPnl: number | null;
    currentMovementPp: number;
    stableObservations: number;
    rejectedEvents: number;
    emergencyStopEngaged: boolean;
  };
  policy: {
    shockDeltaPp: number;
    shockWindowMs: number;
    transportTimeoutMs: number;
    stableObservationsRequired: number;
    maximumLiability: number;
  };
  boundaries: {
    syntheticDataOnly: true;
    paperExecutionOnly: true;
    containsTxlineDerivedData: false;
    containsRawEventPayloads: false;
    containsPriceHistory: false;
    containsExecutableOrders: false;
    containsSolanaProof: false;
  };
  notices: readonly [string, string, string];
}

export interface PublicDemoSummaryInput {
  generatedAt: number;
  source: "synthetic" | "txline";
  fixture: Fixture;
  engine: LiveEngineState;
}

function isoTimestamp(value: number, label: string) {
  if (!Number.isFinite(value) || !Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer timestamp.`);
  }
  const timestamp = new Date(value);
  if (!Number.isFinite(timestamp.getTime())) {
    throw new RangeError(`${label} must be a valid timestamp.`);
  }
  return timestamp.toISOString();
}

function precise(value: number) {
  return Math.round(value * 1e10) / 1e10;
}

/**
 * Build a deliberately narrow, public-facing description of a synthetic run.
 *
 * This is separate from the private evidence pack. It contains aggregate agent
 * metrics and explicit capability boundaries, never event payloads, working
 * orders, a price series, TxLINE-derived data or a verification proof.
 */
export function buildPublicDemoSummary(
  input: PublicDemoSummaryInput,
): PublicDemoSummaryV1 {
  if (input.source !== "synthetic") {
    throw new RangeError(PUBLIC_DEMO_TXLINE_BLOCK_MESSAGE);
  }
  if (String(input.fixture.fixtureId) !== input.engine.fixtureId) {
    throw new RangeError(
      "The public demo fixture must match the synthetic agent session.",
    );
  }

  const risk = selectLivePaperRisk(input.engine);
  const generatedAt = isoTimestamp(input.generatedAt, "generatedAt");
  const scheduledStartTime = isoTimestamp(
    input.fixture.startTime,
    "fixture.startTime",
  );
  const stateAt = input.engine.nowMs > 0
    ? isoTimestamp(input.engine.nowMs, "engine.nowMs")
    : null;

  return {
    schema: PUBLIC_DEMO_SUMMARY_SCHEMA,
    version: PUBLIC_DEMO_SUMMARY_VERSION,
    classification: "synthetic-public-demo",
    integrity: "device-local-unsigned",
    generatedAt,
    run: {
      source: "synthetic",
      fixtureId: input.engine.fixtureId,
      fixtureLabel: `${input.fixture.home.name} v ${input.fixture.away.name}`,
      competition: input.fixture.competition || "Synthetic World Cup rehearsal",
      scheduledStartTime,
      stateAt,
      scoreSequence: input.engine.lastScoreSeq,
    },
    agent: {
      decisionState: input.engine.status,
      quoteEpochs: input.engine.quoteEpoch,
      retainedOrderRecords: input.engine.paperOrders.length,
      openOrders: activeLivePaperOrders(input.engine).length,
      cancelledOrders: input.engine.cancelledOrders,
      retainedPaperFillRecords: input.engine.paperFills.length,
      paperFillRejects: input.engine.paperFillRejects,
      filledNotional: risk.filledNotional,
      liability: risk.liability,
      maximumLiability: risk.maximumLiability,
      markToMarketPnl: risk.markToMarketPnl,
      settledPnl: risk.settledPnl,
      currentMovementPp: precise(input.engine.lastMovement * 100),
      stableObservations: input.engine.stableObservations,
      rejectedEvents: input.engine.rejectedEvents,
      emergencyStopEngaged: input.engine.emergencyStop !== null,
    },
    policy: {
      shockDeltaPp: precise(input.engine.policy.shockDelta * 100),
      shockWindowMs: input.engine.policy.shockWindowMs,
      transportTimeoutMs: input.engine.policy.transportTimeoutMs,
      stableObservationsRequired:
        input.engine.policy.stableObservationsRequired,
      maximumLiability: input.engine.policy.maximumLiability,
    },
    boundaries: {
      syntheticDataOnly: true,
      paperExecutionOnly: true,
      containsTxlineDerivedData: false,
      containsRawEventPayloads: false,
      containsPriceHistory: false,
      containsExecutableOrders: false,
      containsSolanaProof: false,
    },
    notices: [
      "Synthetic rehearsal only; this summary is not evidence of a live TxLINE run.",
      "Paper execution only; no transaction, bet or market order was submitted.",
      "No TxLINE-derived data, raw event payloads, price history or Solana proof is included.",
    ],
  };
}
