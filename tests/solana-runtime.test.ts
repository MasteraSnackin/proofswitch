import assert from "node:assert/strict";
import test from "node:test";
import { BorshInstructionCoder } from "@coral-xyz/anchor";
import { convertIdlToCamelCase } from "@coral-xyz/anchor/dist/cjs/idl.js";

import { readServerConfig } from "../server/config.ts";
import {
  compileStatValidation,
  validateScoreProofOnSolana,
  type StatValidationViewExecutor,
} from "../server/solana-runtime.ts";
import type { NormalisedScoreProof } from "../server/verification.ts";
import { txoracleValidationIdl } from "../server/txoracle-idl.ts";

const bytes = Array.from({ length: 32 }, (_, index) => index);

function proof(): NormalisedScoreProof {
  return {
    ts: 1_768_320_000_000,
    fixtureSummary: {
      fixtureId: 18_241_006,
      updateStats: {
        updateCount: 4,
        minTimestamp: 1_768_320_000_000,
        maxTimestamp: 1_768_320_000_250,
      },
      eventsSubTreeRoot: bytes,
    },
    fixtureProof: [{ hash: bytes, isRightSibling: false }],
    mainTreeProof: [{ hash: [...bytes].reverse(), isRightSibling: true }],
    eventStatRoot: bytes,
    stats: [
      {
        stat: { key: 1, value: 2, period: 2 },
        statProof: [{ hash: bytes, isRightSibling: false }],
      },
      {
        stat: { key: 2, value: 1, period: 2 },
        statProof: [{ hash: bytes, isRightSibling: true }],
      },
    ],
    dailyScoresRoot: { epochDay: 20_466, epochDaySeedU16Le: [242, 79] },
  };
}

function configured() {
  return readServerConfig({
    PROOFSWITCH_MODE: "live",
    TXLINE_NETWORK: "devnet",
    TXLINE_API_TOKEN: "activated-token",
    SOLANA_VALIDATION_ENABLED: "true",
    SOLANA_SIMULATION_PAYER_PUBLIC_KEY:
      "11111111111111111111111111111111",
  });
}

test("compiles every returned stat into an exact equality predicate", () => {
  const compiled = compileStatValidation(proof());
  assert.equal(compiled.payload.ts.toString(), "1768320000000");
  assert.equal(compiled.payload.fixtureSummary.fixtureId.toString(), "18241006");
  assert.deepEqual(compiled.epochDaySeedU16Le, Uint8Array.from([242, 79]));
  assert.deepEqual(compiled.strategy.discretePredicates, [
    {
      single: {
        index: 0,
        predicate: { threshold: 2, comparison: { equalTo: {} } },
      },
    },
    {
      single: {
        index: 1,
        predicate: { threshold: 1, comparison: { equalTo: {} } },
      },
    },
  ]);
});

test("the pinned IDL encodes the official validateStatV2 discriminator", () => {
  const compiled = compileStatValidation(proof());
  const idl = convertIdlToCamelCase(txoracleValidationIdl);
  const encoded = new BorshInstructionCoder(idl).encode("validateStatV2", {
    payload: compiled.payload,
    strategy: compiled.strategy,
  });
  assert.deepEqual(
    [...encoded.subarray(0, 8)],
    [208, 215, 194, 214, 241, 71, 246, 178],
  );
});

test("reports verified only when the read-only view returns true", async () => {
  let captured = null as ReturnType<typeof compileStatValidation> | null;
  const executor: StatValidationViewExecutor = {
    async view(compiled) {
      captured = compiled;
      return true;
    },
  };
  const result = await validateScoreProofOnSolana(proof(), configured(), executor);
  assert.equal(result.state, "VERIFIED");
  assert.equal(result.verified, true);
  assert.equal(captured?.payload.stats.length, 2);

  const rejected = await validateScoreProofOnSolana(proof(), configured(), {
    async view() {
      return false;
    },
  });
  assert.equal(rejected.state, "PREDICATE_FALSE");
  assert.equal(rejected.verified, false);
});

test("maps pending roots and invalid Merkle proofs without exposing RPC detail", async () => {
  const pending = await validateScoreProofOnSolana(proof(), configured(), {
    async view() {
      throw {
        simulationResponse: {
          err: { InstructionError: [0, { Custom: 6007 }] },
          logs: [],
        },
        secret: "rpc detail",
      };
    },
  });
  assert.equal(pending.state, "ROOT_PENDING");
  assert.equal(pending.message.includes("secret"), false);

  const invalid = await validateScoreProofOnSolana(proof(), configured(), {
    async view() {
      throw {
        simulationResponse: {
          err: { InstructionError: [0, { Custom: 6076 }] },
          logs: [],
        },
      };
    },
  });
  assert.equal(invalid.state, "INVALID_PROOF");
  assert.equal(invalid.verified, false);
});

test("stays fail-closed when the read-only runtime is not configured", async () => {
  const config = readServerConfig({
    PROOFSWITCH_MODE: "live",
    TXLINE_API_TOKEN: "activated-token",
  });
  let called = false;
  const result = await validateScoreProofOnSolana(proof(), config, {
    async view() {
      called = true;
      return true;
    },
  });
  assert.equal(result.state, "RUNTIME_UNCONFIGURED");
  assert.equal(result.verified, false);
  assert.equal(called, false);
});
