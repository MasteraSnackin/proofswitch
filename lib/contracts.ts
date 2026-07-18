export type AppMode = "synthetic" | "live";
export type TxlineNetwork = "devnet" | "mainnet";
export type DataSource = "synthetic" | "txline";
export type MatchOutcome = "HOME" | "DRAW" | "AWAY";

export interface ApiSuccess<T> {
  data: T;
  mode: AppMode;
  source: DataSource;
  receivedAt: string;
}

export interface ApiFailure {
  error: {
    code: string;
    message: string;
  };
  mode?: AppMode;
}

export interface AppStatus {
  mode: AppMode;
  network: TxlineNetwork;
  liveConfigured: boolean;
  /** @deprecated Use liveConfigured; runtime health is observed after connecting. */
  liveReady: boolean;
  liveReadiness: {
    state: "ready" | "configuration_required" | "validation_optional";
    missing: string[];
    configured: string[];
    nextAction: string;
  };
  txline: {
    configured: boolean;
    origin: string;
    apiTokenPresent: boolean;
    guestAuthentication: "on-demand";
    preferredFixtureId: number | null;
  };
  solana: {
    network: TxlineNetwork;
    rpcConfigured: boolean;
    walletConfigured: boolean;
    simulationPayerConfigured: boolean;
    runtimeConfigured: boolean;
    validationEnabled: boolean;
    programId: string;
  };
  policy: {
    shockWindowMs: number;
    shockDelta: number;
    transportTimeoutMs: number;
    maximumPriceSilenceMs: number;
    maximumPriceSourceAgeMs: number;
    minimumSuspendMs: number;
    stableObservationsRequired: number;
    stableObservationDelta: number;
    maximumLiability: number;
    requoteDelta: number;
    minimumRequoteIntervalMs: number;
  };
  capabilities: {
    fixtures: boolean;
    odds: boolean;
    scores: boolean;
    streaming: boolean;
    paperExecution: boolean;
    onchainValidation: boolean;
  };
  limitations: string[];
}

export interface Fixture {
  fixtureId: number;
  fixtureGroupId: number | null;
  competitionId: number;
  competition: string;
  startTime: number;
  updatedAt: number;
  participant1IsHome: boolean;
  participant1: { id: number; name: string };
  participant2: { id: number; name: string };
  home: { id: number; name: string };
  away: { id: number; name: string };
}

export interface MatchWinnerOdds {
  fixtureId: number;
  messageId: string | null;
  ts: number;
  inRunning: boolean;
  gameState: string | null;
  source: {
    bookmaker: string | null;
    bookmakerId: number | null;
  };
  market: {
    superOddsType: string;
    period: string | null;
    parameters: string | null;
    priceNames: [string, string, string];
  };
  rawPct: Record<MatchOutcome, string>;
  probabilities: Record<MatchOutcome, number>;
}

export interface ScoreSnapshot {
  fixtureId: number;
  seq: number;
  id: string | number | null;
  ts: number;
  connectionId: string | null;
  dedupeKey: string;
  action: string | null;
  confirmed: boolean | null;
  finalised: boolean;
  statusId: number | null;
  gameState: string | null;
  score: {
    home: number | null;
    away: number | null;
  };
  redCards: {
    home: number | null;
    away: number | null;
  };
  participant1IsHome: boolean | null;
  coverage: {
    secondaryData: boolean | null;
    type: string | null;
  };
}

export interface StreamEnvelope<T> extends ApiSuccess<T> {
  eventId: string | null;
}
