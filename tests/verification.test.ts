import assert from "node:assert/strict";
import test from "node:test";
import {
  ProofBoundaryError,
  buildScoreStatValidationQuery,
  decodeBytes32,
  deriveDailyScoresRootSeed,
  fetchScoreStatProof,
  normaliseV2ScoreProof,
  validateStrategyCoverage,
  type TxLineProofClient,
} from "../server/verification.ts";

const bytes = Array.from({ length: 32 }, (_, index) => index);
const secondBytes = Array.from({ length: 32 }, (_, index) => 255 - index);
const hex = `0x${bytes.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
const base64 = Buffer.from(bytes).toString("base64");

function proofNode(hash: unknown = bytes) {
  return { hash, isRightSibling: false };
}

function validProof(fixtureId = 17_926_686) {
  const minTimestamp = Date.UTC(2026, 6, 15, 19, 0, 0);
  return {
    summary: {
      fixtureId,
      updateStats: {
        updateCount: 3,
        minTimestamp,
        maxTimestamp: minTimestamp + 250,
      },
      eventStatsSubTreeRoot: hex,
    },
    subTreeProof: [proofNode(base64)],
    mainTreeProof: [
      { hash: new Uint8Array(secondBytes), is_right_sibling: true },
    ],
    eventStatRoot: secondBytes,
    statsToProve: [
      { key: 2, value: 1, period: 2 },
      { key: 1, value: 0, period: 2 },
    ],
    statProofs: [[proofNode()], [proofNode(secondBytes)]],
  };
}

test("constructs a real score-proof query and preserves stat-key order", () => {
  assert.equal(
    buildScoreStatValidationQuery({
      fixtureId: "17926686",
      seq: "880",
      statKeys: [2, 1],
    }),
    "/api/scores/stat-validation?fixtureId=17926686&seq=880&statKeys=2,1",
  );

  assert.throws(
    () =>
      buildScoreStatValidationQuery({ fixtureId: 0, seq: 880, statKeys: [1] }),
    /fixtureId/,
  );
  assert.throws(
    () =>
      buildScoreStatValidationQuery({
        fixtureId: 17_926_686,
        seq: 0,
        statKeys: [1],
      }),
    /seq/,
  );
});

test("decodes only canonical 32-byte array, hex and base64 encodings", () => {
  assert.deepEqual(decodeBytes32(bytes), bytes);
  assert.deepEqual(decodeBytes32(new Uint8Array(bytes)), bytes);
  assert.deepEqual(decodeBytes32(hex), bytes);
  assert.deepEqual(decodeBytes32(base64), bytes);

  assert.throws(() => decodeBytes32(bytes.slice(1)), /exactly 32 bytes/);
  assert.throws(() => decodeBytes32("0x12"), /64 hex characters/);
  assert.throws(() => decodeBytes32("not base64"), /base64/);
  assert.throws(
    () => decodeBytes32(Buffer.from(bytes.slice(1)).toString("base64")),
    /decode to exactly 32 bytes/,
  );
});

test("normalises the V2 proof into validateStatV2's positional shape", () => {
  const normalised = normaliseV2ScoreProof(validProof(), {
    fixtureId: 17_926_686,
    statKeys: [2, 1],
  });

  assert.equal(normalised.ts, Date.UTC(2026, 6, 15, 19, 0, 0));
  assert.equal(normalised.fixtureSummary.fixtureId, 17_926_686);
  assert.deepEqual(normalised.fixtureSummary.eventsSubTreeRoot, bytes);
  assert.deepEqual(normalised.fixtureProof[0].hash, bytes);
  assert.equal(normalised.mainTreeProof[0].isRightSibling, true);
  assert.deepEqual(
    normalised.stats.map(({ stat }) => stat.key),
    [2, 1],
  );
  assert.deepEqual(normalised.stats[1].statProof[0].hash, secondBytes);
  assert.equal(normalised.dailyScoresRoot.epochDay, 20_649);
  assert.deepEqual(normalised.dailyScoresRoot.epochDaySeedU16Le, [169, 80]);
});

test("rejects branch/stat length mismatches and reordered proof stats", () => {
  const missingBranch = validProof();
  missingBranch.statProofs.pop();
  assert.throws(
    () => normaliseV2ScoreProof(missingBranch),
    /statProofs length/,
  );

  assert.throws(
    () =>
      normaliseV2ScoreProof(validProof(), {
        fixtureId: 17_926_686,
        statKeys: [1, 2],
      }),
    /does not match requested statKeys order/,
  );
  assert.throws(
    () =>
      normaliseV2ScoreProof(validProof(), {
        fixtureId: 99,
        statKeys: [2, 1],
      }),
    /fixtureId does not match/,
  );
});

test("rejects an oversized Merkle branch as an invalid proof", () => {
  const oversized = validProof();
  oversized.subTreeProof = Array.from({ length: 65 }, () => proofNode());

  assert.throws(
    () => normaliseV2ScoreProof(oversized),
    (error: unknown) => {
      assert.ok(error instanceof ProofBoundaryError);
      assert.equal(error.code, "INVALID_PROOF");
      assert.match(error.message, /no more than 64 Merkle nodes/);
      return true;
    },
  );
});

test("rejects proofs whose individually bounded paths exceed the aggregate budget", () => {
  const oversized = validProof();
  oversized.statsToProve = Array.from({ length: 32 }, (_, index) => ({
    key: index + 1,
    value: index,
    period: 2,
  }));
  oversized.statProofs = Array.from({ length: 32 }, () =>
    Array.from({ length: 64 }, () => proofNode()),
  );

  assert.throws(
    () => normaliseV2ScoreProof(oversized),
    (error: unknown) => {
      assert.ok(error instanceof ProofBoundaryError);
      assert.equal(error.code, "INVALID_PROOF");
      assert.match(error.message, /2050 Merkle nodes; the maximum is 2048/);
      return true;
    },
  );
});

test("derives an exact u16 little-endian epoch-day seed", () => {
  const derived = deriveDailyScoresRootSeed(
    Date.UTC(2026, 6, 15, 19, 0, 0),
  );
  assert.deepEqual(derived, {
    epochDay: 20_649,
    epochDaySeedU16Le: [169, 80],
  });
  assert.throws(
    () => deriveDailyScoresRootSeed((65_536 * 86_400_000).toString()),
    /u16 epoch day/,
  );
});

test("reports strategy coverage without evaluating the market predicate", () => {
  const coverage = validateStrategyCoverage(
    {
      geometricTargets: [{ statIndex: 0, prediction: 1 }],
      discretePredicates: [
        { single: { index: 1, predicate: {} } },
        { binary: { indexA: 1, indexB: 3, predicate: {} } },
      ],
    },
    2,
  );

  assert.deepEqual(coverage, {
    valid: false,
    referencedStatIndices: [0, 1, 3],
    coveredStatIndices: [0, 1],
    missingStatIndices: [3],
  });
  assert.equal(
    validateStrategyCoverage(
      { geometricTargets: [], discretePredicates: [{ single: { index: 0 } }] },
      1,
    ).valid,
    true,
  );
  assert.throws(
    () =>
      validateStrategyCoverage(
        { geometricTargets: [], discretePredicates: [{}] },
        1,
      ),
    /single or binary/,
  );
});

test("reports unconfigured and pending states without claiming verification", async () => {
  const request = { fixtureId: 17_926_686, seq: 880, statKeys: [2, 1] };
  const unconfigured = await fetchScoreStatProof(null, request);
  assert.equal(unconfigured.state, "UNCONFIGURED");
  assert.equal(unconfigured.verified, false);
  assert.equal(unconfigured.proof, null);

  const pendingClient: TxLineProofClient = {
    async getScoreStatValidation() {
      return { status: 404 };
    },
  };
  const pending = await fetchScoreStatProof(pendingClient, request);
  assert.equal(pending.state, "PROOF_PENDING");
  assert.equal(pending.verified, false);
  assert.equal(pending.proof, null);
});

test("distinguishes proof readiness from unavailable runtime validation", async () => {
  let receivedQuery = "";
  const client: TxLineProofClient = {
    async getScoreStatValidation(query) {
      receivedQuery = query;
      return { status: 200, data: validProof() };
    },
  };
  const request = { fixtureId: 17_926_686, seq: 880, statKeys: [2, 1] };

  const ready = await fetchScoreStatProof(client, request);
  assert.equal(ready.state, "PROOF_READY");
  assert.equal(ready.verified, false);
  assert.ok(ready.proof);
  assert.equal(
    receivedQuery,
    "/api/scores/stat-validation?fixtureId=17926686&seq=880&statKeys=2,1",
  );

  const requiresRuntime = await fetchScoreStatProof(client, request, {
    requireRuntimeValidation: true,
  });
  assert.equal(requiresRuntime.state, "VALIDATION_REQUIRES_RUNTIME");
  assert.equal(requiresRuntime.verified, false);
  assert.ok(requiresRuntime.proof);
});

test("does not leak an upstream error body through the safe boundary", async () => {
  const client: TxLineProofClient = {
    async getScoreStatValidation() {
      return { status: 401, data: { secret: "upstream token detail" } };
    },
  };

  await assert.rejects(
    () =>
      fetchScoreStatProof(client, {
        fixtureId: 17_926_686,
        seq: 880,
        statKeys: [1],
      }),
    (error: unknown) => {
      assert.ok(error instanceof ProofBoundaryError);
      assert.equal(error.code, "UPSTREAM_FAILURE");
      assert.equal(error.status, 401);
      assert.equal(error.message.includes("secret"), false);
      return true;
    },
  );
});
