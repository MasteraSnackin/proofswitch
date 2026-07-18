/**
 * Pure boundary for TxLINE score proofs.
 *
 * This module deliberately has no `server-only` import: the standalone Node test
 * runner cannot resolve Next's marker package. Application code must only import it
 * from server routes. It contains no credentials and never handles wallet material.
 */

const MILLISECONDS_PER_DAY = 86_400_000;
const MAX_U16 = 65_535;
const MAX_U32 = 4_294_967_295;
const MIN_I32 = -2_147_483_648;
const MAX_I32 = 2_147_483_647;
const MAX_PROOF_STATS = 32;
const MAX_PROOF_PATH_NODES = 64;
const MAX_TOTAL_PROOF_NODES = 2_048;

export type Bytes32 = readonly number[];

export interface ScoreProofRequest {
  fixtureId: number;
  seq: number;
  statKeys: readonly number[];
}

export interface ScoreProofRequestInput {
  fixtureId: unknown;
  seq: unknown;
  statKeys: readonly unknown[];
}

export interface NormalisedProofNode {
  hash: Bytes32;
  isRightSibling: boolean;
}

export interface NormalisedScoreStat {
  key: number;
  value: number;
  period: number;
}

export interface NormalisedScoreProof {
  ts: number;
  fixtureSummary: {
    fixtureId: number;
    updateStats: {
      updateCount: number;
      minTimestamp: number;
      maxTimestamp: number;
    };
    eventsSubTreeRoot: Bytes32;
  };
  fixtureProof: readonly NormalisedProofNode[];
  mainTreeProof: readonly NormalisedProofNode[];
  eventStatRoot: Bytes32;
  stats: readonly {
    stat: NormalisedScoreStat;
    statProof: readonly NormalisedProofNode[];
  }[];
  dailyScoresRoot: {
    epochDay: number;
    epochDaySeedU16Le: readonly [number, number];
  };
}

export type VerificationBoundaryState =
  | "UNCONFIGURED"
  | "PROOF_PENDING"
  | "PROOF_READY"
  | "VALIDATION_REQUIRES_RUNTIME";

interface VerificationResultBase {
  state: VerificationBoundaryState;
  /** This boundary never claims an on-chain result. */
  verified: false;
  fixtureId: number;
  seq: number;
  statKeys: readonly number[];
  query: string;
  message: string;
}

export type SafeVerificationResult =
  | (VerificationResultBase & {
      state: "UNCONFIGURED" | "PROOF_PENDING";
      proof: null;
    })
  | (VerificationResultBase & {
      state: "PROOF_READY" | "VALIDATION_REQUIRES_RUNTIME";
      proof: NormalisedScoreProof;
    });

export interface TxLineProofResponse {
  status: number;
  data?: unknown;
}

/** A deliberately small adapter surface so credentials remain in the TxLINE client. */
export interface TxLineProofClient {
  getScoreStatValidation(query: string): Promise<TxLineProofResponse>;
}

export interface FetchScoreProofOptions {
  /**
   * Set when a caller intends to continue into validateStatV2. This pure module
   * reports that a Solana/Anchor runtime is required; it does not manufacture a
   * verification result.
   */
  requireRuntimeValidation?: boolean;
}

export type ProofBoundaryErrorCode =
  | "INVALID_REQUEST"
  | "INVALID_PROOF"
  | "UPSTREAM_FAILURE";

export class ProofBoundaryError extends Error {
  readonly code: ProofBoundaryErrorCode;
  readonly status: number | null;

  constructor(
    code: ProofBoundaryErrorCode,
    message: string,
    status: number | null = null,
  ) {
    super(message);
    this.name = "ProofBoundaryError";
    this.code = code;
    this.status = status;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidRequest(message: string): never {
  throw new ProofBoundaryError("INVALID_REQUEST", message);
}

function invalidProof(message: string): never {
  throw new ProofBoundaryError("INVALID_PROOF", message);
}

function parseInteger(
  value: unknown,
  path: string,
  options: { min: number; max: number },
  source: "request" | "proof",
): number {
  let parsed: number;

  if (typeof value === "number") {
    parsed = value;
  } else if (typeof value === "string" && /^(?:0|[1-9]\d*)$/.test(value)) {
    parsed = Number(value);
  } else {
    return source === "request"
      ? invalidRequest(`${path} must be an integer`)
      : invalidProof(`${path} must be an integer`);
  }

  if (
    !Number.isSafeInteger(parsed) ||
    parsed < options.min ||
    parsed > options.max
  ) {
    return source === "request"
      ? invalidRequest(
          `${path} must be between ${options.min} and ${options.max}`,
        )
      : invalidProof(`${path} is outside the supported integer range`);
  }

  return parsed;
}

function proofRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) invalidProof(`${path} must be an object`);
  return value;
}

