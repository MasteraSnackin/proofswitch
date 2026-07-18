"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
} from "react";
import type {
  ApiFailure,
  ApiSuccess,
  AppStatus,
  Fixture,
  MatchWinnerOdds,
  ScoreSnapshot,
  StreamEnvelope,
} from "../lib/contracts";
import {
  activeLivePaperOrders,
  createDeterministicPaperFillEvent,
  createLiveEngineState,
  liveQuoteRows,
  remainingLivePaperOrderQuantity,
  reduceLiveEngineEvent,
  selectLivePaperRisk,
  selectLiveEngineHealth,
  type LiveEngineEvent,
  type LiveEngineState,
  type LiveHeartbeatEvent,
  type LiveOddsEvent,
  type LiveScoreEvent,
  type LiveTransportChannel,
} from "./live-engine";
import {
  PAPER_SESSION_STORAGE_KEY,
  clearPaperSession,
  decodePaperSession,
  readPaperSession,
  serialisePaperSession,
  writePaperSession,
  type PaperSessionFixture,
  type PaperSessionRetention,
  type PaperSessionV1,
} from "./live-session";
import {
  SCORE_PROOF_STAT_KEYS,
  buildLiveEvidencePack,
  parseLiveProofResult,
  scoreProofStatLabel,
  serialiseLiveEvidencePack,
  type LiveProofResult,
} from "./live-evidence";
import {
  PUBLIC_DEMO_TXLINE_BLOCK_MESSAGE,
  buildPublicDemoSummary,
  type PublicDemoSummaryV1,
} from "./public-demo-summary";

type ConnectionPhase =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "failed";

type RuntimeScoreSnapshot = ScoreSnapshot;

type ProofRequestFailure = Omit<LiveProofResult, "state"> & {
  state: "REQUEST_FAILED";
};

type DisplayedProof = LiveProofResult | ProofRequestFailure;

type StreamChannelState = { odds: boolean; scores: boolean };

type StreamContractFailure = {
  code?: unknown;
  channel?: unknown;
};

type OperatorAccessStatus = {
  required: boolean;
  configured: boolean;
  authenticated: boolean;
  expiresAt: string | null;
};

type LocalSessionState =
  | "empty"
  | "saved"
  | "recovered"
  | "foreign-network"
  | "invalid"
  | "unavailable";

type EvidenceExportPreview = {
  contents: string;
  filename: string;
  checksum: string;
  source: "synthetic" | "txline";
  fixtureId: string;
  scoreSequence: number | null;
  decisionState: LiveEngineState["status"];
  cancelledOrders: number;
  orderRecords: number;
  fillRecords: number;
  commandRecords: number;
  auditRecords: number;
  auditTruncated: number;
  byteLength: number;
  proofState: string;
  savedRevision: number | null;
};

type PublicDemoSummaryPreview = {
  contents: string;
  filename: string;
  checksum: string;
  byteLength: number;
  summary: PublicDemoSummaryV1;
};

type PreflightTone = "pass" | "warn" | "fail" | "pending";

type PreflightCheck = {
  id: string;
  label: string;
  detail: string;
  tone: PreflightTone;
};

type TimelineItem = {
  id: string;
  atMs: number;
  clock: string;
  source: string;
  title: string;
  detail: string;
  tone: "neutral" | "healthy" | "warning" | "danger";
};

const liveStatusTone: Record<LiveEngineState["status"], string> = {
  BOOTSTRAPPING: "info",
  QUOTING: "healthy",
  SUSPENDED: "danger",
  STALE: "danger",
  CLOSED: "neutral",
};

const connectionLabels: Record<ConnectionPhase, string> = {
  idle: "Disconnected",
  connecting: "Connecting",
  connected: "Streaming",
  reconnecting: "Reconnecting",
  failed: "Connection failed",
};

function clockLabel(timestamp: number) {
  return new Date(timestamp).toISOString().slice(11, 23);
}

function probability(value: number | null) {
  return value === null ? "—" : `${(value * 100).toFixed(2)}%`;
}

