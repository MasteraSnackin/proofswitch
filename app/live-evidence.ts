import type { AppStatus, Fixture } from "../lib/contracts";
import {
  selectLivePaperRisk,
  type LiveAuditEntry,
  type LiveEngineHealth,
  type LiveEngineState,
  type LiveExecutionCommand,
  type LivePaperFill,
  type LivePaperOrder,
  type LivePaperRisk,
  type LivePolicy,
} from "./live-engine.ts";
import {
  PAPER_SESSION_LIMITS,
  type PaperSessionFixture,
  type PaperSessionRetention,
  type PaperSessionV1,
} from "./live-session.ts";

export const SCORE_PROOF_STAT_KEYS = Object.freeze([1, 2, 5, 6] as const);

/**
 * Hard export boundaries. These match the largest retained paper-session
 * histories and keep evidence generation bounded before any sorting or copy.
 * An export is rejected when a boundary is crossed; evidence is never silently
 * truncated because doing so could sever order/fill/command relationships.
 */
export const LIVE_EVIDENCE_RECORD_LIMITS = Object.freeze({
  orders: PAPER_SESSION_LIMITS.orders,
  fills: PAPER_SESSION_LIMITS.fills,
  executionCommands: PAPER_SESSION_LIMITS.commands,
  audit: PAPER_SESSION_LIMITS.audit,
} as const);

/** Maximum encoded size of a complete evidence JSON document (2 MiB). */
export const LIVE_EVIDENCE_MAX_UTF8_BYTES = 2 * 1024 * 1024;

export type ScoreProofStatKey = (typeof SCORE_PROOF_STAT_KEYS)[number];

export type LiveProofState =
  | "UNCONFIGURED"
  | "PROOF_PENDING"
  | "PROOF_READY"
  | "VALIDATION_REQUIRES_RUNTIME"
  | "VERIFIED"
  | "PREDICATE_FALSE"
  | "ROOT_PENDING"
  | "INVALID_PROOF"
  | "RUNTIME_UNCONFIGURED"
  | "RUNTIME_FAILURE";

export type LiveSolanaValidationState =
  | "VERIFIED"
  | "PREDICATE_FALSE"
  | "ROOT_PENDING"
  | "INVALID_PROOF"
  | "RUNTIME_UNCONFIGURED"
  | "RUNTIME_FAILURE";

export interface LiveProofStat {
  key: ScoreProofStatKey;
  value: number;
  period: number;
}

export interface LiveScoreProofSummary {
  proofTimestamp: number;
  updateCount: number;
  stats: LiveProofStat[];
}

export interface LiveProofValidation {
  state: LiveSolanaValidationState;
  verified: boolean;
  message: string;
  programId: string;
  rpcNetwork: "devnet";
  epochDay: number;
}

/** The safe browser shape returned by the local `/api/verify` boundary. */
export interface LiveProofResult {
  state: LiveProofState;
  verified: boolean;
  fixtureId: number;
  seq: number;
  statKeys: [...typeof SCORE_PROOF_STAT_KEYS];
  message: string;
  proof: LiveScoreProofSummary | null;
  validation: LiveProofValidation | null;
}

export type LiveTransportPhase =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "failed";

export interface LiveEvidenceTransportInput {
  phase: LiveTransportPhase;
  channels: {
    odds: boolean;
    scores: boolean;
  };
  health: LiveEngineHealth | null;
}

export interface BuildLiveEvidencePackInput {
  generatedAt?: Date | string | number;
  source: "txline" | "synthetic";
  appStatus: AppStatus;
  fixture: Fixture | PaperSessionFixture;
  engine: LiveEngineState;
  transport: LiveEvidenceTransportInput;
  proof?: LiveProofResult | null;
  savedSession?: PaperSessionV1 | null;
}