function proofArray(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) invalidProof(`${path} must be an array`);
  return value;
}

/** Normalise and validate request values before any URL is constructed. */
export function normaliseScoreProofRequest(
  input: ScoreProofRequestInput,
): ScoreProofRequest {
  if (!input || !Array.isArray(input.statKeys)) {
    invalidRequest("statKeys must be an array");
  }

  const fixtureId = parseInteger(
    input.fixtureId,
    "fixtureId",
    { min: 1, max: Number.MAX_SAFE_INTEGER },
    "request",
  );
  const seq = parseInteger(
    input.seq,
    "seq",
    { min: 1, max: Number.MAX_SAFE_INTEGER },
    "request",
  );

  if (input.statKeys.length === 0 || input.statKeys.length > MAX_PROOF_STATS) {
    invalidRequest(
      `statKeys must contain between 1 and ${MAX_PROOF_STATS} keys`,
    );
  }

  const statKeys = input.statKeys.map((value, index) =>
    parseInteger(
      value,
      `statKeys[${index}]`,
      { min: 1, max: MAX_U32 },
      "request",
    ),
  );

  if (new Set(statKeys).size !== statKeys.length) {
    invalidRequest("statKeys must not contain duplicates");
  }

  return { fixtureId, seq, statKeys };
}

/** Construct the documented endpoint without reordering the positional stat keys. */
export function buildScoreStatValidationQuery(
  input: ScoreProofRequestInput,
): string {
  const request = normaliseScoreProofRequest(input);
  return (
    "/api/scores/stat-validation" +
    `?fixtureId=${request.fixtureId}` +
    `&seq=${request.seq}` +
    `&statKeys=${request.statKeys.join(",")}`
  );
}

/**
 * Decode a Merkle value into the byte array expected by the Anchor IDL.
 * Accepted wire encodings are exactly 32 numeric bytes, 0x-prefixed hex, or
 * canonical standard base64.
 */
export function decodeBytes32(value: unknown, path = "bytes32"): number[] {
  if (Array.isArray(value) || value instanceof Uint8Array) {
    const bytes = Array.from(value as readonly unknown[]);
    if (bytes.length !== 32) invalidProof(`${path} must contain exactly 32 bytes`);
    return bytes.map((byte, index) =>
      parseInteger(
        byte,
        `${path}[${index}]`,
        { min: 0, max: 255 },
        "proof",
      ),
    );
  }

  if (typeof value !== "string") {
    invalidProof(`${path} must be a byte array, 0x hex, or base64 string`);
  }

  if (value.startsWith("0x")) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
      invalidProof(`${path} must be 0x followed by exactly 64 hex characters`);
    }
    const bytes: number[] = [];
    for (let index = 2; index < value.length; index += 2) {
      bytes.push(Number.parseInt(value.slice(index, index + 2), 16));
    }
    return bytes;
  }

  if (
    value.length === 0 ||
    value.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(value) ||
    /=/.test(value.slice(0, -2))
  ) {
    invalidProof(`${path} must be canonical standard base64`);
  }

  try {
    const binary = atob(value);
    if (btoa(binary) !== value) {
      invalidProof(`${path} must be canonical standard base64`);
    }
    const bytes = Array.from(binary, (character) => character.charCodeAt(0));
    if (bytes.length !== 32) invalidProof(`${path} must decode to exactly 32 bytes`);
    return bytes;
  } catch (error) {
    if (error instanceof ProofBoundaryError) throw error;
    return invalidProof(`${path} is not valid base64`);
  }
}