function fixtureDateLabel(startTime: number) {
  return new Date(startTime).toLocaleString("en-GB", {
    timeZone: "Europe/London",
    timeZoneName: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fixtureLifecycleLabel(startTime: number, now = Date.now()) {
  const delta = startTime - now;
  if (delta >= -15 * 60_000 && delta <= 4 * 60 * 60_000) return "live window";
  if (delta > 0) {
    const minutes = Math.max(1, Math.round(delta / 60_000));
    if (minutes < 60) return `starts in ${minutes}m`;
    if (minutes < 48 * 60) return `starts in ${Math.round(minutes / 60)}h`;
    return `starts in ${Math.round(minutes / 1_440)}d`;
  }
  const minutesAgo = Math.max(1, Math.round(Math.abs(delta) / 60_000));
  if (minutesAgo < 60) return `started ${minutesAgo}m ago`;
  if (minutesAgo < 48 * 60) return `started ${Math.round(minutesAgo / 60)}h ago`;
  return `started ${Math.round(minutesAgo / 1_440)}d ago`;
}

function timestampLabel(timestamp: number) {
  const date = new Date(timestamp);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString("en-GB", { timeZoneName: "short" })
    : String(timestamp);
}

function formatDuration(ms: number | null) {
  if (ms === null) return "Not observed";
  if (ms < 1_000) return `${Math.max(0, Math.round(ms))}ms`;
  return `${(ms / 1_000).toFixed(2)}s`;
}

function preflightToneLabel(tone: PreflightTone) {
  return tone === "pass"
    ? "Pass"
    : tone === "warn"
      ? "Review"
      : tone === "fail"
        ? "Blocked"
        : "Pending";
}

function setupTemplate(status: AppStatus | null) {
  const network = status?.network ?? "devnet";
  const origin = status?.txline.origin ?? "https://txline-dev.txodds.com";
  const programId =
    status?.solana.programId ?? "6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J";
  return [
    "PROOFSWITCH_MODE=live",
    `TXLINE_NETWORK=${network}`,
    `TXLINE_API_ORIGIN=${origin}`,
    "TXLINE_API_TOKEN=<activated sponsor token>",
    "PROOFSWITCH_ACCESS_CODE=<judge or operator code>",
    "PROOFSWITCH_ACCESS_SIGNING_SECRET=<32+ character random server secret>",
    "SOLANA_VALIDATION_ENABLED=false",
    "SOLANA_SIMULATION_PAYER_PUBLIC_KEY=<public devnet payer address, optional>",
    `TXLINE_PROGRAM_ID=${programId}`,
  ].join("\n");
}

function browserId(prefix: string) {
  const value = globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${value}`;
}

function fixtureForSession(fixture: Fixture): PaperSessionFixture {
  return {
    fixtureId: fixture.fixtureId,
    competition: fixture.competition || "World Cup feed",
    startTime: fixture.startTime,
    home: { ...fixture.home },
    away: { ...fixture.away },
  };
}

function downloadText(contents: string, filename: string) {
  const href = URL.createObjectURL(
    new Blob([contents], { type: "application/json" }),
  );
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(href);
}

async function sha256(contents: string) {
  if (!globalThis.crypto?.subtle) {
    throw new Error("This browser does not provide the Web Crypto checksum API.");
  }
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(contents),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function apiError(payload: unknown, fallback: string) {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "error" in payload &&
    typeof (payload as ApiFailure).error?.message === "string"
  ) {
    return (payload as ApiFailure).error.message;
  }
  return fallback;
}

async function fetchData<T>(url: string, signal?: AbortSignal) {
  const response = await fetch(url, { cache: "no-store", signal });
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`The local API returned non-JSON data for ${url}.`);
  }
  if (!response.ok) {
    throw new Error(apiError(payload, `The local API returned HTTP ${response.status}.`));
  }
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("data" in payload)
  ) {
    throw new Error(`The local API returned an invalid response for ${url}.`);
  }
  return (payload as ApiSuccess<T>).data;
}

function streamData<T>(event: MessageEvent<string>) {
  const payload = JSON.parse(event.data) as T | StreamEnvelope<T>;
  if (typeof payload === "object" && payload !== null && "data" in payload) {
    const envelope = payload as StreamEnvelope<T>;
    return { data: envelope.data, eventId: envelope.eventId ?? (event.lastEventId || null) };
  }
  return { data: payload as T, eventId: event.lastEventId || null };
}

function oddsEvent(
  snapshot: MatchWinnerOdds,
  receivedAt: number,
  eventId?: string | null,
): LiveOddsEvent {
  const snapshotIdentity = [
    "snapshot",
    snapshot.fixtureId,
    snapshot.ts,
    snapshot.market.superOddsType,
    snapshot.source.bookmakerId ?? "stable",
  ].join(":");
  return {
    kind: "ODDS",
    fixtureId: String(snapshot.fixtureId),
    messageId: snapshot.messageId?.trim() || snapshotIdentity,
    sseId: eventId || undefined,
    priceTsMs: snapshot.ts,
    pct: snapshot.probabilities,
    inRunning: snapshot.inRunning,
    gameState: snapshot.gameState,
    atMs: receivedAt,
    clock: clockLabel(receivedAt),
  };
}

function scoreEvent(
  snapshot: RuntimeScoreSnapshot,
  receivedAt: number,
): LiveScoreEvent {
  return {
    kind: "SCORE",
    fixtureId: String(snapshot.fixtureId),
    seq: snapshot.seq,
    scoreTsMs: snapshot.ts,
    score: { home: snapshot.score.home, away: snapshot.score.away },
    redCards: {
      home: snapshot.redCards.home,
      away: snapshot.redCards.away,
    },
    action: snapshot.action ?? undefined,
    confirmed: snapshot.confirmed,
    finalised:
      snapshot.finalised === true ||
      snapshot.action?.toLowerCase().replace(/[\s-]+/g, "_") === "game_finalised",
    atMs: receivedAt,
    clock: clockLabel(receivedAt),
  };
}

function selectInitialFixture(
  fixtures: Fixture[],
  preferredFixtureId: number | null | undefined,
  now = Date.now(),
) {
  const preferred = preferredFixtureId === null || preferredFixtureId === undefined
    ? undefined
    : fixtures.find((fixture) => fixture.fixtureId === preferredFixtureId);
  if (preferred) return preferred;

  const worldCupFixtures = fixtures.filter((fixture) =>
    /world\s*cup/i.test(fixture.competition),
  );
  const candidates = worldCupFixtures.length > 0 ? worldCupFixtures : fixtures;

  const active = candidates
    .filter(
      (fixture) =>
        now >= fixture.startTime - 15 * 60_000 &&
        now <= fixture.startTime + 4 * 60 * 60_000,
    )
    .sort((left, right) => right.startTime - left.startTime)[0];
  if (active) return active;

  const upcoming = candidates
    .filter((fixture) => fixture.startTime > now)
    .sort((left, right) => left.startTime - right.startTime)[0];
  if (upcoming) return upcoming;

  return [...candidates].sort((left, right) => right.startTime - left.startTime)[0];
}

function heartbeatEvent(
  fixtureId: number,
  channel: LiveTransportChannel,
  receivedAt: number,
  sseId?: string,
): LiveHeartbeatEvent {
  return {
    kind: "HEARTBEAT",
    fixtureId: String(fixtureId),
    channel,
    atMs: receivedAt,
    clock: clockLabel(receivedAt),
    sseId,
  };
}

export default function LiveDashboard({ onSelectDemo }: { onSelectDemo: () => void }) {
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [fixtures, setFixtures] = useState<Fixture[]>([]);
  const [fixtureError, setFixtureError] = useState<string | null>(null);
  const [fixturesLoading, setFixturesLoading] = useState(true);
  const [fixtureReload, setFixtureReload] = useState(0);
  const [selectedFixtureId, setSelectedFixtureId] = useState("");
  const [connectionPhase, setConnectionPhase] = useState<ConnectionPhase>("idle");
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [snapshotWarning, setSnapshotWarning] = useState<string | null>(null);
  const [channelOpen, setChannelOpen] = useState<StreamChannelState>({
    odds: false,
    scores: false,
  });
  const [engine, setEngine] = useState<LiveEngineState | null>(null);
  const [proof, setProof] = useState<DisplayedProof | null>(null);
  const [proofLoading, setProofLoading] = useState(false);
  const [localSessionState, setLocalSessionState] = useState<LocalSessionState>("empty");
  const [localSessionMessage, setLocalSessionMessage] = useState(
    "No live paper session is stored on this device.",
  );
  const [storedSession, setStoredSession] = useState<PaperSessionV1 | null>(null);
  const [sessionFixture, setSessionFixture] = useState<PaperSessionFixture | null>(null);
  const [storageLocked, setStorageLocked] = useState(false);
  const [pipelineRehearsal, setPipelineRehearsal] = useState(false);
  const [evidencePreview, setEvidencePreview] = useState<EvidenceExportPreview | null>(null);
  const [evidencePreparing, setEvidencePreparing] = useState(false);
  const [evidenceDownloadStatus, setEvidenceDownloadStatus] = useState("");
  const [publicSummaryPreview, setPublicSummaryPreview] =
    useState<PublicDemoSummaryPreview | null>(null);
  const [publicSummaryBlocked, setPublicSummaryBlocked] = useState<string | null>(null);
  const [publicSummaryPreparing, setPublicSummaryPreparing] = useState(false);
  const [publicSummaryDownloadStatus, setPublicSummaryDownloadStatus] = useState("");
  const [fixtureQueueNow, setFixtureQueueNow] = useState(0);
  const [operatorAccess, setOperatorAccess] = useState<OperatorAccessStatus | null>(null);
  const [operatorAccessCode, setOperatorAccessCode] = useState("");
  const [operatorAccessLoading, setOperatorAccessLoading] = useState(true);
  const [operatorAccessError, setOperatorAccessError] = useState<string | null>(null);
  const [preflightChecks, setPreflightChecks] = useState<PreflightCheck[]>([]);
  const [preflightRunning, setPreflightRunning] = useState(false);
  const [judgeModeLaunchPending, setJudgeModeLaunchPending] = useState(false);
  const [demoBundleStatus, setDemoBundleStatus] = useState("");
  const engineRef = useRef<LiveEngineState | null>(null);
  const streamsRef = useRef<{ odds: EventSource | null; scores: EventSource | null }>({
    odds: null,
    scores: null,
  });
  const channelOpenRef = useRef<StreamChannelState>({ odds: false, scores: false });
  const sessionGenerationRef = useRef(0);
  const snapshotControllerRef = useRef<AbortController | null>(null);
  const proofControllerRef = useRef<AbortController | null>(null);
  const proofRequestIdRef = useRef(0);
  const sessionLoadedRef = useRef(false);
  const sessionIdRef = useRef(browserId("session"));
  const writerIdRef = useRef(browserId("tab"));
  const sessionRevisionRef = useRef(0);
  const sessionRetentionBaselineRef = useRef<PaperSessionRetention | null>(null);
  const sessionFixtureRef = useRef<PaperSessionFixture | null>(null);
  const sessionNetworkRef = useRef<AppStatus["network"] | null>(null);
  const sessionSaveTimerRef = useRef<number | null>(null);
  const lastSessionSaveAtRef = useRef(0);
  const clearDialogRef = useRef<HTMLDialogElement>(null);
  const clearDialogTriggerRef = useRef<HTMLButtonElement>(null);
  const replaceDialogRef = useRef<HTMLDialogElement>(null);
  const replaceDialogTriggerRef = useRef<HTMLButtonElement>(null);
  const evidenceExportDialogRef = useRef<HTMLDialogElement>(null);
  const evidenceExportTriggerRef = useRef<HTMLButtonElement>(null);
  const publicSummaryDialogRef = useRef<HTMLDialogElement>(null);
  const publicSummaryTriggerRef = useRef<HTMLButtonElement>(null);
  const emergencyStopDialogRef = useRef<HTMLDialogElement>(null);
  const emergencyStopTriggerRef = useRef<HTMLButtonElement>(null);
  const connectRef = useRef<((replacementConfirmed?: boolean) => Promise<void>) | null>(null);

  const liveConfigured = status?.liveConfigured === true && status.mode === "live";
  const operatorAccessReady =
    !liveConfigured ||
    (operatorAccess !== null &&
      (!operatorAccess.required || operatorAccess.authenticated));
  const operatorAccessLocked =
    liveConfigured &&
    (operatorAccessLoading || operatorAccess === null ||
      (operatorAccess.required && !operatorAccess.authenticated));
  const pipelineEnabled = (liveConfigured && operatorAccessReady) || pipelineRehearsal;
  const runtimeSource = pipelineRehearsal ? "synthetic" : "txline";
  const preferredFixtureId = status?.txline.preferredFixtureId;
  const selectedFixture = fixtures.find(
    (fixture) => String(fixture.fixtureId) === selectedFixtureId,
  );
  const engineFixture = engine
    ? fixtures.find((fixture) => String(fixture.fixtureId) === engine.fixtureId)
    : undefined;
  const proofFixture = engineFixture ?? selectedFixture;
  const displayFixture = engineFixture ?? (engine ? sessionFixture : null) ?? selectedFixture;
  const fixtureGroups = useMemo(() => {
    const ordered = [...fixtures].sort((left, right) => left.startTime - right.startTime);
    return {
      worldCup: ordered.filter((fixture) => /world\s*cup/i.test(fixture.competition)),
      other: ordered.filter((fixture) => !/world\s*cup/i.test(fixture.competition)),
    };
  }, [fixtures]);
  const fixtureQueue = useMemo(() => {
    const queueSource =
      fixtureGroups.worldCup.length > 0 ? fixtureGroups.worldCup : fixtures;
    const ordered = [...queueSource].sort((left, right) => left.startTime - right.startTime);
    return {
      live: ordered.filter(
        (fixture) =>
          fixtureQueueNow >= fixture.startTime - 15 * 60_000 &&
          fixtureQueueNow <= fixture.startTime + 4 * 60 * 60_000,
      ),
      upcoming: ordered.filter((fixture) => fixture.startTime > fixtureQueueNow + 15 * 60_000),
      earlier: ordered
        .filter((fixture) => fixture.startTime < fixtureQueueNow - 4 * 60 * 60_000)
        .reverse(),
    };
  }, [fixtureGroups.worldCup, fixtures, fixtureQueueNow]);
  const quotes = useMemo(() => (engine ? liveQuoteRows(engine) : []), [engine]);
  const activeOrders = useMemo(
    () => (engine ? activeLivePaperOrders(engine) : []),
    [engine],
  );
  const health = useMemo(() => (engine ? selectLiveEngineHealth(engine) : null), [engine]);
  const paperRisk = useMemo(() => (engine ? selectLivePaperRisk(engine) : null), [engine]);
  const engineActive = engine !== null && engine.status !== "CLOSED";
  const openQuotedQuantity = engine
    ? activeOrders.reduce(
        (sum, order) => sum + remainingLivePaperOrderQuantity(engine, order.id),
        0,
      )
    : 0;
  const connectDisabledReason = !pipelineEnabled
    ? "Live path is unavailable until credentials are configured, or run the synthetic pipeline rehearsal."
    : fixturesLoading
      ? "Fixture catalogue is still loading."
      : !selectedFixtureId
        ? "Select a covered fixture first."
        : !pipelineRehearsal && storageLocked
          ? "Device-local evidence storage is locked. Export or clear the current session before connecting."
          : !pipelineRehearsal && storedSession
            ? "A saved paper session exists. You will be asked to export or replace it before connecting."
            : null;
  const fillDisabledReason =
    engine?.status === "QUOTING"
      ? null
      : "A deterministic fill can only be applied while paper quotes are open.";
  const proofDisabledReason = !engine
    ? "Connect or run a fixture before requesting proof evidence."
    : !engine.lastScoreSeq
      ? "A score sequence has not been observed yet."
      : proofLoading
        ? "A proof request is already running."
        : null;
  const evidenceDisabledReason = !engine
    ? "Connect or run a fixture before exporting evidence."
    : !status
      ? "Application status is still loading."
      : evidencePreparing
        ? "Evidence export is already being prepared."
        : null;
  const publicSummaryDisabledReason = !engine
    ? "Run a synthetic rehearsal before creating a public summary."
    : !status
      ? "Application status is still loading."
      : runtimeSource !== "synthetic"
        ? "Public summaries are blocked for TxLINE-derived sessions."
        : publicSummaryPreparing
          ? "Public summary is already being prepared."
          : null;
  const emergencyStopDisabledReason = !engine
    ? "No active paper session exists."
    : engine.status === "CLOSED"
      ? "This paper session is already closed."
      : engine.emergencyStop
        ? "The emergency stop is already latched."
        : null;
  const scorecard = useMemo(() => {
    const firstAudit = engine?.audit[0]?.atMs ?? null;
    const firstProtection = engine?.audit.find((entry) =>
      /Circuit breaker|Goal guard|Feed timeout|cancel/i.test(`${entry.title} ${entry.detail}`),
    )?.atMs ?? null;
    const firstReopen = engine?.audit.find((entry) =>
      /reopen|quote/i.test(entry.title) && /open|placed|released/i.test(`${entry.title} ${entry.detail}`),
    )?.atMs ?? null;
    return {
      suspendLatency:
        firstAudit !== null && firstProtection !== null
          ? Math.max(0, firstProtection - firstAudit)
          : null,
      reopenDelay:
        firstProtection !== null && firstReopen !== null
          ? Math.max(0, firstReopen - firstProtection)
          : null,
      cancelledOrders: engine?.cancelledOrders ?? 0,
      rejectedFills: engine?.paperFillRejects ?? 0,
      pnl: paperRisk?.markToMarketPnl ?? null,
      proofState: proof?.state ?? "NOT_REQUESTED",
    };
  }, [engine, paperRisk?.markToMarketPnl, proof?.state]);
  const timelineItems = useMemo<TimelineItem[]>(() => {
    if (!engine) return [];
    const auditItems: TimelineItem[] = engine.audit.map((entry) => ({
      id: `audit-${entry.id}`,
      atMs: entry.atMs,
      clock: entry.clock,
      source: entry.source === "FEED" && pipelineRehearsal ? "REHEARSAL" : entry.source,
      title: entry.title,
      detail: entry.detail,
      tone: entry.tone,
    }));
    const commandItems: TimelineItem[] = engine.executionCommands.slice(-8).map((command) => ({
      id: `command-${command.id}`,
      atMs: command.atMs,
      clock: clockLabel(command.atMs),
      source: "COMMAND",
      title: command.kind.replaceAll("_", " "),
      detail: `${command.orderIds.length} paper orders affected.`,
      tone: command.kind === "CANCEL_ALL" ? "warning" : "healthy",
    }));
    const fillItems: TimelineItem[] = engine.paperFills.slice(-8).map((fill) => ({
      id: `fill-${fill.id}`,
      atMs: fill.atMs,
      clock: clockLabel(fill.atMs),
      source: "FILL",
      title: `${fill.side} paper fill`,
      detail: `${fill.quantity.toFixed(2)} units on ${fill.outcome} at ${(fill.price * 100).toFixed(2)}%.`,
      tone: "healthy",
    }));
    return [...auditItems, ...commandItems, ...fillItems]
      .sort((left, right) => left.atMs - right.atMs || left.id.localeCompare(right.id))
      .slice(-18);
  }, [engine, pipelineRehearsal]);

  const closeStreams = useCallback(() => {
    streamsRef.current.odds?.close();
    streamsRef.current.scores?.close();
    streamsRef.current = { odds: null, scores: null };
  }, []);

  const persistEngineState = useCallback((
    state: LiveEngineState,
    options: { replaceSession?: boolean; quiet?: boolean } = {},
  ) => {
    const fixture = sessionFixtureRef.current;
    const network = sessionNetworkRef.current;
    if (!fixture || !network || storageLocked || pipelineRehearsal) return null;
    const result = writePaperSession(
      window.localStorage,
      {
        sessionId: sessionIdRef.current,
        writerId: writerIdRef.current,
        savedAtMs: Math.max(Date.now(), state.nowMs),
        network,
        fixture,
        engine: state,
        priorRetention: sessionRetentionBaselineRef.current ?? undefined,
      },
      {
        expectedRevision: sessionRevisionRef.current,
        replaceSession: options.replaceSession,
      },
    );
    if (result.status === "saved") {
      sessionRevisionRef.current = result.session.revision;
      if (!options.quiet) {
        setStoredSession(result.session);
        setLocalSessionState("saved");
        setLocalSessionMessage(
          `Saved locally at ${new Date(result.session.savedAtMs).toLocaleTimeString("en-GB")}.`,
        );
      }
      return result.session;
    }
    if (!options.quiet) {
      setLocalSessionState(result.status === "unavailable" ? "unavailable" : "invalid");
      setLocalSessionMessage(result.message);
    }
    setStorageLocked(true);
    return null;
  }, [pipelineRehearsal, storageLocked]);

  const dispatch = useCallback((event: LiveEngineEvent, expectedGeneration?: number) => {
    if (
      expectedGeneration !== undefined &&
      sessionGenerationRef.current !== expectedGeneration
    ) {
      return null;
    }
    const current = engineRef.current;
    if (!current) return null;
    const next = reduceLiveEngineEvent(current, event);
    engineRef.current = next;
    setEngine(next);

    if (next.lastScoreSeq !== current.lastScoreSeq) {
      proofRequestIdRef.current += 1;
      proofControllerRef.current?.abort();
      proofControllerRef.current = null;
      setProof(null);
      setProofLoading(false);
    }
    return next;
  }, []);

  const endCurrentSession = useCallback((reason: string) => {
    const current = engineRef.current;
    if (!current || current.status === "CLOSED") return current;
    const atMs = Math.max(Date.now(), current.nowMs);
    const next = dispatch({
      kind: "SESSION_END",
      fixtureId: current.fixtureId,
      reason,
      atMs,
      clock: clockLabel(atMs),
    });
    if (next) persistEngineState(next);
    return next;
  }, [dispatch, persistEngineState]);

  const terminateSession = useCallback((
    reason: string,
    phase: ConnectionPhase,
    error: string | null,
  ) => {
    // The reducer emits CANCEL_ALL synchronously before either transport is released.
    endCurrentSession(reason);
    sessionGenerationRef.current += 1;
    snapshotControllerRef.current?.abort();
    snapshotControllerRef.current = null;
    proofRequestIdRef.current += 1;
    proofControllerRef.current?.abort();
    proofControllerRef.current = null;
    closeStreams();
    channelOpenRef.current = { odds: false, scores: false };
    setChannelOpen({ odds: false, scores: false });
    setConnectionPhase(phase);
    setConnectionError(error);
    setSnapshotWarning(null);
    setProofLoading(false);
  }, [closeStreams, endCurrentSession]);

  useEffect(() => {
    const update = () => setFixtureQueueNow(Date.now());
    update();
    const timer = window.setInterval(update, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/status", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = (await response.json()) as AppStatus | ApiSuccess<AppStatus> | ApiFailure;
        if (!response.ok) throw new Error(apiError(payload, `Status endpoint returned ${response.status}.`));
        return typeof payload === "object" && payload !== null && "data" in payload
          ? (payload as ApiSuccess<AppStatus>).data
          : (payload as AppStatus);
      })
      .then(setStatus)
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setStatusError(error instanceof Error ? error.message : "Status request failed.");
        }
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/access", {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload: unknown = await response.json();
        if (!response.ok) {
          throw new Error(apiError(payload, `Access endpoint returned ${response.status}.`));
        }
        if (
          typeof payload !== "object" ||
          payload === null ||
          !("data" in payload) ||
          typeof (payload as { data?: unknown }).data !== "object" ||
          (payload as { data: unknown }).data === null
        ) {
          throw new Error("The operator access endpoint returned an invalid response.");
        }
        return (payload as { data: OperatorAccessStatus }).data;
      })
      .then((access) => {
        setOperatorAccess(access);
        setOperatorAccessError(null);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setOperatorAccessError(
            error instanceof Error ? error.message : "Operator access check failed.",
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setOperatorAccessLoading(false);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!status || sessionLoadedRef.current) return;
    const timer = window.setTimeout(() => {
      if (sessionLoadedRef.current) return;
      sessionLoadedRef.current = true;
      sessionNetworkRef.current = status.network;
      const result = readPaperSession(window.localStorage, status.network);
      if (result.status === "empty") return;
      if (result.status === "unavailable") {
        setLocalSessionState("unavailable");
        setLocalSessionMessage(result.message);
        setStorageLocked(true);
        return;
      }
      if (result.status === "network-mismatch") {
        setStoredSession(result.session);
        setLocalSessionState("foreign-network");
        setLocalSessionMessage(
          `Stored session uses ${result.session.scope.network}; the configured runtime uses ${status.network}. It was not activated.`,
        );
        return;
      }
      if (result.status !== "ready") {
        setLocalSessionState("invalid");
        setLocalSessionMessage(result.message);
        setStorageLocked(true);
        return;
      }

      const recovered = result.session;
      sessionIdRef.current = recovered.sessionId;
      sessionRevisionRef.current = recovered.revision;
      sessionRetentionBaselineRef.current = { ...recovered.retention };
      sessionFixtureRef.current = recovered.scope.fixture;
      setSessionFixture(recovered.scope.fixture);
      setSelectedFixtureId(String(recovered.scope.fixture.fixtureId));
      const atMs = Math.max(Date.now(), recovered.engine.nowMs);
      const protectedEngine = recovered.engine.status === "CLOSED"
        ? recovered.engine
        : reduceLiveEngineEvent(recovered.engine, {
            kind: "SESSION_END",
            fixtureId: recovered.engine.fixtureId,
            reason: "Recovered device-local session was protected before activation",
            atMs,
            clock: clockLabel(atMs),
          });
      engineRef.current = protectedEngine;
      setEngine(protectedEngine);
      setConnectionPhase("idle");
      const saved = persistEngineState(protectedEngine, { quiet: true });
      if (saved) {
        setStoredSession(saved);
        setLocalSessionState("recovered");
        setLocalSessionMessage(
          `Recovered and protected. Last stored ${new Date(recovered.savedAtMs).toLocaleString("en-GB")}; no stream was resumed.`,
        );
      } else {
        setStoredSession({ ...recovered, engine: protectedEngine });
        setStorageLocked(true);
        setLocalSessionState("unavailable");
        setLocalSessionMessage(
          "Recovered and closed in memory, but the terminal state could not be saved. The stored record was not changed; export it, then clear it before starting another live session.",
        );
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [persistEngineState, status]);

  useEffect(() => {
    if (!engine || !sessionFixture || storageLocked) return;
    if (sessionSaveTimerRef.current !== null) return;
    const delay = Math.max(0, 750 - (Date.now() - lastSessionSaveAtRef.current));
    sessionSaveTimerRef.current = window.setTimeout(() => {
      const current = engineRef.current;
      if (current) persistEngineState(current);
      lastSessionSaveAtRef.current = Date.now();
      sessionSaveTimerRef.current = null;
    }, delay);
  }, [engine, persistEngineState, sessionFixture, storageLocked]);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== PAPER_SESSION_STORAGE_KEY || event.storageArea !== window.localStorage) {
        return;
      }
      if (pipelineRehearsal) return;

      const decoded = event.newValue === null
        ? null
        : decodePaperSession(event.newValue);
      const foreignSession = decoded?.status === "ready" &&
        decoded.session.writerId !== writerIdRef.current &&
        decoded.session.revision >= sessionRevisionRef.current
          ? decoded.session
          : null;
      const activeRecordRemoved = event.newValue === null && engineRef.current !== null;
      const activeRecordInvalid = event.newValue !== null && decoded?.status !== "ready";
      if (!foreignSession && !activeRecordRemoved && !activeRecordInvalid) return;

      if (foreignSession) setStoredSession(foreignSession);
      setStorageLocked(true);
      setLocalSessionState("invalid");
      setLocalSessionMessage(
        foreignSession
          ? "An equal or newer paper-session revision was written by another tab. This tab was protected and made read-only."
          : "The device-local paper-session record changed outside this tab. This tab was protected and made read-only.",
      );
      terminateSession(
        "The device-local evidence record changed in another tab",
        "failed",
        "Another tab changed the saved paper session. Export or clear the current record before starting again here.",
      );
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [pipelineRehearsal, terminateSession]);

  useEffect(() => {
    if (!pipelineEnabled) return;
    const controller = new AbortController();
    fetchData<Fixture[]>(`/api/fixtures?mode=${runtimeSource}`, controller.signal)
      .then((rows) => {
        setFixtures(rows);
        if (rows.length === 0) {
          setFixtureError("The configured network returned no covered fixtures.");
        }
        setSelectedFixtureId((current) => {
          if (current && rows.some((fixture) => String(fixture.fixtureId) === current)) {
            return current;
          }
          return String(selectInitialFixture(rows, preferredFixtureId)?.fixtureId ?? "");
        });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setFixtureError(error instanceof Error ? error.message : "Fixture catalogue failed.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setFixturesLoading(false);
      });
    return () => controller.abort();
  }, [fixtureReload, pipelineEnabled, preferredFixtureId, runtimeSource]);

  useEffect(() => {
    if (
      !judgeModeLaunchPending ||
      !pipelineRehearsal ||
      fixturesLoading ||
      !selectedFixtureId ||
      connectionPhase !== "idle"
    ) {
      return;
    }
    const timer = window.setTimeout(() => {
      setJudgeModeLaunchPending(false);
      void connectRef.current?.(false);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [
    judgeModeLaunchPending,
    pipelineRehearsal,
    fixturesLoading,
    selectedFixtureId,
    connectionPhase,
  ]);

  useEffect(() => {
    if (!engineActive || connectionPhase === "idle" || connectionPhase === "failed") return;
    const timer = window.setInterval(() => {
      const atMs = Date.now();
      dispatch({ kind: "TIMER", atMs, clock: clockLabel(atMs) });
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [connectionPhase, dispatch, engineActive]);

  useEffect(() => {
    const protectAndFlush = () => {
      const current = engineRef.current;
      if (current && current.status !== "CLOSED") {
        const atMs = Math.max(Date.now(), current.nowMs);
        const protectedEngine = reduceLiveEngineEvent(current, {
          kind: "SESSION_END",
          fixtureId: current.fixtureId,
          reason: "Live control room left or page hidden",
          atMs,
          clock: clockLabel(atMs),
        });
        engineRef.current = protectedEngine;
        persistEngineState(protectedEngine, { quiet: true });
      }
      if (sessionSaveTimerRef.current !== null) {
        window.clearTimeout(sessionSaveTimerRef.current);
        sessionSaveTimerRef.current = null;
      }
      sessionGenerationRef.current += 1;
      snapshotControllerRef.current?.abort();
      proofControllerRef.current?.abort();
      closeStreams();
    };
    window.addEventListener("pagehide", protectAndFlush);
    return () => {
      window.removeEventListener("pagehide", protectAndFlush);
      protectAndFlush();
    };
  }, [closeStreams, persistEngineState]);

  async function connect(replacementConfirmed = false) {
    const fixtureId = Number(selectedFixtureId);
    if (
      !Number.isSafeInteger(fixtureId) ||
      fixtureId < 1 ||
      (!pipelineRehearsal && storageLocked) ||
      (!pipelineRehearsal && storedSession !== null && !replacementConfirmed)
    ) {
      return;
    }
    const fixture = fixtures.find((candidate) => candidate.fixtureId === fixtureId);
    if (!fixture) {
      setConnectionError("The selected fixture is not present in the current catalogue.");
      return;
    }

    endCurrentSession(
      pipelineRehearsal
        ? "A new synthetic pipeline rehearsal superseded the previous run"
        : "A new live session superseded the previous session",
    );
    sessionGenerationRef.current += 1;
    const generation = sessionGenerationRef.current;
    snapshotControllerRef.current?.abort();
    proofRequestIdRef.current += 1;
    proofControllerRef.current?.abort();
    closeStreams();
    channelOpenRef.current = { odds: false, scores: false };
    setChannelOpen({ odds: false, scores: false });
    setConnectionPhase("connecting");
    setConnectionError(null);
    setSnapshotWarning(null);
    setProof(null);
    setProofLoading(false);

    sessionIdRef.current = browserId("session");
    sessionRetentionBaselineRef.current = null;
    const nextSessionFixture = fixtureForSession(fixture);
    sessionFixtureRef.current = nextSessionFixture;
    setSessionFixture(nextSessionFixture);
    const next = createLiveEngineState({
      fixtureId: String(fixtureId),
      policy: status
        ? {
            shockWindowMs: status.policy.shockWindowMs,
            shockDelta: status.policy.shockDelta,
            transportTimeoutMs: status.policy.transportTimeoutMs,
            maximumPriceSilenceMs: status.policy.maximumPriceSilenceMs,
            maximumPriceSourceAgeMs: status.policy.maximumPriceSourceAgeMs,
            minimumSuspendMs: status.policy.minimumSuspendMs,
            stableObservationsRequired: status.policy.stableObservationsRequired,
            stableObservationDelta: status.policy.stableObservationDelta,
            maximumLiability: status.policy.maximumLiability,
            requoteDelta: status.policy.requoteDelta,
            minimumRequoteIntervalMs: status.policy.minimumRequoteIntervalMs,
          }
        : undefined,
    });
    engineRef.current = next;
    setEngine(next);
    if (!pipelineRehearsal) {
      const saved = persistEngineState(next, { replaceSession: replacementConfirmed });
      if (!saved) {
        const atMs = Math.max(Date.now(), next.nowMs);
        const protectedEngine = reduceLiveEngineEvent(next, {
          kind: "SESSION_END",
          fixtureId: next.fixtureId,
          reason: "Initial device-local evidence write failed",
          atMs,
          clock: clockLabel(atMs),
        });
        engineRef.current = protectedEngine;
        setEngine(protectedEngine);
        setConnectionPhase("failed");
        setConnectionError(
          "The live paper session was not opened because its initial evidence record could not be saved. Export or clear the local record before retrying.",
        );
        return;
      }
      setStoredSession(saved);
    }

    let oddsSource: EventSource;
    let scoresSource: EventSource;
    const streamMode = pipelineRehearsal ? "synthetic" : "live";
    try {
      oddsSource = new EventSource(
        `/api/stream?mode=${streamMode}&kind=odds&fixtureId=${fixtureId}`,
      );
      streamsRef.current.odds = oddsSource;
      scoresSource = new EventSource(
        `/api/stream?mode=${streamMode}&kind=scores&fixtureId=${fixtureId}`,
      );
      streamsRef.current.scores = scoresSource;
    } catch (error) {
      terminateSession(
        `The local browser could not open both ${pipelineRehearsal ? "rehearsal" : "TxLINE"} transports`,
        "failed",
        error instanceof Error ? error.message : "Stream creation failed.",
      );
      return;
    }

    const updateChannel = (
      channel: keyof StreamChannelState,
      open: boolean,
      transportFailed = false,
    ) => {
      if (sessionGenerationRef.current !== generation) return;
      const updated = { ...channelOpenRef.current, [channel]: open };
      channelOpenRef.current = updated;
      setChannelOpen(updated);
      if (updated.odds && updated.scores) {
        setConnectionPhase("connected");
        setConnectionError(null);
      } else if (transportFailed) {
        setConnectionPhase("reconnecting");
        setConnectionError(
          `${channel === "odds" ? "Odds" : "Scores"} transport is reconnecting. Paper quotes remain subject to the configured heartbeat timeout.`,
        );
      } else {
        setConnectionPhase((current) =>
          current === "reconnecting" ? "reconnecting" : "connecting",
        );
      }
    };

    const failContract = (channel: "odds" | "scores", code: string) => {
      if (sessionGenerationRef.current !== generation) return;
      const channelLabel = channel === "odds" ? "odds" : "scores";
      terminateSession(
        `The ${channelLabel} stream failed the local data contract (${code})`,
        "failed",
        `The ${channelLabel} stream failed closed after a contract error (${code}). Reconnect after checking the provider payload.`,
      );
    };

    const handleContractFailure = (
      channel: "odds" | "scores",
      raw: MessageEvent<string>,
    ) => {
      let code = "TXLINE_SCHEMA_MISMATCH";
      try {
        const payload = JSON.parse(raw.data) as StreamContractFailure;
        if (typeof payload.code === "string" && payload.code.trim()) {
          code = payload.code.trim().slice(0, 80);
        }
      } catch {
        code = "TXLINE_INVALID_CONTRACT_ERROR";
      }
      failContract(channel, code);
    };

    const handleOdds = (raw: MessageEvent<string>) => {
      if (sessionGenerationRef.current !== generation) return;
      try {
        const event = streamData<MatchWinnerOdds>(raw);
        dispatch(oddsEvent(event.data, Date.now(), event.eventId), generation);
      } catch {
        failContract("odds", "CLIENT_STREAM_PARSE_FAILED");
      }
    };
    const handleScore = (raw: MessageEvent<string>) => {
      if (sessionGenerationRef.current !== generation) return;
      try {
        const event = streamData<RuntimeScoreSnapshot>(raw);
        dispatch(scoreEvent(event.data, Date.now()), generation);
      } catch {
        failContract("scores", "CLIENT_STREAM_PARSE_FAILED");
      }
    };

    oddsSource.onmessage = handleOdds;
    oddsSource.addEventListener("odds", handleOdds as EventListener);
    oddsSource.addEventListener("contract-error", ((raw: MessageEvent<string>) => {
      handleContractFailure("odds", raw);
    }) as EventListener);
    scoresSource.onmessage = handleScore;
    scoresSource.addEventListener("score", handleScore as EventListener);
    scoresSource.addEventListener("scores", handleScore as EventListener);
    scoresSource.addEventListener("contract-error", ((raw: MessageEvent<string>) => {
      handleContractFailure("scores", raw);
    }) as EventListener);

    oddsSource.addEventListener("heartbeat", (raw) => {
      dispatch(
        heartbeatEvent(
          fixtureId,
          "ODDS",
          Date.now(),
          (raw as MessageEvent<string>).lastEventId || undefined,
        ),
        generation,
      );
    });
    scoresSource.addEventListener("heartbeat", (raw) => {
      dispatch(
        heartbeatEvent(
          fixtureId,
          "SCORES",
          Date.now(),
          (raw as MessageEvent<string>).lastEventId || undefined,
        ),
        generation,
      );
    });

    oddsSource.onopen = () => updateChannel("odds", true);
    scoresSource.onopen = () => updateChannel("scores", true);
    oddsSource.onerror = () => updateChannel("odds", false, true);
    scoresSource.onerror = () => updateChannel("scores", false, true);

    // Streams are listening before snapshots start, so no update can fall into a
    // snapshot-to-subscription gap. Older snapshots are rejected by seq/timestamp guards.
    const snapshotController = new AbortController();
    snapshotControllerRef.current = snapshotController;
    const [oddsSnapshot, scoreSnapshot] = await Promise.allSettled([
      fetchData<MatchWinnerOdds>(
        `/api/odds?mode=${streamMode}&fixtureId=${fixtureId}`,
        snapshotController.signal,
      ),
      fetchData<RuntimeScoreSnapshot>(
        `/api/scores?mode=${streamMode}&fixtureId=${fixtureId}`,
        snapshotController.signal,
      ),
    ]);
    if (
      snapshotController.signal.aborted ||
      sessionGenerationRef.current !== generation
    ) {
      return;
    }

    const receivedAt = Date.now();
    if (scoreSnapshot.status === "fulfilled") {
      dispatch(scoreEvent(scoreSnapshot.value, receivedAt), generation);
    }
    if (oddsSnapshot.status === "fulfilled") {
      dispatch(oddsEvent(oddsSnapshot.value, receivedAt + 1), generation);
    }
    const failures = [
      oddsSnapshot.status === "rejected"
        ? `odds: ${oddsSnapshot.reason instanceof Error ? oddsSnapshot.reason.message : "request failed"}`
        : null,
      scoreSnapshot.status === "rejected"
        ? `scores: ${scoreSnapshot.reason instanceof Error ? scoreSnapshot.reason.message : "request failed"}`
        : null,
    ].filter((failure): failure is string => failure !== null);
    setSnapshotWarning(
      failures.length > 0
        ? `Initial snapshot warning (${failures.join("; ")}). The already-open streams remain active.`
        : null,
    );
    if (snapshotControllerRef.current === snapshotController) {
      snapshotControllerRef.current = null;
    }
  }

  function disconnect() {
    terminateSession(
      pipelineRehearsal
        ? "Operator stopped the synthetic pipeline rehearsal"
        : "Operator disconnected the live fixture",
      "idle",
      null,
    );
  }

  useEffect(() => {
    connectRef.current = connect;
  });

  function requestConnect(event: MouseEvent<HTMLButtonElement>) {
    if (!pipelineRehearsal && storedSession) {
      replaceDialogTriggerRef.current = event.currentTarget;
      if (!replaceDialogRef.current?.open) replaceDialogRef.current?.showModal();
      return;
    }
    void connect(false);
  }

  function closeReplaceDialog() {
    replaceDialogRef.current?.close();
    window.setTimeout(() => replaceDialogTriggerRef.current?.focus(), 0);
  }

  function confirmReplacement() {
    replaceDialogRef.current?.close();
    void connect(true);
  }

  function selectDemo() {
    terminateSession("Operator switched to the demonstration lab", "idle", null);
    onSelectDemo();
  }

  function startPipelineRehearsal() {
    if (status?.mode !== "synthetic") return;
    terminateSession("Operator started a synthetic pipeline rehearsal", "idle", null);
    engineRef.current = null;
    setEngine(null);
    setProof(null);
    setSelectedFixtureId("");
    setFixtures([]);
    setFixturesLoading(true);
    setFixtureError(null);
    setPipelineRehearsal(true);
  }

  function changeFixture(fixtureId: string) {
    if (fixtureId === selectedFixtureId) return;
    endCurrentSession("Operator selected a different fixture");
    proofRequestIdRef.current += 1;
    proofControllerRef.current?.abort();
    proofControllerRef.current = null;
    engineRef.current = null;
    setEngine(null);
    setProof(null);
    setProofLoading(false);
    setSelectedFixtureId(fixtureId);
  }

  async function requestProof() {
    const subject = engineRef.current;
    if (!subject || subject.lastScoreSeq === null || subject.lastScoreSeq < 1) return;
    const fixtureId = Number(subject.fixtureId);
    const seq = subject.lastScoreSeq;
    const generation = sessionGenerationRef.current;
    const requestId = proofRequestIdRef.current + 1;
    proofRequestIdRef.current = requestId;
    proofControllerRef.current?.abort();
    const controller = new AbortController();
    proofControllerRef.current = controller;
    setProofLoading(true);
    setProof(null);
    try {
      const response = await fetch(
        `/api/verify?fixtureId=${fixtureId}&seq=${seq}&statKeys=${SCORE_PROOF_STAT_KEYS.join(",")}`,
        { cache: "no-store", signal: controller.signal },
      );
      const payload: unknown = await response.json();
      if (!response.ok) {
        throw new Error(apiError(payload, `Proof endpoint returned HTTP ${response.status}.`));
      }
      const result = parseLiveProofResult(payload, fixtureId, seq);
      const current = engineRef.current;
      if (
        controller.signal.aborted ||
        proofRequestIdRef.current !== requestId ||
        sessionGenerationRef.current !== generation ||
        current?.fixtureId !== String(fixtureId) ||
        current.lastScoreSeq !== seq
      ) {
        return;
      }
      setProof(result);
    } catch (error) {
      if (controller.signal.aborted) return;
      const current = engineRef.current;
      if (
        proofRequestIdRef.current !== requestId ||
        sessionGenerationRef.current !== generation ||
        current?.fixtureId !== String(fixtureId) ||
        current.lastScoreSeq !== seq
      ) {
        return;
      }
      setProof({
        state: "REQUEST_FAILED",
        verified: false,
        fixtureId,
        seq,
        statKeys: [...SCORE_PROOF_STAT_KEYS],
        message: error instanceof Error ? error.message : "Proof request failed.",
        proof: null,
        validation: null,
      });
    } finally {
      if (
        proofRequestIdRef.current === requestId &&
        sessionGenerationRef.current === generation
      ) {
        proofControllerRef.current = null;
        setProofLoading(false);
      }
    }
  }

  async function openEvidencePreview(event: MouseEvent<HTMLButtonElement>) {
    const evidenceFixture = engineFixture ?? (engine ? sessionFixture : null) ?? selectedFixture;
    if (!engine || !status || !evidenceFixture) return;
    evidenceExportTriggerRef.current = event.currentTarget;
    setEvidencePreparing(true);
    setEvidenceDownloadStatus("");
    try {
      const safeProof = proof?.state === "REQUEST_FAILED" ? null : proof;
      const matchingStoredSession =
        !pipelineRehearsal &&
        storedSession?.scope.fixture.fixtureId === Number(engine.fixtureId)
          ? storedSession
          : null;
      const payload = buildLiveEvidencePack({
        generatedAt: Date.now(),
        source: runtimeSource,
        appStatus: status,
        fixture: evidenceFixture,
        engine,
        transport: {
          phase: connectionPhase,
          channels: { ...channelOpen },
          health,
        },
        proof: safeProof,
        savedSession: matchingStoredSession,
      });
      const serialised = serialiseLiveEvidencePack(payload);
      const { contents } = serialised;
      const checksum = await sha256(contents);
      setEvidencePreview({
        contents,
        filename: `proofswitch-${engine.fixtureId}-evidence-pack.json`,
        checksum,
        source: runtimeSource,
        fixtureId: engine.fixtureId,
        scoreSequence: engine.lastScoreSeq,
        decisionState: engine.status,
        cancelledOrders: engine.cancelledOrders,
        orderRecords: payload.orders.length,
        fillRecords: payload.fills.length,
        commandRecords: payload.executionCommands.length,
        auditRecords: payload.audit.length,
        auditTruncated: payload.decision.auditTruncated,
        byteLength: serialised.bytes,
        proofState: safeProof?.state ?? "NOT_REQUESTED",
        savedRevision: matchingStoredSession?.revision ?? null,
      });
      window.requestAnimationFrame(() => {
        if (!evidenceExportDialogRef.current?.open) {
          evidenceExportDialogRef.current?.showModal();
        }
      });
    } catch (error) {
      setConnectionError(
        error instanceof Error
          ? `Evidence pack could not be built: ${error.message}`
          : "Evidence pack could not be built safely.",
      );
    } finally {
      setEvidencePreparing(false);
    }
  }

  function closeEvidencePreview() {
    evidenceExportDialogRef.current?.close();
    window.setTimeout(() => evidenceExportTriggerRef.current?.focus(), 0);
  }

  function downloadEvidencePreview() {
    if (!evidencePreview) return;
    downloadText(evidencePreview.contents, evidencePreview.filename);
    setEvidenceDownloadStatus(
      `Evidence pack downloaded · ${evidencePreview.source} source · fixture ${evidencePreview.fixtureId} · ${evidencePreview.scoreSequence === null ? "no score sequence" : `sequence ${evidencePreview.scoreSequence}`} · unsigned.`,
    );
  }

  async function openPublicSummaryPreview(event: MouseEvent<HTMLButtonElement>) {
    publicSummaryTriggerRef.current = event.currentTarget;
    setPublicSummaryPreview(null);
    setPublicSummaryDownloadStatus("");

    if (runtimeSource !== "synthetic") {
      setPublicSummaryBlocked(PUBLIC_DEMO_TXLINE_BLOCK_MESSAGE);
      window.requestAnimationFrame(() => {
        if (!publicSummaryDialogRef.current?.open) {
          publicSummaryDialogRef.current?.showModal();
        }
      });
      return;
    }

    const summaryFixture = engineFixture ?? selectedFixture;
    if (!engine || !summaryFixture) {
      setConnectionError(
        "The synthetic public summary needs an active rehearsal fixture.",
      );
      return;
    }

    setPublicSummaryBlocked(null);
    setPublicSummaryPreparing(true);
    try {
      const summary = buildPublicDemoSummary({
        generatedAt: Date.now(),
        source: runtimeSource,
        fixture: summaryFixture,
        engine,
      });
      const contents = JSON.stringify(summary, null, 2);
      const checksum = await sha256(contents);
      setPublicSummaryPreview({
        contents,
        filename: `proofswitch-${engine.fixtureId}-synthetic-public-demo.json`,
        checksum,
        byteLength: new TextEncoder().encode(contents).byteLength,
        summary,
      });
      window.requestAnimationFrame(() => {
        if (!publicSummaryDialogRef.current?.open) {
          publicSummaryDialogRef.current?.showModal();
        }
      });
    } catch (error) {
      setConnectionError(
        error instanceof Error
          ? `Public demo summary could not be built: ${error.message}`
          : "Public demo summary could not be built safely.",
      );
    } finally {
      setPublicSummaryPreparing(false);
    }
  }

  function closePublicSummaryPreview() {
    publicSummaryDialogRef.current?.close();
    window.setTimeout(() => publicSummaryTriggerRef.current?.focus(), 0);
  }

  function downloadPublicSummaryPreview() {
    if (!publicSummaryPreview) return;
    downloadText(
      publicSummaryPreview.contents,
      publicSummaryPreview.filename,
    );
    setPublicSummaryDownloadStatus(
      `Synthetic public demo summary downloaded · fixture ${publicSummaryPreview.summary.run.fixtureId} · aggregate metrics only.`,
    );
  }

  function simulatePaperFill() {
    const current = engineRef.current;
    if (!current || current.status !== "QUOTING") return;
    const candidate = activeLivePaperOrders(current).find(
      (order) => remainingLivePaperOrderQuantity(current, order.id) > 0,
    );
    if (!candidate) {
      setConnectionError("No remaining working paper quantity is available to fill.");
      return;
    }
    const atMs = Math.max(Date.now(), current.nowMs);
    try {
      const next = dispatch(
        createDeterministicPaperFillEvent(current, {
          fillId: browserId("fill"),
          atMs,
          clock: clockLabel(atMs),
          outcome: candidate.outcome,
          side: candidate.side,
          fraction: 0.25,
        }),
        sessionGenerationRef.current,
      );
      if (next) persistEngineState(next);
    } catch (error) {
      setConnectionError(
        error instanceof Error ? error.message : "The deterministic paper fill was rejected.",
      );
    }
  }

  function openEmergencyStopDialog(event: MouseEvent<HTMLButtonElement>) {
    emergencyStopTriggerRef.current = event.currentTarget;
    if (!emergencyStopDialogRef.current?.open) emergencyStopDialogRef.current?.showModal();
  }

  function closeEmergencyStopDialog() {
    emergencyStopDialogRef.current?.close();
    window.setTimeout(() => emergencyStopTriggerRef.current?.focus(), 0);
  }

  function confirmEmergencyStop() {
    const current = engineRef.current;
    if (!current || current.status === "CLOSED" || current.emergencyStop) {
      closeEmergencyStopDialog();
      return;
    }
    const atMs = Math.max(Date.now(), current.nowMs);
    const next = dispatch(
      {
        kind: "EMERGENCY_STOP",
        fixtureId: current.fixtureId,
        stopId: browserId("stop"),
        reason: "Operator engaged the local paper-market emergency stop",
        atMs,
        clock: clockLabel(atMs),
      },
      sessionGenerationRef.current,
    );
    if (next) persistEngineState(next);
    emergencyStopDialogRef.current?.close();
  }

  function exportLocalSession() {
    try {
      const result = readPaperSession(window.localStorage);
      if (result.status === "ready" || result.status === "network-mismatch") {
        downloadText(
          serialisePaperSession(result.session),
          `proofswitch-${result.session.scope.fixture.fixtureId}-paper-session.json`,
        );
        return;
      }
      const raw = window.localStorage.getItem(PAPER_SESSION_STORAGE_KEY);
      if (raw !== null) {
        downloadText(raw, "proofswitch-unreadable-paper-session.json");
      }
    } catch (error) {
      setLocalSessionState("unavailable");
      setLocalSessionMessage(
        error instanceof Error ? error.message : "The local session could not be exported.",
      );
    }
  }

  function clearLocalSession() {
    terminateSession("Operator cleared the device-local paper session", "idle", null);
    if (sessionSaveTimerRef.current !== null) {
      window.clearTimeout(sessionSaveTimerRef.current);
      sessionSaveTimerRef.current = null;
    }
    const result = clearPaperSession(window.localStorage);
    if (result.status !== "cleared") {
      setLocalSessionState("unavailable");
      setLocalSessionMessage(result.message);
      return;
    }
    engineRef.current = null;
    setEngine(null);
    setProof(null);
    setStoredSession(null);
    sessionFixtureRef.current = null;
    setSessionFixture(null);
    sessionRevisionRef.current = 0;
    sessionRetentionBaselineRef.current = null;
    sessionIdRef.current = browserId("session");
    setStorageLocked(false);
    setLocalSessionState("empty");
    setLocalSessionMessage("No live paper session is stored on this device.");
    clearDialogRef.current?.close();
    replaceDialogRef.current?.close();
  }

  function openClearDialog(event: MouseEvent<HTMLButtonElement>) {
    clearDialogTriggerRef.current = event.currentTarget;
    if (!clearDialogRef.current?.open) clearDialogRef.current?.showModal();
  }

  function closeClearDialog() {
    clearDialogRef.current?.close();
    window.setTimeout(() => clearDialogTriggerRef.current?.focus(), 0);
  }

  async function unlockOperatorAccess() {
    if (!operatorAccessCode.trim() || operatorAccessLoading) return;
    setOperatorAccessLoading(true);
    setOperatorAccessError(null);
    try {
      const response = await fetch("/api/access", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: operatorAccessCode }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        throw new Error(apiError(payload, `Access endpoint returned ${response.status}.`));
      }
      if (
        typeof payload !== "object" ||
        payload === null ||
        !("data" in payload)
      ) {
        throw new Error("The operator access endpoint returned an invalid response.");
      }
      setOperatorAccess((payload as { data: OperatorAccessStatus }).data);
      setOperatorAccessCode("");
      setFixturesLoading(true);
      setFixtureReload((attempt) => attempt + 1);
    } catch (error) {
      setOperatorAccessError(
        error instanceof Error ? error.message : "Operator access could not be unlocked.",
      );
    } finally {
      setOperatorAccessLoading(false);
    }
  }

  async function lockOperatorAccess() {
    terminateSession("Operator locked sponsor-backed access", "idle", null);
    setOperatorAccessLoading(true);
    setOperatorAccessError(null);
    try {
      const response = await fetch("/api/access", {
        method: "DELETE",
        credentials: "same-origin",
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        throw new Error(apiError(payload, `Access endpoint returned ${response.status}.`));
      }
      setOperatorAccess((payload as { data: OperatorAccessStatus }).data);
      setFixtures([]);
      setSelectedFixtureId("");
    } catch (error) {
      setOperatorAccessError(
        error instanceof Error ? error.message : "Operator access could not be locked.",
      );
    } finally {
      setOperatorAccessLoading(false);
    }
  }

  async function runLivePreflight() {
    setPreflightRunning(true);
    setPreflightChecks([]);
    const checks: PreflightCheck[] = [];
    const preflightMode = pipelineRehearsal || !liveConfigured ? "synthetic" : "live";
    const push = (check: PreflightCheck) => {
      checks.push(check);
      setPreflightChecks([...checks]);
    };

    push({
      id: "status",
      label: "Runtime status",
      tone: status ? "pass" : "fail",
      detail: status
        ? `${status.mode.toUpperCase()} on ${status.network.toUpperCase()} with ${status.liveReadiness.missing.length} live settings still missing.`
        : statusError ?? "Application status is not available.",
    });
    push({
      id: "txline-token",
      label: "TxLINE token",
      tone: status?.txline.apiTokenPresent ? "pass" : "fail",
      detail: status?.txline.apiTokenPresent
        ? "A server-side token is present; the value is not exposed to the browser."
        : "Add TXLINE_API_TOKEN before attempting sponsor-backed data.",
    });
    push({
      id: "operator-access",
      label: "Operator access",
      tone: operatorAccess?.configured
        ? operatorAccess.authenticated || !operatorAccess.required
          ? "pass"
          : "warn"
        : "fail",
      detail: operatorAccess?.configured
        ? operatorAccess.authenticated || !operatorAccess.required
          ? "Operator access is ready for sponsor-backed routes."
          : "Access code is configured but the live room is locked."
        : "Set PROOFSWITCH_ACCESS_CODE and PROOFSWITCH_ACCESS_SIGNING_SECRET together.",
    });
    push({
      id: "solana-runtime",
      label: "Solana validation",
      tone: status?.capabilities.onchainValidation ? "pass" : "warn",
      detail: status?.capabilities.onchainValidation
        ? "Read-only devnet validation is configured."
        : "Proof retrieval can still be tested, but on-chain verification will remain unclaimed.",
    });

    try {
      const rows = await fetchData<Fixture[]>(`/api/fixtures?mode=${preflightMode}`);
      push({
        id: "fixtures",
        label: "Fixture catalogue",
        tone: rows.length > 0 ? "pass" : "warn",
        detail:
          rows.length > 0
            ? `${rows.length} ${preflightMode === "live" ? "covered" : "synthetic"} fixtures returned.`
            : "The catalogue returned no covered fixtures.",
      });
    } catch (error) {
      push({
        id: "fixtures",
        label: "Fixture catalogue",
        tone: "fail",
        detail: error instanceof Error ? error.message : "Fixture catalogue failed.",
      });
    }

    const fixtureId = selectedFixtureId || String(selectInitialFixture(fixtures, preferredFixtureId)?.fixtureId ?? "");
    if (!fixtureId) {
      push({
        id: "snapshots",
        label: "Snapshot checks",
        tone: "pending",
        detail: "Select or load a fixture before checking odds and scores snapshots.",
      });
    } else {
      const [odds, scores] = await Promise.allSettled([
        fetchData<MatchWinnerOdds>(`/api/odds?mode=${preflightMode}&fixtureId=${fixtureId}`),
        fetchData<RuntimeScoreSnapshot>(`/api/scores?mode=${preflightMode}&fixtureId=${fixtureId}`),
      ]);
      push({
        id: "odds-snapshot",
        label: "Odds snapshot",
        tone: odds.status === "fulfilled" ? "pass" : "fail",
        detail:
          odds.status === "fulfilled"
            ? "StablePrice match-winner probabilities normalised successfully."
            : odds.reason instanceof Error
              ? odds.reason.message
              : "Odds snapshot failed.",
      });
      push({
        id: "scores-snapshot",
        label: "Scores snapshot",
        tone: scores.status === "fulfilled" ? "pass" : "fail",
        detail:
          scores.status === "fulfilled"
            ? `Score sequence ${scores.value.seq} normalised successfully.`
            : scores.reason instanceof Error
              ? scores.reason.message
              : "Scores snapshot failed.",
      });

      const proofSeq = engine?.lastScoreSeq ?? (scores.status === "fulfilled" ? scores.value.seq : null);
      if (proofSeq) {
        try {
          const response = await fetch(
            `/api/verify?fixtureId=${fixtureId}&seq=${proofSeq}&statKeys=${SCORE_PROOF_STAT_KEYS.join(",")}`,
            { cache: "no-store" },
          );
          const payload: unknown = await response.json();
          push({
            id: "proof",
            label: "Proof endpoint",
            tone: response.ok ? "pass" : "warn",
            detail: response.ok
              ? `Proof boundary responded with ${(payload as { state?: unknown }).state ?? "a bounded state"}.`
              : apiError(payload, `Proof endpoint returned HTTP ${response.status}.`),
          });
        } catch (error) {
          push({
            id: "proof",
            label: "Proof endpoint",
            tone: "fail",
            detail: error instanceof Error ? error.message : "Proof endpoint failed.",
          });
        }
      }
    }
    setPreflightRunning(false);
  }

  function startJudgeMode() {
    if (pipelineRehearsal && selectedFixtureId && (connectionPhase === "idle" || connectionPhase === "failed")) {
      void connect(false);
      return;
    }
    setJudgeModeLaunchPending(true);
    startPipelineRehearsal();
  }

  async function copySetupTemplate() {
    try {
      await navigator.clipboard.writeText(setupTemplate(status));
      setDemoBundleStatus(".env.local template copied.");
    } catch {
      setDemoBundleStatus("Clipboard was unavailable; the setup template remains visible on screen.");
    }
  }

  async function downloadDemoBundle() {
    const bundle = {
      schema: "proofswitch.demo-bundle.v1",
      generatedAt: new Date().toISOString(),
      source: runtimeSource,
      status: status
        ? {
            mode: status.mode,
            network: status.network,
            liveReadiness: status.liveReadiness,
            txline: {
              configured: status.txline.configured,
              origin: status.txline.origin,
              preferredFixtureId: status.txline.preferredFixtureId,
            },
            solana: status.solana,
            capabilities: status.capabilities,
            limitations: status.limitations,
          }
        : null,
      fixture: displayFixture
        ? {
            fixtureId: displayFixture.fixtureId,
            label: `${displayFixture.home.name} v ${displayFixture.away.name}`,
            competition: displayFixture.competition,
            startTime: displayFixture.startTime,
          }
        : null,
      scorecard,
      preflightChecks,
      sponsorEvidence: {
        dataSource: runtimeSource === "txline" ? "TxLINE-derived private session" : "Synthetic rehearsal",
        execution: "Paper execution only",
        proofState: proof?.state ?? "NOT_REQUESTED",
        verified: proof?.verified ?? false,
        publicSummaryAllowed: runtimeSource === "synthetic",
      },
      timeline: timelineItems,
      setupTemplate: status?.liveReadiness.missing.length ? setupTemplate(status) : null,
    };
    const contents = JSON.stringify(bundle, null, 2);
    const checksum = await sha256(contents);
    downloadText(
      JSON.stringify({ ...bundle, checksum: { algorithm: "SHA-256", value: checksum } }, null, 2),
      `proofswitch-${engine?.fixtureId ?? "readiness"}-demo-bundle.json`,
    );
    setDemoBundleStatus(`Demo bundle downloaded with checksum ${checksum.slice(0, 12)}...`);
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <div className="brand-mark" aria-hidden="true">PS</div>
          <div>
            <p className="brand-name">ProofSwitch</p>
            <p className="brand-subtitle">World Cup in-play risk operator</p>
          </div>
        </div>
        <div className="header-status" aria-label="Live application status">
          <span className="status-chip track-primary">Trading Tools and Agents</span>
          <span className="status-chip world-cup">World Cup 2026</span>
          <span className={`status-chip ${liveConfigured ? "connected" : pipelineRehearsal ? "synthetic" : "disconnected"}`}>
            {liveConfigured
              ? "TxLINE configured"
              : pipelineRehearsal
                ? "Synthetic pipeline rehearsal"
                : "TxLINE unavailable"}
          </span>
          <span className="status-chip">Paper execution</span>
          {liveConfigured && operatorAccess?.required ? (
            <span className={`status-chip ${operatorAccess.authenticated ? "connected" : "disconnected"}`}>
              {operatorAccess.authenticated ? "Operator unlocked" : "Operator locked"}
            </span>
          ) : null}
          <span className={`status-chip ${status?.capabilities.onchainValidation ? "connected" : "disconnected"}`}>
            {status?.capabilities.onchainValidation ? "On-chain check configured" : "Solana unverified"}
          </span>
        </div>
        <div className="topbar-actions">
          <div className="view-switch" role="group" aria-label="Application mode">
            <button aria-pressed="false" onClick={selectDemo}>Demo lab</button>
            <button className="active" aria-pressed="true">Live control room</button>
          </div>
          <button
            className="button secondary"
            type="button"
            onClick={startJudgeMode}
            disabled={judgeModeLaunchPending || connectionPhase === "connecting" || connectionPhase === "reconnecting"}
          >
            {judgeModeLaunchPending ? "Preparing judge mode..." : "Judge mode"}
          </button>
          {liveConfigured && operatorAccess?.authenticated ? (
            <button className="button quiet" type="button" onClick={lockOperatorAccess} disabled={operatorAccessLoading}>
              Lock access
            </button>
          ) : null}
        </div>
      </header>

      <section className="prototype-notice" aria-label="Runtime data boundary">
        <span className="notice-label">
          {pipelineRehearsal ? "Primary track: Trading Tools and Agents" : "Credential boundary"}
        </span>
        <p>
          {pipelineRehearsal
            ? "This rehearsal shows the target track fit: an autonomous agent consumes odds, scores and stream health, detects trading signals, and executes paper quote decisions. It is not TxLINE data and cannot produce Solana verification."
            : "Live mode never substitutes synthetic data. TxLINE credentials stay server-side and a proof is never labelled verified until the matching on-chain validation runtime succeeds."}
        </p>
      </section>

      <section className="judge-ops-grid" aria-label="Judge and live setup tools">
        <article className="panel judge-ops-card">
          <div>
            <p className="eyebrow">Judge mode</p>
            <h2>90-second live-path rehearsal</h2>
            <p>Launches the synthetic production path, connects the fixture and lets the same live reducer produce paper decisions for judging.</p>
          </div>
          <button
            className="button primary"
            type="button"
            onClick={startJudgeMode}
            disabled={judgeModeLaunchPending || connectionPhase === "connecting" || connectionPhase === "reconnecting"}
          >
            {judgeModeLaunchPending ? "Preparing..." : "Start judge mode"}
          </button>
        </article>

        <article className="panel judge-ops-card">
          <div>
            <p className="eyebrow">Live preflight</p>
            <h2>Credential and endpoint checks</h2>
            <p>Checks runtime status, access, fixture discovery, snapshots, proof boundary and Solana readiness without exposing secrets.</p>
          </div>
          <button className="button secondary" type="button" onClick={runLivePreflight} disabled={preflightRunning}>
            {preflightRunning ? "Checking..." : "Run preflight"}
          </button>
        </article>

        <article className="panel judge-ops-card">
          <div>
            <p className="eyebrow">Submission bundle</p>
            <h2>Export demo evidence index</h2>
            <p>Downloads readiness, scorecard, sponsor boundary, timeline and setup metadata as one local JSON file.</p>
          </div>
          <button className="button secondary" type="button" onClick={downloadDemoBundle}>
            Export demo bundle
          </button>
        </article>
      </section>

      {preflightChecks.length > 0 ? (
        <section className="panel preflight-panel" aria-label="Live connection preflight results" aria-busy={preflightRunning}>
          <div className="panel-heading compact">
            <div>
              <p className="eyebrow">Live connection preflight</p>
              <h2>Readiness before opening streams</h2>
            </div>
            <span className={`state-pill ${preflightChecks.some((check) => check.tone === "fail") ? "danger" : preflightRunning ? "warning" : "healthy"}`}>
              <span className="state-dot" aria-hidden="true" />
              {preflightRunning ? "Running" : `${preflightChecks.length} checks`}
            </span>
          </div>
          <ol className="preflight-list">
            {preflightChecks.map((check) => (
              <li className={`preflight-${check.tone}`} key={check.id}>
                <span>{preflightToneLabel(check.tone)}</span>
                <div>
                  <strong>{check.label}</strong>
                  <p>{check.detail}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {demoBundleStatus ? (
        <p className="panel demo-bundle-status" role="status" aria-live="polite">
          {demoBundleStatus}
        </p>
      ) : null}

      <section className="panel local-session-bar">
        <div>
          <p className="eyebrow">Device-local paper evidence</p>
          <h2>
            {localSessionState === "recovered"
              ? "Recovered and protected"
              : localSessionState === "saved"
                ? "Paper session saved"
                : localSessionState === "empty"
                  ? "No saved paper session"
                  : "Stored session needs attention"}
          </h2>
          <p role="status" aria-live="polite">
            {pipelineRehearsal && !storedSession
              ? "Synthetic rehearsals do not write to the live paper-session record. Export the evidence pack from the audit panel if this run is needed."
              : localSessionMessage}
          </p>
          {storedSession ? (
            <>
              <small className="mono">
                {storedSession.scope.network.toUpperCase()} · fixture {storedSession.scope.fixture.fixtureId} · revision {storedSession.revision} · device-local unsigned
              </small>
              <small>TxLINE-derived session exports may contain licensed prices and scores. Keep them private.</small>
            </>
          ) : null}
        </div>
        <div className="local-session-actions">
          <button
            className="button secondary"
            type="button"
            onClick={exportLocalSession}
            disabled={localSessionState === "empty"}
          >
            Export complete session
          </button>
          <button
            ref={clearDialogTriggerRef}
            className="button secondary"
            type="button"
            onClick={openClearDialog}
            disabled={localSessionState === "empty"}
          >
            Clear local session
          </button>
        </div>
      </section>

      {operatorAccessLocked ? (
        <section className="panel operator-access-panel" aria-busy={operatorAccessLoading}>
          <div>
            <p className="eyebrow">Protected sponsor access</p>
            <h1>{operatorAccessLoading ? "Checking operator access" : "Unlock the live control room"}</h1>
            <p>
              {operatorAccessError
                ? operatorAccessError
                : operatorAccess?.configured === false
                  ? "Live mode is fail-closed because a judge access code and signing secret have not been configured on the server."
                  : "Enter the judge or operator code. A short-lived HttpOnly session cookie unlocks the sponsor-backed routes without exposing the TxLINE token."}
            </p>
          </div>
          {operatorAccess?.configured ? (
            <form
              className="operator-access-form"
              onSubmit={(event) => {
                event.preventDefault();
                void unlockOperatorAccess();
              }}
            >
              <label htmlFor="operator-access-code">Judge or operator access code</label>
              <input
                id="operator-access-code"
                type="password"
                autoComplete="current-password"
                value={operatorAccessCode}
                onChange={(event) => setOperatorAccessCode(event.target.value)}
                disabled={operatorAccessLoading}
              />
              <button className="button primary" type="submit" disabled={operatorAccessLoading || !operatorAccessCode.trim()}>
                {operatorAccessLoading ? "Checking…" : "Unlock live access"}
              </button>
            </form>
          ) : null}
          <p className="dialog-warning" role={operatorAccessError ? "alert" : "status"}>
            Synthetic rehearsal remains credential-free. Live requests never fall back to synthetic data when access is locked.
          </p>
        </section>
      ) : !pipelineEnabled ? (
        <>
          <section className="panel live-setup">
            <div>
              <p className="eyebrow">Operational mode</p>
              <h1>Live connection is not configured</h1>
              <p role="status" aria-live="polite">
                {statusError
                  ? `The local status check failed: ${statusError}`
                  : status?.liveConfigured && status.mode !== "live"
                    ? "An API token is present, but PROOFSWITCH_MODE must be set to live before live requests are authorised."
                    : "Credentials are absent. Run the synthetic pipeline rehearsal to exercise the same snapshot, SSE, live policy and paper-execution path without claiming TxLINE data."}
              </p>
            </div>
            <div className="setup-state">
              <span className="state-pill warning"><span className="state-dot" aria-hidden="true" />Setup required</span>
              <span className="mono">{status?.network.toUpperCase() ?? "DEVNET"}</span>
              {status?.mode === "synthetic" ? (
                <button className="button primary" type="button" onClick={startPipelineRehearsal}>
                  Run pipeline rehearsal
                </button>
              ) : null}
            </div>
          </section>

          <section className="panel live-readiness-panel" aria-label="Live credential readiness">
            <div>
              <p className="eyebrow">Live readiness</p>
              <h2>
                {status?.liveReadiness.state === "ready"
                  ? "Ready to connect after unlock"
                  : status?.liveReadiness.state === "validation_optional"
                    ? "TxLINE ready, Solana validation optional"
                    : "Keys can be added later"}
              </h2>
              <p>{status?.liveReadiness.nextAction ?? "Status is still loading."}</p>
            </div>
            <div className="readiness-check-columns">
              <section>
                <h3>Configured</h3>
                {status?.liveReadiness.configured.length ? (
                  <ul>
                    {status.liveReadiness.configured.map((item) => (
                      <li key={item}><span className="check-dot ready" aria-hidden="true" />{item}</li>
                    ))}
                  </ul>
                ) : (
                  <p>No live credentials detected yet.</p>
                )}
              </section>
              <section>
                <h3>Missing before live</h3>
                {status?.liveReadiness.missing.length ? (
                  <ul>
                    {status.liveReadiness.missing.map((item) => (
                      <li key={item}><span className="check-dot missing" aria-hidden="true" />{item}</li>
                    ))}
                  </ul>
                ) : (
                  <p>Required live settings are present.</p>
                )}
              </section>
            </div>
          </section>

          <section className="panel env-wizard-panel" aria-label="Local live setup template">
            <div>
              <p className="eyebrow">.env.local setup wizard</p>
              <h2>Paste keys later, keep secrets server-side</h2>
              <p>
                This template names the values needed for the live path. It intentionally uses placeholders and should be filled only after sponsor access is issued.
              </p>
            </div>
            <pre className="env-template" aria-label="Credential-ready environment template">{setupTemplate(status)}</pre>
            <button className="button secondary" type="button" onClick={copySetupTemplate}>
              Copy setup template
            </button>
          </section>

          <section className="live-setup-grid">
            <article className="panel setup-card">
              <span className="setup-number mono">01</span>
              <h2>Activate TxLINE access</h2>
              <p>Subscribe on the matching Solana network and activate the API token with the same wallet.</p>
              <strong>Wallet signing happens outside this application.</strong>
            </article>
            <article className="panel setup-card">
              <span className="setup-number mono">02</span>
              <h2>Set credentials and access</h2>
              <p>
                Copy <span className="mono">.env.example</span> to <span className="mono">.env.local</span>,
                select live mode, add the token, then set an independent operator code and signing secret.
              </p>
              <strong>Tokens and signing secrets are never returned to the browser.</strong>
            </article>
            <article className="panel setup-card">
              <span className="setup-number mono">03</span>
              <h2>Restart and connect</h2>
              <p>Restart locally, discover the current fixture catalogue and open both authenticated SSE streams.</p>
              <strong>No silent fallback to the demo feed.</strong>
            </article>
          </section>
        </>
      ) : (
        <>
          <section className="panel live-command-bar">
            <div className="live-fixture-picker">
              <label htmlFor="live-fixture">Covered fixture</label>
              <select
                id="live-fixture"
                value={selectedFixtureId}
                onChange={(event) => changeFixture(event.target.value)}
                disabled={fixturesLoading || (connectionPhase !== "idle" && connectionPhase !== "failed")}
              >
                <option value="" disabled>
                  {fixturesLoading ? "Loading fixtures…" : "Select a covered fixture"}
                </option>
                {fixtureGroups.worldCup.length > 0 ? (
                  <optgroup label="World Cup fixtures">
                    {fixtureGroups.worldCup.map((fixture) => (
                      <option value={fixture.fixtureId} key={fixture.fixtureId}>
                        {fixture.home.name} v {fixture.away.name} · {fixtureLifecycleLabel(fixture.startTime)} · {fixtureDateLabel(fixture.startTime)}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
                {fixtureGroups.other.length > 0 ? (
                  <optgroup label={pipelineRehearsal ? "Synthetic rehearsal fixture" : "Other covered fixtures"}>
                    {fixtureGroups.other.map((fixture) => (
                      <option value={fixture.fixtureId} key={fixture.fixtureId}>
                        {fixture.home.name} v {fixture.away.name} · {fixtureLifecycleLabel(fixture.startTime)} · {fixtureDateLabel(fixture.startTime)}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
              </select>
              <small role={fixtureError ? "alert" : undefined}>
                {fixturesLoading
                  ? "Loading the runtime catalogue…"
                  : fixtureError ?? `${fixtures.length} ${pipelineRehearsal ? "synthetic" : "covered"} fixtures returned by the configured runtime.`}
              </small>
              {fixtureError && !fixturesLoading ? (
                <button
                  className="button secondary"
                  type="button"
                  onClick={() => {
                    setFixturesLoading(true);
                    setFixtureError(null);
                    setFixtureReload((attempt) => attempt + 1);
                  }}
                >
                  Retry fixture catalogue
                </button>
              ) : null}
            </div>
            <div className="live-score-context">
              <p className="eyebrow">{displayFixture?.competition ?? (pipelineRehearsal ? "Synthetic rehearsal feed" : "World Cup feed")}</p>
              <div className="scoreline">
                <span>{displayFixture?.home.name ?? "HOME"}</span>
                <strong>{engine?.scoreKnown.home ? engine.score.home : "—"}</strong>
                <span className="score-divider">–</span>
                <strong>{engine?.scoreKnown.away ? engine.score.away : "—"}</strong>
                <span>{displayFixture?.away.name ?? "AWAY"}</span>
              </div>
              <p className="fixture-meta">
                <span className="mono">{engine?.fixtureId ?? (selectedFixtureId || "NO FIXTURE")}</span>
                <span>{pipelineRehearsal ? "Synthetic StablePrice shape" : "TxLINE StablePrice"}</span>
                <span>Paper market</span>
              </p>
            </div>
            <div className="live-connect-control">
              <span
                className={`state-pill ${connectionPhase === "connected" ? "healthy" : connectionPhase === "failed" ? "danger" : "warning"}`}
                role="status"
                aria-live="polite"
              >
                <span className="state-dot" aria-hidden="true" />
                {connectionLabels[connectionPhase]}
              </span>
              {connectionPhase === "idle" || connectionPhase === "failed" ? (
                <button
                  ref={replaceDialogTriggerRef}
                  className="button primary"
                  onClick={requestConnect}
                  disabled={connectDisabledReason !== null && connectDisabledReason !== "A saved paper session exists. You will be asked to export or replace it before connecting."}
                >
                  {pipelineRehearsal
                    ? engine?.status === "CLOSED"
                      ? "Run rehearsal again"
                      : "Start pipeline rehearsal"
                    : engine?.status === "CLOSED"
                      ? "Start new paper session"
                      : "Connect live fixture"}
                </button>
              ) : (
                <button className="button secondary" onClick={disconnect}>Disconnect</button>
              )}
              {connectDisabledReason ? (
                <small>{connectDisabledReason}</small>
              ) : null}
              {!pipelineRehearsal && storedSession && !storageLocked ? (
                <small>Starting again replaces the saved session record. Export it first if its evidence is needed.</small>
              ) : null}
              {connectionError || snapshotWarning ? (
                <small role={connectionError ? "alert" : "status"}>
                  {connectionError ?? snapshotWarning}
                </small>
              ) : null}
            </div>
          </section>

          <section className="panel fixture-queue" aria-labelledby="fixture-queue-title">
            <div className="panel-heading compact">
              <div>
                <p className="eyebrow">
                  {fixtureGroups.worldCup.length > 0
                    ? "World Cup match queue"
                    : pipelineRehearsal
                      ? "Synthetic rehearsal queue"
                      : "Covered fixture queue"}
                </p>
                <h2 id="fixture-queue-title">One fixture monitored at a time</h2>
              </div>
              <span className="state-pill warning">
                <span className="state-dot" aria-hidden="true" />
                {engineActive
                  ? `1 monitored · ${fixtureGroups.worldCup.length || fixtures.length} available`
                  : `0 monitored · ${fixtureGroups.worldCup.length || fixtures.length} available`}
              </span>
            </div>
            <p className="fixture-queue-note">
              Schedule windows are inferred from kick-off time. Only the connected fixture is monitored; other fixtures receive no risk decisions.
            </p>
            <div className="fixture-queue-groups">
              {([
                ["Live window", fixtureQueue.live],
                ["Upcoming", fixtureQueue.upcoming],
                ["Earlier", fixtureQueue.earlier],
              ] as const).map(([label, group]) => (
                <section className="fixture-queue-group" key={label} aria-label={`${label} fixtures`}>
                  <header>
                    <h3>{label}</h3>
                    <span>{group.length}</span>
                  </header>
                  {group.length > 0 ? (
                    <ul>
                      {group.slice(0, 4).map((fixture) => {
                        const monitored = engineActive && engine?.fixtureId === String(fixture.fixtureId);
                        const selected = selectedFixtureId === String(fixture.fixtureId);
                        return (
                          <li key={fixture.fixtureId}>
                            <div>
                              <strong>{fixture.home.name} v {fixture.away.name}</strong>
                              <span>{fixtureDateLabel(fixture.startTime)} · {fixtureLifecycleLabel(fixture.startTime)}</span>
                            </div>
                            <button
                              className="button quiet"
                              type="button"
                              disabled={monitored || (connectionPhase !== "idle" && connectionPhase !== "failed")}
                              onClick={() => changeFixture(String(fixture.fixtureId))}
                            >
                              {monitored ? "Monitored" : selected ? "Selected" : "Select for monitoring"}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p>No fixtures in this schedule group.</p>
                  )}
                  {group.length > 4 ? <small>Showing 4 of {group.length}; use the covered fixture selector for the full catalogue.</small> : null}
                </section>
              ))}
            </div>
          </section>

          <section className="kpi-grid" aria-label="Live agent summary">
            <article className="kpi-card panel">
              <span>Market state</span>
              <strong className={`metric-${engine ? liveStatusTone[engine.status] : "neutral"}`}>
                {engine?.status ?? "OFFLINE"}
              </strong>
              <small>{engine?.reason ?? "Choose a fixture and connect."}</small>
            </article>
            <article className="kpi-card panel">
              <span>Open paper orders</span>
              <strong>{activeOrders.length}</strong>
              <small>Six per active quote epoch</small>
            </article>
            <article className="kpi-card panel">
              <span>Open quoted quantity</span>
              <strong>{openQuotedQuantity.toLocaleString()}</strong>
              <small>Remaining paper units; no real orders</small>
            </article>
            <article className="kpi-card panel">
              <span>{pipelineRehearsal ? "Last synthetic score sequence" : "Last real score sequence"}</span>
              <strong>{engine?.lastScoreSeq ?? "—"}</strong>
              <small>
                {pipelineRehearsal
                  ? "Exercises binding only; cannot become verified"
                  : "Preserved for proof requests; never manufactured"}
              </small>
            </article>
            <article className="kpi-card panel">
              <span>Worst-case paper liability</span>
              <strong>{paperRisk ? `${paperRisk.liability.toFixed(2)} / ${paperRisk.maximumLiability.toFixed(0)}` : "—"}</strong>
              <small>{paperRisk ? `${paperRisk.remainingLiability.toFixed(2)} capacity remaining` : "No paper risk ledger"}</small>
            </article>
            <article className="kpi-card panel">
              <span>Mark-to-market paper P&amp;L</span>
              <strong className={paperRisk && (paperRisk.markToMarketPnl ?? 0) < 0 ? "metric-danger" : "metric-healthy"}>
                {paperRisk?.markToMarketPnl == null ? "—" : paperRisk.markToMarketPnl.toFixed(2)}
              </strong>
              <small>{engine ? `${engine.paperFills.length} fills · ${paperRisk?.filledNotional.toFixed(2) ?? "0.00"} filled notional` : "Deterministic paper fills only"}</small>
            </article>
          </section>

          <section className="panel trading-scorecard" aria-label="Trading agent scorecard">
            <div className="panel-heading compact">
              <div>
                <p className="eyebrow">Trading-agent scorecard</p>
                <h2>What the agent proves during this run</h2>
              </div>
            </div>
            <div className="scorecard-grid">
              <div><span>Time to suspend</span><strong>{formatDuration(scorecard.suspendLatency)}</strong></div>
              <div><span>Safe reopen delay</span><strong>{formatDuration(scorecard.reopenDelay)}</strong></div>
              <div><span>Stale quotes cancelled</span><strong>{scorecard.cancelledOrders}</strong></div>
              <div><span>Rejected toxic fills</span><strong>{scorecard.rejectedFills}</strong></div>
              <div><span>Paper P&amp;L impact</span><strong>{scorecard.pnl === null ? "Not marked" : scorecard.pnl.toFixed(2)}</strong></div>
              <div><span>Proof state</span><strong>{scorecard.proofState.replaceAll("_", " ")}</strong></div>
            </div>
          </section>

          <section className="workspace">
            <div className="workspace-main">
              <section className="panel market-panel">
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">{pipelineRehearsal ? "Production-path rehearsal" : "Live consensus engine"}</p>
                    <h1>Protected StablePrice paper quotes</h1>
                  </div>
                  <div className="panel-heading-meta">
                    <span>
                      {pipelineRehearsal
                        ? "Synthetic Pct contract through the production live reducer"
                        : "TxLINE consensus Pct; no fabricated bookmaker quorum"}
                    </span>
                    <span>
                      {engine
                        ? `${(engine.policy.shockDelta * 100).toFixed(2)}pp / ${(engine.policy.shockWindowMs / 1_000).toFixed(2)}s shock policy · ${engine.policy.stableObservationsRequired}-observation recovery`
                        : "Configured circuit breaker and recovery policy"}
                    </span>
                  </div>
                </div>
                <div className="probability-grid">
                  {(quotes.length ? quotes : ["HOME", "DRAW", "AWAY"].map((outcome) => ({ outcome, fair: null, bid: null, ask: null, quantity: 0, state: "WAITING" }))).map((quote) => (
                    <article className="probability-card" key={quote.outcome}>
                      <div className="probability-topline">
                        <span>{quote.outcome === "HOME" ? displayFixture?.home.name ?? "Home" : quote.outcome === "AWAY" ? displayFixture?.away.name ?? "Away" : "Draw"}</span>
                        <span className="mono">{probability(quote.fair)}</span>
                      </div>
                      <div className="probability-track" style={{ "--probability": `${(quote.fair ?? 0) * 100}%` } as CSSProperties}><span /></div>
                      <div className="probability-change"><span>StablePrice fair</span><span>{quote.state}</span></div>
                    </article>
                  ))}
                </div>
                <div className="table-wrap">
                  <table className="quote-table">
                    <caption className="sr-only">
                      {pipelineRehearsal ? "Synthetic production-path paper quote book" : "Live TxLINE paper quote book"}
                    </caption>
                    <thead><tr><th>Outcome</th><th>Fair %</th><th>Bid %</th><th>Ask %</th><th>Paper size</th><th>State</th></tr></thead>
                    <tbody>
                      {quotes.length > 0 ? (
                        quotes.map((quote) => (
                          <tr key={quote.outcome}>
                            <td><strong>{quote.outcome === "HOME" ? displayFixture?.home.name : quote.outcome === "AWAY" ? displayFixture?.away.name : "Draw"}</strong><span className="outcome-code">{quote.outcome}</span></td>
                            <td className="mono">{probability(quote.fair)}</td>
                            <td className="mono price-bid">{probability(quote.bid)}</td>
                            <td className="mono price-ask">{probability(quote.ask)}</td>
                            <td className="mono">{quote.quantity}</td>
                            <td><span className={`order-state ${quote.state === "OPEN" ? "open" : quote.state === "CLOSED" ? "closed" : "protected"}`}>{quote.state}</span></td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={6} className="table-empty-state">
                            Awaiting a valid score baseline and in-running StablePrice before paper quotes can open.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="panel event-stream">
                <div className="panel-heading compact">
                  <div><p className="eyebrow">Evidence log</p><h2>Live deterministic audit</h2></div>
                  <div className="evidence-panel-actions">
                    <button
                      ref={publicSummaryTriggerRef}
                      className="button secondary"
                      type="button"
                      onClick={openPublicSummaryPreview}
                      disabled={publicSummaryDisabledReason !== null}
                      title={publicSummaryDisabledReason ?? undefined}
                    >
                      {publicSummaryPreparing
                        ? "Preparing summary…"
                        : "Public demo summary"}
                    </button>
                    <button
                      ref={evidenceExportTriggerRef}
                      className="button secondary"
                      type="button"
                      onClick={openEvidencePreview}
                      disabled={evidenceDisabledReason !== null}
                      title={evidenceDisabledReason ?? undefined}
                    >
                      {evidencePreparing ? "Preparing evidence…" : "Inspect evidence pack"}
                    </button>
                  </div>
                </div>
                {publicSummaryDisabledReason || evidenceDisabledReason ? (
                  <p className="disabled-reason">
                    {publicSummaryDisabledReason ?? evidenceDisabledReason}
                  </p>
                ) : null}
                {!engine?.audit.length ? (
                  <div className="empty-state"><strong>No accepted live events</strong><p>Connect a covered fixture to start the paper session.</p></div>
                ) : (
                  <ol className="audit-list">
                    {engine.audit.map((entry) => (
                      <li key={entry.id} className={`audit-row tone-${entry.tone}`}>
                        <time className="mono">{entry.clock}</time>
                        <span className={`source source-${entry.source === "FEED" || entry.source === "TXLINE" ? "feed" : entry.source.toLowerCase()}`}>
                          {entry.source === "FEED" || entry.source === "TXLINE"
                            ? pipelineRehearsal
                              ? "REHEARSAL"
                              : "TXLINE"
                            : entry.source}
                        </span>
                        <div><strong>{entry.title}</strong><p>{entry.detail}</p></div>
                      </li>
                    ))}
                  </ol>
                )}
              </section>

              <section className="panel timeline-panel" aria-label="Fixture decision timeline">
                <div className="panel-heading compact">
                  <div>
                    <p className="eyebrow">Fixture timeline</p>
                    <h2>Odds, score, agent and paper events</h2>
                  </div>
                </div>
                {timelineItems.length > 0 ? (
                  <ol className="timeline-list">
                    {timelineItems.map((item) => (
                      <li className={`timeline-${item.tone}`} key={item.id}>
                        <time className="mono">{item.clock}</time>
                        <span>{item.source}</span>
                        <div>
                          <strong>{item.title}</strong>
                          <p>{item.detail}</p>
                        </div>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <div className="empty-state">
                    <strong>No timeline yet</strong>
                    <p>Connect or rehearse a fixture to see ordered feed, agent, command and fill events.</p>
                  </div>
                )}
              </section>
            </div>

            <aside className="workspace-side">
              <section className={`panel decision-card decision-${engine ? liveStatusTone[engine.status] : "neutral"}`}>
                <p className="eyebrow">Current decision</p>
                <h2>{engine?.status ?? "Not connected"}</h2>
                <p className="decision-copy">{engine?.reason ?? "No live policy state exists yet."}</p>
                <div className="evidence-metrics">
                  <div className="evidence-metric"><span>Largest movement</span><strong>{engine ? `${(engine.lastMovement * 100).toFixed(2)}pp` : "—"}</strong></div>
                  <div className="evidence-metric"><span>Stable observations</span><strong>{engine ? `${engine.stableObservations} / ${engine.policy.stableObservationsRequired}` : "—"}</strong></div>
                  <div className="evidence-metric"><span>Odds transport age</span><strong>{health?.transportAgeMs.ODDS == null ? "—" : `${health.transportAgeMs.ODDS.toLocaleString()}ms`}</strong></div>
                  <div className="evidence-metric"><span>Scores transport age</span><strong>{health?.transportAgeMs.SCORES == null ? "—" : `${health.transportAgeMs.SCORES.toLocaleString()}ms`}</strong></div>
                </div>
                <dl className="decision-facts">
                  <div><dt>Consensus</dt><dd>{pipelineRehearsal ? "Synthetic StablePrice-shaped Pct" : "TxLINE StablePrice Pct"}</dd></div>
                  <div><dt>Execution</dt><dd>Paper commands only</dd></div>
                  <div><dt>Transport</dt><dd>Heartbeat-aware, {engine ? `${(engine.policy.transportTimeoutMs / 1_000).toLocaleString()}s timeout` : "configured timeout"}</dd></div>
                  <div><dt>Source price</dt><dd>{health?.priceSourceAgeMs == null ? "Awaiting price" : `${health.priceSourceAgeMs.toLocaleString()}ms old`}</dd></div>
                </dl>
              </section>

              <section className="panel paper-risk-card">
                <div className="panel-heading compact">
                  <div><p className="eyebrow">Paper risk controls</p><h2>Fill and kill-switch rehearsal</h2></div>
                </div>
                <p className="decision-copy">
                  Fill price and quantity are derived from the working paper order. The liability guard rejects a fill before it can exceed policy.
                </p>
                <dl className="decision-facts">
                  <div><dt>Cash</dt><dd>{paperRisk?.cash.toFixed(2) ?? "—"}</dd></div>
                  <div><dt>Inventory</dt><dd>{paperRisk ? `H ${paperRisk.inventory.HOME.toFixed(2)} · D ${paperRisk.inventory.DRAW.toFixed(2)} · A ${paperRisk.inventory.AWAY.toFixed(2)}` : "—"}</dd></div>
                  <div><dt>Worst / best case</dt><dd>{paperRisk ? `${paperRisk.worstCasePnl.toFixed(2)} / ${paperRisk.bestCasePnl.toFixed(2)}` : "—"}</dd></div>
                  <div><dt>Emergency stop</dt><dd>{engine?.emergencyStop ? "Latched" : "Ready"}</dd></div>
                </dl>
                <div className="paper-risk-actions">
                  <button className="button secondary" type="button" onClick={simulatePaperFill} disabled={fillDisabledReason !== null} title={fillDisabledReason ?? undefined}>
                    Apply deterministic 25% fill
                  </button>
                  <button
                    ref={emergencyStopTriggerRef}
                    className="button danger"
                    type="button"
                    onClick={openEmergencyStopDialog}
                    disabled={emergencyStopDisabledReason !== null}
                    title={emergencyStopDisabledReason ?? undefined}
                  >
                    Emergency stop
                  </button>
                </div>
              </section>

              <section className="panel readiness-card" aria-busy={proofLoading}>
                <div className="panel-heading compact"><div><p className="eyebrow">Solana evidence</p><h2>Score-stat proof</h2></div></div>
                <p className="decision-copy">
                  {pipelineRehearsal
                    ? "Exercise the proof boundary with the last synthetic sequence. No proof or Solana verification is manufactured."
                    : "Request goals and red-card stats for the last real TxLINE score sequence. Proof retrieval is not itself on-chain verification."}
                </p>
                <button className="button secondary full" onClick={requestProof} disabled={proofDisabledReason !== null} title={proofDisabledReason ?? undefined}>
                  {proofLoading ? "Requesting proof…" : "Request proof evidence"}
                </button>
                {proofDisabledReason ? <small className="disabled-reason">{proofDisabledReason}</small> : null}
                {proof ? (
                  <div className="proof-result" role="status" aria-live="polite">
                    <span>{proof.state.replaceAll("_", " ")}</span>
                    <strong>{proof.verified ? "Verified" : "Not verified"}</strong>
                    <p>{proof.message}</p>
                    <dl className="proof-binding">
                      <div><dt>Fixture</dt><dd className="mono">{proof.fixtureId}</dd></div>
                      <div><dt>Score sequence</dt><dd className="mono">{proof.seq}</dd></div>
                      {proof.proof ? (
                        <>
                          <div><dt>Proof timestamp</dt><dd>{timestampLabel(proof.proof.proofTimestamp)}</dd></div>
                          <div><dt>Update count</dt><dd className="mono">{proof.proof.updateCount}</dd></div>
                        </>
                      ) : null}
                    </dl>
                    {proof.proof ? (
                      <ul className="proof-stat-list" aria-label="Score statistics in the proof">
                        {proof.proof.stats.map((stat) => (
                          <li key={stat.key}>
                            <div>
                              <strong>{scoreProofStatLabel(stat.key, proofFixture)}</strong>
                              <small>Key {stat.key} · {stat.period === 0 ? "full match" : `period ${stat.period}`}</small>
                            </div>
                            <b className="mono">{stat.value}</b>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {proof.validation ? (
                      <dl className="proof-runtime">
                        <div><dt>Read-only view</dt><dd>{proof.validation.state.replaceAll("_", " ")}</dd></div>
                        <div><dt>Network</dt><dd>{proof.validation.rpcNetwork.toUpperCase()}</dd></div>
                        <div><dt>Epoch day</dt><dd className="mono">{proof.validation.epochDay}</dd></div>
                        <div className="proof-program"><dt>Programme</dt><dd className="mono">{proof.validation.programId}</dd></div>
                      </dl>
                    ) : null}
                  </div>
                ) : null}
              </section>

              <section className="panel sponsor-evidence-card">
                <div className="panel-heading compact">
                  <div><p className="eyebrow">Sponsor evidence</p><h2>Claim boundary</h2></div>
                </div>
                <ul>
                  <li><span>Data source</span><strong>{runtimeSource === "txline" ? "TxLINE private" : "Synthetic rehearsal"}</strong></li>
                  <li><span>Execution</span><strong>Paper only</strong></li>
                  <li><span>Raw licensed data</span><strong>{runtimeSource === "txline" ? "Private export only" : "Not present"}</strong></li>
                  <li><span>Proof request</span><strong>{proof?.state.replaceAll("_", " ") ?? "Not requested"}</strong></li>
                  <li><span>Solana verified</span><strong>{proof?.verified ? "Yes" : "No claim"}</strong></li>
                  <li><span>Public artefact</span><strong>{runtimeSource === "synthetic" ? "Allowed" : "Blocked"}</strong></li>
                </ul>
              </section>

              <section className="panel readiness-card">
                <div className="panel-heading compact"><div><p className="eyebrow">Runtime</p><h2>Adapter status</h2></div></div>
                <ul>
                  <li><span>Fixture discovery</span><strong>{fixturesLoading ? "Loading" : fixtureError ? "Unavailable" : pipelineRehearsal ? "Synthetic" : "Configured"}</strong></li>
                  <li><span>Odds SSE</span><strong>{channelOpen.odds ? "Streaming" : connectionLabels[connectionPhase]}</strong></li>
                  <li><span>Scores SSE</span><strong>{channelOpen.scores ? "Streaming" : connectionLabels[connectionPhase]}</strong></li>
                  <li><span>Paper execution</span><strong className="ready">Available</strong></li>
                  <li><span>Solana validation</span><strong>{status?.capabilities.onchainValidation ? "Configured" : "Not configured"}</strong></li>
                </ul>
              </section>
            </aside>
          </section>
        </>
      )}

      <section className="panel readiness-matrix">
        <div className="panel-heading compact"><div><p className="eyebrow">Runtime capability report</p><h2>Application boundaries</h2></div></div>
        <div className="readiness-table">
          <div><span>Deterministic World Cup replay</span><strong className="ready">Available</strong></div>
          <div><span>Paper quote execution and audit</span><strong className="ready">Available</strong></div>
          <div><span>Production-path synthetic rehearsal</span><strong className="ready">{pipelineRehearsal ? "Running" : "Available"}</strong></div>
          <div><span>Device-local session evidence</span><strong className="ready">Available</strong></div>
          <div><span>Authenticated TxLINE snapshots and SSE</span><strong>{liveConfigured ? "Configured" : "Awaiting token"}</strong></div>
          <div><span>On-chain score-stat validation</span><strong>{status?.capabilities.onchainValidation ? "Configured" : "Awaiting runtime"}</strong></div>
        </div>
      </section>

      <dialog
        ref={emergencyStopDialogRef}
        className="evidence-dialog clear-session-dialog"
        aria-labelledby="emergency-stop-title"
        aria-describedby="emergency-stop-description"
        onCancel={closeEmergencyStopDialog}
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) closeEmergencyStopDialog();
        }}
      >
        <section>
          <div className="dialog-header">
            <div>
              <p className="eyebrow">Permanent paper-session protection</p>
              <h2 id="emergency-stop-title">Engage the emergency stop?</h2>
            </div>
            <button className="dialog-close" type="button" onClick={closeEmergencyStopDialog}>
              Cancel
            </button>
          </div>
          <p className="dialog-warning" id="emergency-stop-description">
            This cancels every open paper order and latches the current session in a suspended state. It cannot be reopened; start a new paper session to quote again.
          </p>
          <div className="local-session-actions">
            <button className="button secondary" type="button" onClick={closeEmergencyStopDialog}>
              Keep session running
            </button>
            <button className="button danger" type="button" onClick={confirmEmergencyStop}>
              Engage emergency stop
            </button>
          </div>
        </section>
      </dialog>

      <dialog
        ref={publicSummaryDialogRef}
        className="evidence-dialog evidence-export-dialog"
        aria-labelledby="public-demo-summary-title"
        aria-describedby="public-demo-summary-description"
        onCancel={closePublicSummaryPreview}
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) closePublicSummaryPreview();
        }}
      >
        <section>
          <div className="dialog-header">
            <div>
              <p className="eyebrow">Synthetic-only public artefact</p>
              <h2 id="public-demo-summary-title">Public demo summary</h2>
            </div>
            <button className="dialog-close" type="button" onClick={closePublicSummaryPreview}>
              Close
            </button>
          </div>
          <p id="public-demo-summary-description">
            A concise, versioned summary of aggregate agent behaviour. It excludes raw events, price history, working orders and proof material.
          </p>
          {publicSummaryBlocked ? (
            <div className="public-summary-blocked" role="alert">
              <strong>Live-source public download blocked</strong>
              <p>{publicSummaryBlocked}</p>
              <p>
                Use the synthetic rehearsal to create a public demo artefact. Do not publish or redistribute a TxLINE-derived summary unless the sponsor gives explicit permission.
              </p>
            </div>
          ) : null}
          {publicSummaryPreview ? (
            <>
              <dl className="evidence-export-summary">
                <div><dt>Schema</dt><dd className="mono">{publicSummaryPreview.summary.schema}</dd></div>
                <div><dt>Source</dt><dd>Synthetic rehearsal only</dd></div>
                <div><dt>Fixture</dt><dd>{publicSummaryPreview.summary.run.fixtureLabel}</dd></div>
                <div><dt>Decision state</dt><dd>{publicSummaryPreview.summary.agent.decisionState}</dd></div>
                <div><dt>Quote epochs</dt><dd>{publicSummaryPreview.summary.agent.quoteEpochs}</dd></div>
                <div><dt>Retained orders / total cancellations</dt><dd>{publicSummaryPreview.summary.agent.retainedOrderRecords} / {publicSummaryPreview.summary.agent.cancelledOrders}</dd></div>
                <div><dt>Retained fills / total rejects</dt><dd>{publicSummaryPreview.summary.agent.retainedPaperFillRecords} / {publicSummaryPreview.summary.agent.paperFillRejects}</dd></div>
                <div><dt>Liability / policy maximum</dt><dd>{publicSummaryPreview.summary.agent.liability.toFixed(2)} / {publicSummaryPreview.summary.agent.maximumLiability.toFixed(2)}</dd></div>
                <div><dt>Mark-to-market P&amp;L</dt><dd>{publicSummaryPreview.summary.agent.markToMarketPnl?.toFixed(2) ?? "Not available"}</dd></div>
                <div><dt>Exact file size</dt><dd>{publicSummaryPreview.byteLength.toLocaleString()} bytes</dd></div>
                <div className="evidence-export-checksum"><dt>SHA-256 checksum</dt><dd className="mono">{publicSummaryPreview.checksum}</dd></div>
              </dl>
              <ul className="public-summary-boundaries" aria-label="Public summary boundaries">
                <li>Synthetic data only; not evidence of a live TxLINE run.</li>
                <li>Paper execution only; no bet, order or transaction was submitted.</li>
                <li>No raw event payloads, price history, TxLINE-derived data or Solana proof.</li>
              </ul>
              <p className="dialog-warning">
                The checksum detects changed bytes. It is not a signature, sponsor attestation or on-chain verification.
              </p>
            </>
          ) : null}
          <div className="local-session-actions">
            <button className="button secondary" type="button" onClick={closePublicSummaryPreview}>
              Close
            </button>
            {publicSummaryPreview ? (
              <button className="button primary" type="button" onClick={downloadPublicSummaryPreview}>
                Download synthetic summary
              </button>
            ) : null}
          </div>
          <p className="evidence-download-status" role="status" aria-live="polite">
            {publicSummaryDownloadStatus}
          </p>
        </section>
      </dialog>

      <dialog
        ref={evidenceExportDialogRef}
        className="evidence-dialog evidence-export-dialog"
        aria-labelledby="evidence-export-title"
        aria-describedby="evidence-export-description"
        onCancel={closeEvidencePreview}
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) closeEvidencePreview();
        }}
      >
        <section>
          <div className="dialog-header">
            <div>
              <p className="eyebrow">Inspectable evidence export</p>
              <h2 id="evidence-export-title">Review the exact evidence boundary</h2>
            </div>
            <button className="dialog-close" type="button" onClick={closeEvidencePreview}>
              Close
            </button>
          </div>
          <p id="evidence-export-description">
            This preview describes the bytes that will be downloaded. The SHA-256 value is a local checksum, not a signature or Solana proof.
          </p>
          {evidencePreview ? (
            <>
              <dl className="evidence-export-summary">
                <div><dt>Source</dt><dd>{evidencePreview.source === "txline" ? "TxLINE" : "Synthetic rehearsal"}</dd></div>
                <div><dt>Fixture</dt><dd className="mono">{evidencePreview.fixtureId}</dd></div>
                <div><dt>Score sequence</dt><dd>{evidencePreview.scoreSequence ?? "Not observed"}</dd></div>
                <div><dt>Decision state</dt><dd>{evidencePreview.decisionState}</dd></div>
                <div><dt>Orders cancelled</dt><dd>{evidencePreview.cancelledOrders}</dd></div>
                <div><dt>Order/fill records</dt><dd>{evidencePreview.orderRecords} / {evidencePreview.fillRecords}</dd></div>
                <div><dt>Command records</dt><dd>{evidencePreview.commandRecords}</dd></div>
                <div><dt>Audit retention</dt><dd>{evidencePreview.auditRecords} retained · {evidencePreview.auditTruncated} earlier truncated</dd></div>
                <div><dt>Exact file size</dt><dd>{evidencePreview.byteLength.toLocaleString()} bytes</dd></div>
                <div><dt>Proof state</dt><dd>{evidencePreview.proofState.replaceAll("_", " ")}</dd></div>
                <div><dt>Saved revision</dt><dd>{evidencePreview.savedRevision ?? "Not written"}</dd></div>
                <div className="evidence-export-checksum"><dt>SHA-256 checksum</dt><dd className="mono">{evidencePreview.checksum}</dd></div>
              </dl>
              <p className="dialog-warning">
                Integrity: device-local unsigned. A matching checksum detects changed bytes but does not identify who created them.
              </p>
              {evidencePreview.source === "txline" ? (
                <p className="dialog-warning">
                  Licensed-data boundary: this export contains TxLINE-derived prices and scores. Keep it private; do not publish or redistribute it.
                </p>
              ) : null}
            </>
          ) : null}
          <div className="local-session-actions">
            <button className="button secondary" type="button" onClick={closeEvidencePreview}>
              Cancel
            </button>
            <button className="button primary" type="button" onClick={downloadEvidencePreview} disabled={!evidencePreview}>
              Download evidence pack
            </button>
          </div>
          <p className="evidence-download-status" role="status" aria-live="polite">
            {evidenceDownloadStatus}
          </p>
        </section>
      </dialog>

      <dialog
        ref={clearDialogRef}
        className="evidence-dialog clear-session-dialog"
        aria-labelledby="clear-session-title"
        aria-describedby="clear-session-description"
        onCancel={closeClearDialog}
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) closeClearDialog();
        }}
      >
        <section>
          <div className="dialog-header">
            <div>
              <p className="eyebrow">Local evidence boundary</p>
              <h2 id="clear-session-title">Clear this device-local paper session?</h2>
            </div>
            <button
              className="dialog-close"
              type="button"
              onClick={closeClearDialog}
            >
              Cancel
            </button>
          </div>
          <div className="dialog-section">
            <p className="dialog-warning" id="clear-session-description">
              This removes the local paper state, orders, commands and audit evidence only. It does not remove TxLINE server configuration or any Solana account.
            </p>
          </div>
          <div className="local-session-actions">
            <button className="button secondary" type="button" onClick={exportLocalSession}>
              Export first
            </button>
            <button className="button danger" type="button" onClick={clearLocalSession}>
              Clear local session
            </button>
          </div>
        </section>
      </dialog>

      <dialog
        ref={replaceDialogRef}
        className="evidence-dialog clear-session-dialog"
        aria-labelledby="replace-session-title"
        aria-describedby="replace-session-description"
        onCancel={closeReplaceDialog}
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) closeReplaceDialog();
        }}
      >
        <section>
          <div className="dialog-header">
            <div>
              <p className="eyebrow">Evidence replacement guard</p>
              <h2 id="replace-session-title">Replace the saved paper session?</h2>
            </div>
            <button className="dialog-close" type="button" onClick={closeReplaceDialog}>
              Cancel
            </button>
          </div>
          <div className="dialog-section">
            <p className="dialog-warning" id="replace-session-description">
              Starting this live fixture will replace the single device-local evidence record. This cannot be undone inside ProofSwitch.
            </p>
            {storedSession ? (
              <dl className="replacement-session-summary">
                <div><dt>Fixture</dt><dd>{storedSession.scope.fixture.home.name} v {storedSession.scope.fixture.away.name}</dd></div>
                <div><dt>Network</dt><dd>{storedSession.scope.network.toUpperCase()}</dd></div>
                <div><dt>Revision</dt><dd>{storedSession.revision}</dd></div>
                <div><dt>Saved</dt><dd>{new Date(storedSession.savedAtMs).toLocaleString("en-GB")}</dd></div>
              </dl>
            ) : null}
          </div>
          <div className="local-session-actions">
            <button className="button secondary" type="button" onClick={exportLocalSession}>
              Export first
            </button>
            <button className="button danger" type="button" onClick={confirmReplacement} disabled={!storedSession}>
              Replace and connect
            </button>
          </div>
        </section>
      </dialog>
    </main>
  );
}