export type LiveDecisionEvidence = Omit<
  LiveEngineState,
  | "policy"
  | "paperOrders"
  | "paperFills"
  | "executionCommands"
  | "audit"
  | "priceHistory"
  | "seenOddsMessageIds"
  | "seenOddsSseIds"
  | "seenScoreKeys"
  | "seenMaterialSignalIds"
  | "seenPaperFillIds"
>;

export interface LiveEvidenceProofBinding {
  requested: boolean;
  proofPresent: boolean;
  fixtureId: number;
  scoreSeq: number | null;
  proofFixtureId: number | null;
  proofSeq: number | null;
  fixtureMatches: boolean;
  sequenceMatches: boolean;
  boundToCurrentDecision: boolean;
  verified: boolean;
}

export interface LiveEvidenceSavedSession {
  schema: PaperSessionV1["schema"];
  version: PaperSessionV1["version"];
  engineSchema: PaperSessionV1["engineSchema"];
  integrity: PaperSessionV1["integrity"];
  sessionId: string;
  revision: number;
  savedAtMs: number;
  retention: PaperSessionRetention;
}

export interface LiveEvidencePack {
  schema: "proofswitch.live-evidence.v1";
  generatedAt: string;
  integrity: "device-local-unsigned";
  source: "txline" | "synthetic";
  execution: "paper-only";
  network: AppStatus["network"];
  capabilities: AppStatus["capabilities"];
  limitations: string[];
  solana: {
    network: AppStatus["solana"]["network"];
    programId: string;
    validationEnabled: boolean;
    runtimeConfigured: boolean;
  };
  policy: LivePolicy;
  fixture: Fixture | PaperSessionFixture;
  transport: LiveEvidenceTransportInput;
  decision: LiveDecisionEvidence;
  orders: LivePaperOrder[];
  fills: LivePaperFill[];
  risk: LivePaperRisk;
  executionCommands: LiveExecutionCommand[];
  audit: LiveAuditEntry[];
  proof: LiveProofResult | null;
  proofBinding: LiveEvidenceProofBinding;
  savedSession?: LiveEvidenceSavedSession;
}

export interface SerialisedLiveEvidencePack {
  /** Canonical, two-space-indented JSON with object keys in lexical order. */
  contents: string;
  /** Exact UTF-8 byte length of `contents`. */
  bytes: number;
}

type UnknownRecord = Record<string, unknown>;

const proofStates = new Set<LiveProofState>([
  "UNCONFIGURED",
  "PROOF_PENDING",
  "PROOF_READY",
  "VALIDATION_REQUIRES_RUNTIME",
  "VERIFIED",
  "PREDICATE_FALSE",
  "ROOT_PENDING",
  "INVALID_PROOF",
  "RUNTIME_UNCONFIGURED",
  "RUNTIME_FAILURE",
]);

const solanaValidationStates = new Set<LiveSolanaValidationState>([
  "VERIFIED",
  "PREDICATE_FALSE",
  "ROOT_PENDING",
  "INVALID_PROOF",
  "RUNTIME_UNCONFIGURED",
  "RUNTIME_FAILURE",
]);

function invalid(path: string, requirement: string): never {
  throw new TypeError(`${path} ${requirement}.`);
}

function record(value: unknown, path: string): UnknownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalid(path, "must be an object");
  }
  return value as UnknownRecord;
}

function text(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "" || value.length > 2_000) {
    return invalid(path, "must be a non-empty string no longer than 2,000 characters");
  }
  return value;
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") return invalid(path, "must be a boolean");
  return value;
}