function normaliseProofNode(value: unknown, path: string): NormalisedProofNode {
  const node = proofRecord(value, path);
  const siblingValue = node.isRightSibling ?? node.is_right_sibling;
  if (typeof siblingValue !== "boolean") {
    invalidProof(`${path}.isRightSibling must be a boolean`);
  }
  return {
    hash: decodeBytes32(node.hash, `${path}.hash`),
    isRightSibling: siblingValue,
  };
}

function normaliseProofNodes(
  value: unknown,
  path: string,
): NormalisedProofNode[] {
  const nodes = proofArray(value, path);
  if (nodes.length > MAX_PROOF_PATH_NODES) {
    invalidProof(
      `${path} must contain no more than ${MAX_PROOF_PATH_NODES} Merkle nodes`,
    );
  }
  return nodes.map((node, index) =>
    normaliseProofNode(node, `${path}[${index}]`),
  );
}

/** Derive the exact u16 little-endian epoch-day seed used by daily score roots. */
export function deriveDailyScoresRootSeed(minTimestamp: unknown): {
  epochDay: number;
  epochDaySeedU16Le: readonly [number, number];
} {
  const timestamp = parseInteger(
    minTimestamp,
    "summary.updateStats.minTimestamp",
    { min: 0, max: Number.MAX_SAFE_INTEGER },
    "proof",
  );
  const epochDay = Math.floor(timestamp / MILLISECONDS_PER_DAY);
  if (epochDay > MAX_U16) {
    invalidProof("summary.updateStats.minTimestamp cannot be represented as a u16 epoch day");
  }
  return {
    epochDay,
    epochDaySeedU16Le: [epochDay & 0xff, (epochDay >>> 8) & 0xff],
  };
}

/**
 * Convert the TxLINE V2 wire response into the positional validateStatV2 input
 * shape, while rejecting roots or proof branches that cannot be verified safely.
 */
export function normaliseV2ScoreProof(
  value: unknown,
  expected?: Pick<ScoreProofRequest, "fixtureId" | "statKeys">,
): NormalisedScoreProof {
  const payload = proofRecord(value, "proof");
  const summary = proofRecord(payload.summary, "proof.summary");
  const updateStats = proofRecord(
    summary.updateStats,
    "proof.summary.updateStats",
  );

  const fixtureId = parseInteger(
    summary.fixtureId,
    "proof.summary.fixtureId",
    { min: 1, max: Number.MAX_SAFE_INTEGER },
    "proof",
  );
  const updateCount = parseInteger(
    updateStats.updateCount,
    "proof.summary.updateStats.updateCount",
    { min: 0, max: MAX_I32 },
    "proof",
  );
  const minTimestamp = parseInteger(
    updateStats.minTimestamp,
    "proof.summary.updateStats.minTimestamp",
    { min: 0, max: Number.MAX_SAFE_INTEGER },
    "proof",
  );
  const maxTimestamp = parseInteger(
    updateStats.maxTimestamp,
    "proof.summary.updateStats.maxTimestamp",
    { min: 0, max: Number.MAX_SAFE_INTEGER },
    "proof",
  );
  if (minTimestamp > maxTimestamp) {
    invalidProof("proof.summary.updateStats.minTimestamp exceeds maxTimestamp");
  }
  if (expected && expected.fixtureId !== fixtureId) {
    invalidProof("proof fixtureId does not match the requested fixtureId");
  }

  const root =
    summary.eventStatsSubTreeRoot ?? summary.eventsSubTreeRoot;
  const fixtureProof = normaliseProofNodes(
    payload.subTreeProof,
    "proof.subTreeProof",
  );
  const mainTreeProof = normaliseProofNodes(
    payload.mainTreeProof,
    "proof.mainTreeProof",
  );
  const statsToProve = proofArray(
    payload.statsToProve,
    "proof.statsToProve",
  );
  const statProofs = proofArray(payload.statProofs, "proof.statProofs");

  if (statsToProve.length === 0) {
    invalidProof("proof.statsToProve must contain at least one stat");
  }
  if (statsToProve.length > MAX_PROOF_STATS) {
    invalidProof(
      `proof.statsToProve must contain no more than ${MAX_PROOF_STATS} stats`,
    );
  }
  if (statsToProve.length !== statProofs.length) {
    invalidProof("proof.statProofs length must match proof.statsToProve length");
  }
  if (expected && expected.statKeys.length !== statsToProve.length) {
    invalidProof("proof stat count does not match the requested statKeys");
  }

  const stats = statsToProve.map((statValue, index) => {
    const stat = proofRecord(statValue, `proof.statsToProve[${index}]`);
    const key = parseInteger(
      stat.key,
      `proof.statsToProve[${index}].key`,
      { min: 0, max: MAX_U32 },
      "proof",
    );
    if (expected && expected.statKeys[index] !== key) {
      invalidProof(
        `proof stat key at index ${index} does not match requested statKeys order`,
      );
    }
    return {
      stat: {
        key,
        value: parseInteger(
          stat.value,
          `proof.statsToProve[${index}].value`,
          { min: MIN_I32, max: MAX_I32 },
          "proof",
        ),
        period: parseInteger(
          stat.period,
          `proof.statsToProve[${index}].period`,
          { min: MIN_I32, max: MAX_I32 },
          "proof",
        ),
      },
      statProof: normaliseProofNodes(
        statProofs[index],
        `proof.statProofs[${index}]`,
      ),
    };
  });
  const totalProofNodes =
    fixtureProof.length +
    mainTreeProof.length +
    stats.reduce((total, stat) => total + stat.statProof.length, 0);
  if (totalProofNodes > MAX_TOTAL_PROOF_NODES) {
    invalidProof(
      `proof contains ${totalProofNodes} Merkle nodes; the maximum is ${MAX_TOTAL_PROOF_NODES}`,
    );
  }

  return {
    ts: minTimestamp,
    fixtureSummary: {
      fixtureId,
      updateStats: { updateCount, minTimestamp, maxTimestamp },
      eventsSubTreeRoot: decodeBytes32(
        root,
        "proof.summary.eventStatsSubTreeRoot",
      ),
    },
    fixtureProof,
    mainTreeProof,
    eventStatRoot: decodeBytes32(payload.eventStatRoot, "proof.eventStatRoot"),
    stats,
    dailyScoresRoot: deriveDailyScoresRootSeed(minTimestamp),
  };
}

export interface StrategyCoverage {
  valid: boolean;
  referencedStatIndices: readonly number[];
  coveredStatIndices: readonly number[];
  missingStatIndices: readonly number[];
}

function strategyIndex(value: unknown, path: string): number {
  return parseInteger(
    value,
    path,
    { min: 0, max: MAX_U32 },
    "request",
  );
}

/**
 * Ensure every positional index referenced by a validateStatV2 strategy is
 * supplied by the proof. It intentionally does not evaluate the predicates.
 */
export function validateStrategyCoverage(
  strategyValue: unknown,
  statCount: number,
): StrategyCoverage {
  if (!Number.isSafeInteger(statCount) || statCount < 0) {
    invalidRequest("statCount must be a non-negative integer");
  }
  if (!isRecord(strategyValue)) invalidRequest("strategy must be an object");

  const geometricTargets = strategyValue.geometricTargets ?? [];
  const discretePredicates = strategyValue.discretePredicates ?? [];
  if (!Array.isArray(geometricTargets)) {
    invalidRequest("strategy.geometricTargets must be an array");
  }
  if (!Array.isArray(discretePredicates)) {
    invalidRequest("strategy.discretePredicates must be an array");
  }

  const referenced: number[] = [];
  const addIndex = (value: unknown, path: string) => {
    const index = strategyIndex(value, path);
    if (!referenced.includes(index)) referenced.push(index);
  };

  geometricTargets.forEach((targetValue, index) => {
    if (!isRecord(targetValue)) {
      invalidRequest(`strategy.geometricTargets[${index}] must be an object`);
    }
    addIndex(
      targetValue.statIndex,
      `strategy.geometricTargets[${index}].statIndex`,
    );
  });

  discretePredicates.forEach((predicateValue, index) => {
    if (!isRecord(predicateValue)) {
      invalidRequest(`strategy.discretePredicates[${index}] must be an object`);
    }
    const single = predicateValue.single;
    const binary = predicateValue.binary;
    if (single !== undefined && binary !== undefined) {
      invalidRequest(
        `strategy.discretePredicates[${index}] cannot be both single and binary`,
      );
    }
    if (single !== undefined) {
      if (!isRecord(single)) {
        invalidRequest(`strategy.discretePredicates[${index}].single must be an object`);
      }
      addIndex(
        single.index,
        `strategy.discretePredicates[${index}].single.index`,
      );
      return;
    }
    if (binary !== undefined) {
      if (!isRecord(binary)) {
        invalidRequest(`strategy.discretePredicates[${index}].binary must be an object`);
      }
      addIndex(
        binary.indexA,
        `strategy.discretePredicates[${index}].binary.indexA`,
      );
      addIndex(
        binary.indexB,
        `strategy.discretePredicates[${index}].binary.indexB`,
      );
      return;
    }
    invalidRequest(
      `strategy.discretePredicates[${index}] must contain single or binary`,
    );
  });

  const coveredStatIndices = referenced.filter((index) => index < statCount);
  const missingStatIndices = referenced.filter((index) => index >= statCount);
  return {
    valid: missingStatIndices.length === 0,
    referencedStatIndices: referenced,
    coveredStatIndices,
    missingStatIndices,
  };
}