function integer(
  value: unknown,
  path: string,
  minimum = 0,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    return invalid(path, `must be a safe integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function parseState(value: unknown): LiveProofState {
  const state = text(value, "proof.state") as LiveProofState;
  if (!proofStates.has(state)) return invalid("proof.state", "contains an unsupported value");
  return state;
}

function parseValidationState(value: unknown): LiveSolanaValidationState {
  const state = text(value, "proof.validation.state") as LiveSolanaValidationState;
  if (!solanaValidationStates.has(state)) {
    return invalid("proof.validation.state", "contains an unsupported value");
  }
  return state;
}

function parseStatKeys(value: unknown, path: string): [...typeof SCORE_PROOF_STAT_KEYS] {
  if (!Array.isArray(value) || value.length !== SCORE_PROOF_STAT_KEYS.length) {
    return invalid(path, `must contain exactly ${SCORE_PROOF_STAT_KEYS.join(",")}`);
  }
  for (let index = 0; index < SCORE_PROOF_STAT_KEYS.length; index += 1) {
    if (value[index] !== SCORE_PROOF_STAT_KEYS[index]) {
      return invalid(path, `must preserve the exact order ${SCORE_PROOF_STAT_KEYS.join(",")}`);
    }
  }
  return [...SCORE_PROOF_STAT_KEYS];
}

function parseProofSummary(value: unknown): LiveScoreProofSummary | null {
  if (value === null || value === undefined) return null;
  const parsed = record(value, "proof.proof");
  if (!Array.isArray(parsed.stats) || parsed.stats.length !== SCORE_PROOF_STAT_KEYS.length) {
    return invalid(
      "proof.proof.stats",
      `must contain exactly ${SCORE_PROOF_STAT_KEYS.length} ordered stats`,
    );
  }
  const stats = parsed.stats.map((entry, index): LiveProofStat => {
    const stat = record(entry, `proof.proof.stats[${index}]`);
    const key = integer(
      stat.key,
      `proof.proof.stats[${index}].key`,
      1,
      4_294_967_295,
    );
    if (key !== SCORE_PROOF_STAT_KEYS[index]) {
      return invalid(
        `proof.proof.stats[${index}].key`,
        `must be ${SCORE_PROOF_STAT_KEYS[index]} to preserve requested stat order`,
      );
    }
    return {
      key: key as ScoreProofStatKey,
      value: integer(
        stat.value,
        `proof.proof.stats[${index}].value`,
        0,
        2_147_483_647,
      ),
      period: integer(
        stat.period,
        `proof.proof.stats[${index}].period`,
        0,
        4_294_967_295,
      ),
    };
  });
  return {
    proofTimestamp: integer(parsed.proofTimestamp, "proof.proof.proofTimestamp"),
    updateCount: integer(
      parsed.updateCount,
      "proof.proof.updateCount",
      0,
      4_294_967_295,
    ),
    stats,
  };
}

function parseValidation(value: unknown): LiveProofValidation | null {
  if (value === null || value === undefined) return null;
  const parsed = record(value, "proof.validation");
  const programId = text(parsed.programId, "proof.validation.programId");
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(programId)) {
    return invalid("proof.validation.programId", "must be a base58 Solana public key");
  }
  if (parsed.rpcNetwork !== "devnet") {
    return invalid("proof.validation.rpcNetwork", "must be devnet");
  }
  return {
    state: parseValidationState(parsed.state),
    verified: boolean(parsed.verified, "proof.validation.verified"),
    message: text(parsed.message, "proof.validation.message"),
    programId,
    rpcNetwork: "devnet",
    epochDay: integer(parsed.epochDay, "proof.validation.epochDay", 0, 65_535),
  };
}

/**
 * Validate and strip a browser proof response before it becomes decision evidence.
 * A `verified` claim is accepted only when every response layer agrees that the
 * read-only Solana validation returned true.
 */
export function parseLiveProofResult(
  value: unknown,
  expectedFixtureId: number,
  expectedSeq: number,
): LiveProofResult {
  integer(expectedFixtureId, "expectedFixtureId", 1);
  integer(expectedSeq, "expectedSeq", 1);

  const parsed = record(value, "proof");
  const state = parseState(parsed.state);
  const verified = boolean(parsed.verified, "proof.verified");
  const fixtureId = integer(parsed.fixtureId, "proof.fixtureId", 1);
  const seq = integer(parsed.seq, "proof.seq", 1);
  if (fixtureId !== expectedFixtureId) {
    return invalid("proof.fixtureId", `must match requested fixture ${expectedFixtureId}`);
  }
  if (seq !== expectedSeq) {
    return invalid("proof.seq", `must match requested score sequence ${expectedSeq}`);
  }

  const statKeys = parseStatKeys(parsed.statKeys, "proof.statKeys");
  const message = text(parsed.message, "proof.message");
  const proof = parseProofSummary(parsed.proof);
  const validation = parseValidation(parsed.validation);
  const proofRequired =
    state === "PROOF_READY" ||
    state === "VALIDATION_REQUIRES_RUNTIME" ||
    solanaValidationStates.has(state as LiveSolanaValidationState);

  if (proofRequired && proof === null) {
    return invalid("proof.proof", `is required when state is ${state}`);
  }
  if (!proofRequired && proof !== null) {
    return invalid("proof.proof", `must be null when state is ${state}`);
  }
  if (validation !== null && proof === null) {
    return invalid("proof.validation", "requires proof evidence");
  }
  if (validation !== null) {
    if (validation.state !== state) {
      return invalid("proof.validation.state", "must match proof.state");
    }
    if (validation.verified !== verified) {
      return invalid("proof.validation.verified", "must match proof.verified");
    }
    if (validation.message !== message) {
      return invalid("proof.validation.message", "must match proof.message");
    }
  }

  const verifiedAtEveryLayer =
    state === "VERIFIED" &&
    proof !== null &&
    validation?.state === "VERIFIED" &&
    validation.verified === true;
  if (verified !== verifiedAtEveryLayer) {
    return invalid(
      "proof.verified",
      "can be true only when the proof and validation both report VERIFIED",
    );
  }

  return {
    state,
    verified,
    fixtureId,
    seq,
    statKeys,
    message,
    proof,
    validation,
  };
}

/** Return a participant-aware label for the documented soccer score stat key. */
export function scoreProofStatLabel(key: number, fixture?: Fixture): string {
  const definition = {
    1: { participant: 1, metric: "total goals" },
    2: { participant: 2, metric: "total goals" },
    5: { participant: 1, metric: "total red cards" },
    6: { participant: 2, metric: "total red cards" },
  }[key];
  if (!definition) return `Score stat ${key}`;

  const generic = `Participant ${definition.participant}`;
  if (!fixture) return `${generic} ${definition.metric}`;

  const participant = definition.participant === 1
    ? fixture.participant1
    : fixture.participant2;
  const participantIsHome = definition.participant === 1
    ? fixture.participant1IsHome
    : !fixture.participant1IsHome;
  return `${participant.name} (${participantIsHome ? "home" : "away"}) ${definition.metric}`;
}

function copyJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

type CanonicalJsonValue =
  | null
  | boolean
  | number
  | string
  | CanonicalJsonValue[]
  | { [key: string]: CanonicalJsonValue };

function compareText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function canonicalJsonValue(
  value: unknown,
  path: string,
  ancestors: Set<object>,
): CanonicalJsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(`${path} must contain only finite JSON numbers.`);
    }
    return value;
  }
  if (typeof value !== "object") {
    throw new TypeError(`${path} contains a value that cannot be serialised as JSON.`);
  }
  if (ancestors.has(value)) {
    throw new TypeError(`${path} must not contain a circular reference.`);
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((entry, index) =>
        canonicalJsonValue(entry, `${path}[${index}]`, ancestors),
      );
    }

    const canonical: { [key: string]: CanonicalJsonValue } = {};
    for (const key of Object.keys(value).sort(compareText)) {
      canonical[key] = canonicalJsonValue(
        (value as Record<string, unknown>)[key],
        `${path}.${key}`,
        ancestors,
      );
    }
    return canonical;
  } finally {
    ancestors.delete(value);
  }
}

function assertRecordLimit(
  label: keyof typeof LIVE_EVIDENCE_RECORD_LIMITS,
  count: number,
): void {
  const maximum = LIVE_EVIDENCE_RECORD_LIMITS[label];
  if (count > maximum) {
    throw new RangeError(
      `Evidence ${label} contains ${count} records; the maximum is ${maximum}. ` +
        "The evidence pack was not created because related records cannot be safely truncated.",
    );
  }
}

function assertEvidenceRecordLimits(
  value: Pick<LiveEvidencePack, "orders" | "fills" | "executionCommands" | "audit">,
): void {
  assertRecordLimit("orders", value.orders.length);
  assertRecordLimit("fills", value.fills.length);
  assertRecordLimit("executionCommands", value.executionCommands.length);
  assertRecordLimit("audit", value.audit.length);
}

/**
 * Serialise evidence deterministically and enforce the final encoded byte cap.
 * UTF-8 bytes, rather than JavaScript UTF-16 code units, are measured so the
 * boundary remains exact for participant names and other non-ASCII text.
 */
export function serialiseLiveEvidencePack(
  pack: LiveEvidencePack,
): SerialisedLiveEvidencePack {
  assertEvidenceRecordLimits(pack);
  const canonical = canonicalJsonValue(pack, "evidence", new Set());
  const contents = JSON.stringify(canonical, null, 2);
  const bytes = new TextEncoder().encode(contents).byteLength;
  if (bytes > LIVE_EVIDENCE_MAX_UTF8_BYTES) {
    throw new RangeError(
      `Evidence JSON is ${bytes} UTF-8 bytes; the maximum is ` +
        `${LIVE_EVIDENCE_MAX_UTF8_BYTES}. The evidence pack was not created.`,
    );
  }
  return { contents, bytes };
}

function generatedAt(value: BuildLiveEvidencePackInput["generatedAt"]): string {
  const date = value === undefined ? new Date() : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new RangeError("generatedAt must be a valid date.");
  }
  return date.toISOString();
}

function compareId(left: { id: string }, right: { id: string }) {
  return compareText(left.id, right.id);
}

/**
 * Keep volatile deduplication and price-window internals out of the evidence
 * decision. They are not needed to explain the current safety state and can
 * grow independently of the retained order/audit histories.
 */
function selectDecisionEvidence(engine: LiveEngineState): LiveDecisionEvidence {
  const decision: Partial<LiveEngineState> = { ...engine };
  delete decision.policy;
  delete decision.paperOrders;
  delete decision.paperFills;
  delete decision.executionCommands;
  delete decision.audit;
  delete decision.priceHistory;
  delete decision.seenOddsMessageIds;
  delete decision.seenOddsSseIds;
  delete decision.seenScoreKeys;
  delete decision.seenMaterialSignalIds;
  delete decision.seenPaperFillIds;
  return decision as LiveDecisionEvidence;
}

/** Build a self-contained, unsigned snapshot of one live paper decision session. */
export function buildLiveEvidencePack(
  input: BuildLiveEvidencePackInput,
): LiveEvidencePack {
  assertRecordLimit("orders", input.engine.paperOrders.length);
  assertRecordLimit("fills", input.engine.paperFills.length);
  assertRecordLimit("executionCommands", input.engine.executionCommands.length);
  assertRecordLimit("audit", input.engine.audit.length);

  const fixtureId = Number(input.engine.fixtureId);
  if (!Number.isSafeInteger(fixtureId) || fixtureId !== input.fixture.fixtureId) {
    throw new RangeError("The fixture and live engine fixture IDs must match.");
  }
  if (
    (input.source === "txline" && input.appStatus.mode !== "live") ||
    (input.source === "synthetic" && input.appStatus.mode !== "synthetic")
  ) {
    throw new RangeError("The evidence source must match the configured application mode.");
  }

  const currentScoreSeq = input.engine.lastScoreSeq;
  const proof = input.proof
    ? (() => {
        if (currentScoreSeq === null) {
          throw new RangeError("Proof evidence requires a current real score sequence.");
        }
        return parseLiveProofResult(input.proof, fixtureId, currentScoreSeq);
      })()
    : null;
  if (
    proof?.validation &&
    (input.appStatus.network !== proof.validation.rpcNetwork ||
      input.appStatus.solana.programId !== proof.validation.programId)
  ) {
    throw new RangeError(
      "The proof validation network and programme must match the runtime capability report.",
    );
  }

  if (input.savedSession) {
    if (
      input.savedSession.scope.fixture.fixtureId !== fixtureId ||
      input.savedSession.scope.network !== input.appStatus.network
    ) {
      throw new RangeError("The saved session must match the evidence fixture and network.");
    }
  }

  const { policy, paperOrders, paperFills, executionCommands, audit } = input.engine;
  const decision = selectDecisionEvidence(input.engine);
  const chronologicalAudit = [...audit]
    .reverse()
    .sort((left, right) => left.atMs - right.atMs || compareId(left, right));
  const chronologicalOrders = [...paperOrders].sort(
    (left, right) => left.createdAtMs - right.createdAtMs || compareId(left, right),
  );
  const chronologicalCommands = [...executionCommands].sort(
    (left, right) => left.atMs - right.atMs || compareId(left, right),
  );
  const chronologicalFills = [...paperFills].sort(
    (left, right) => left.atMs - right.atMs || compareId(left, right),
  );
  const fixtureMatches = proof?.fixtureId === fixtureId;
  const sequenceMatches =
    proof !== null && currentScoreSeq !== null && proof.seq === currentScoreSeq;

  const pack: LiveEvidencePack = {
    schema: "proofswitch.live-evidence.v1",
    generatedAt: generatedAt(input.generatedAt),
    integrity: "device-local-unsigned",
    source: input.source,
    execution: "paper-only",
    network: input.appStatus.network,
    capabilities: copyJson(input.appStatus.capabilities),
    limitations: [...input.appStatus.limitations],
    solana: {
      network: input.appStatus.solana.network,
      programId: input.appStatus.solana.programId,
      validationEnabled: input.appStatus.solana.validationEnabled,
      runtimeConfigured: input.appStatus.solana.runtimeConfigured,
    },
    policy: copyJson(policy),
    fixture: copyJson(input.fixture),
    transport: copyJson(input.transport),
    decision: copyJson(decision),
    orders: copyJson(chronologicalOrders),
    fills: copyJson(chronologicalFills),
    risk: copyJson(selectLivePaperRisk(input.engine)),
    executionCommands: copyJson(chronologicalCommands),
    audit: copyJson(chronologicalAudit),
    proof: copyJson(proof),
    proofBinding: {
      requested: proof !== null,
      proofPresent: proof?.proof !== null && proof?.proof !== undefined,
      fixtureId,
      scoreSeq: currentScoreSeq,
      proofFixtureId: proof?.fixtureId ?? null,
      proofSeq: proof?.seq ?? null,
      fixtureMatches,
      sequenceMatches,
      boundToCurrentDecision: fixtureMatches && sequenceMatches,
      verified: proof?.verified === true && fixtureMatches && sequenceMatches,
    },
  };

  if (input.savedSession) {
    pack.savedSession = {
      schema: input.savedSession.schema,
      version: input.savedSession.version,
      engineSchema: input.savedSession.engineSchema,
      integrity: input.savedSession.integrity,
      sessionId: input.savedSession.sessionId,
      revision: input.savedSession.revision,
      savedAtMs: input.savedSession.savedAtMs,
      retention: copyJson(input.savedSession.retention),
    };
  }

  const serialised = serialiseLiveEvidencePack(pack);
  return JSON.parse(serialised.contents) as LiveEvidencePack;
}