function upstreamStatus(error: unknown): number | null {
  if (!isRecord(error)) return null;
  if (typeof error.status === "number") return error.status;
  if (isRecord(error.response) && typeof error.response.status === "number") {
    return error.response.status;
  }
  return null;
}

function pendingResult(
  request: ScoreProofRequest,
  query: string,
): SafeVerificationResult {
  return {
    state: "PROOF_PENDING",
    verified: false,
    fixtureId: request.fixtureId,
    seq: request.seq,
    statKeys: request.statKeys,
    query,
    proof: null,
    message: "TxLINE has not published a proof for this score sequence yet.",
  };
}

/**
 * Fetch and parse a proof through an injected, authenticated TxLINE client.
 * Successful proof retrieval is not the same thing as Solana verification.
 */
export async function fetchScoreStatProof(
  client: TxLineProofClient | null | undefined,
  input: ScoreProofRequestInput,
  options: FetchScoreProofOptions = {},
): Promise<SafeVerificationResult> {
  const request = normaliseScoreProofRequest(input);
  const query = buildScoreStatValidationQuery(request);

  if (!client) {
    return {
      state: "UNCONFIGURED",
      verified: false,
      fixtureId: request.fixtureId,
      seq: request.seq,
      statKeys: request.statKeys,
      query,
      proof: null,
      message: "TxLINE proof access is not configured.",
    };
  }

  let response: TxLineProofResponse;
  try {
    response = await client.getScoreStatValidation(query);
  } catch (error) {
    const status = upstreamStatus(error);
    if (status === 202 || status === 204 || status === 404) {
      return pendingResult(request, query);
    }
    throw new ProofBoundaryError(
      "UPSTREAM_FAILURE",
      "TxLINE proof request failed",
      status,
    );
  }

  if (!response || !Number.isInteger(response.status)) {
    throw new ProofBoundaryError(
      "UPSTREAM_FAILURE",
      "TxLINE proof client returned an invalid response",
    );
  }
  if (response.status === 202 || response.status === 204 || response.status === 404) {
    return pendingResult(request, query);
  }
  if (response.status < 200 || response.status >= 300) {
    throw new ProofBoundaryError(
      "UPSTREAM_FAILURE",
      "TxLINE proof request failed",
      response.status,
    );
  }
  if (response.data === undefined || response.data === null) {
    invalidProof("TxLINE returned an empty successful proof response");
  }

  const proof = normaliseV2ScoreProof(response.data, request);
  const state = options.requireRuntimeValidation
    ? "VALIDATION_REQUIRES_RUNTIME"
    : "PROOF_READY";

  return {
    state,
    verified: false,
    fixtureId: request.fixtureId,
    seq: request.seq,
    statKeys: request.statKeys,
    query,
    proof,
    message: options.requireRuntimeValidation
      ? "The proof is ready; validateStatV2 requires a configured Solana/Anchor runtime."
      : "The TxLINE proof is ready but has not been validated on Solana.",
  };
}
