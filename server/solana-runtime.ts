import anchor from "@coral-xyz/anchor/dist/cjs/index.js";
import type { Idl } from "@coral-xyz/anchor";
import type { ServerConfig } from "./config.ts";
import type { NormalisedScoreProof } from "./verification.ts";
import {
  TXORACLE_DEVNET_PROGRAM_ID,
  txoracleValidationIdl,
} from "./txoracle-idl.ts";

const { AnchorError, AnchorProvider, BN, Program, web3 } = anchor;
type AnchorBN = InstanceType<typeof BN>;

const ROOT_PENDING_CODES = new Set([6007]);
const INVALID_PROOF_CODES = new Set([
  6003, 6004, 6022, 6023, 6062, 6068, 6069, 6070, 6071, 6073, 6075, 6076,
  6077, 6078,
]);

export type SolanaValidationState =
  | "VERIFIED"
  | "PREDICATE_FALSE"
  | "ROOT_PENDING"
  | "INVALID_PROOF"
  | "RUNTIME_UNCONFIGURED"
  | "RUNTIME_FAILURE";

export interface SolanaValidationResult {
  state: SolanaValidationState;
  verified: boolean;
  message: string;
  programId: string;
  rpcNetwork: "devnet";
  epochDay: number;
}

export interface CompiledStatValidation {
  payload: {
    ts: AnchorBN;
    fixtureSummary: {
      fixtureId: AnchorBN;
      updateStats: {
        updateCount: number;
        minTimestamp: AnchorBN;
        maxTimestamp: AnchorBN;
      };
      eventsSubTreeRoot: number[];
    };
    fixtureProof: Array<{ hash: number[]; isRightSibling: boolean }>;
    mainTreeProof: Array<{ hash: number[]; isRightSibling: boolean }>;
    eventStatRoot: number[];
    stats: Array<{
      stat: { key: number; value: number; period: number };
      statProof: Array<{ hash: number[]; isRightSibling: boolean }>;
    }>;
  };
  strategy: {
    geometricTargets: never[];
    distancePredicate: null;
    discretePredicates: Array<{
      single: {
        index: number;
        predicate: { threshold: number; comparison: { equalTo: Record<string, never> } };
      };
    }>;
  };
  epochDay: number;
  epochDaySeedU16Le: Uint8Array;
}

export interface StatValidationViewExecutor {
  view(compiled: CompiledStatValidation): Promise<boolean>;
}

class SimulationPayerConfigurationError extends Error {
  constructor() {
    super("The simulation payer is not a funded, non-executable System Program account.");
    this.name = "SimulationPayerConfigurationError";
  }
}

function mapProofNodes(
  nodes: NormalisedScoreProof["fixtureProof"],
) {
  return nodes.map((node) => ({
    hash: [...node.hash],
    isRightSibling: node.isRightSibling,
  }));
}

/**
 * Compile the already contract-checked TxLINE response into the exact
 * validateStatV2 Anchor argument shape. Equality predicates cover every stat,
 * so a true return proves the supplied values rather than testing a market bet.
 */
export function compileStatValidation(
  proof: NormalisedScoreProof,
): CompiledStatValidation {
  if (proof.stats.length < 1 || proof.stats.length > 255) {
    throw new RangeError("validateStatV2 requires between 1 and 255 stats.");
  }

  return {
    payload: {
      ts: new BN(proof.ts),
      fixtureSummary: {
        fixtureId: new BN(proof.fixtureSummary.fixtureId),
        updateStats: {
          updateCount: proof.fixtureSummary.updateStats.updateCount,
          minTimestamp: new BN(proof.fixtureSummary.updateStats.minTimestamp),
          maxTimestamp: new BN(proof.fixtureSummary.updateStats.maxTimestamp),
        },
        eventsSubTreeRoot: [...proof.fixtureSummary.eventsSubTreeRoot],
      },
      fixtureProof: mapProofNodes(proof.fixtureProof),
      mainTreeProof: mapProofNodes(proof.mainTreeProof),
      eventStatRoot: [...proof.eventStatRoot],
      stats: proof.stats.map(({ stat, statProof }) => ({
        stat: { ...stat },
        statProof: mapProofNodes(statProof),
      })),
    },
    strategy: {
      geometricTargets: [],
      distancePredicate: null,
      discretePredicates: proof.stats.map(({ stat }, index) => ({
        single: {
          index,
          predicate: {
            threshold: stat.value,
            comparison: { equalTo: {} },
          },
        },
      })),
    },
    epochDay: proof.dailyScoresRoot.epochDay,
    epochDaySeedU16Le: Uint8Array.from(
      proof.dailyScoresRoot.epochDaySeedU16Le,
    ),
  };
}

function readAnchorErrorCode(error: unknown): number | null {
  if (typeof error !== "object" || error === null) return null;
  const record = error as Record<string, unknown>;
  const nested = record.error;
  if (typeof nested === "object" && nested !== null) {
    const errorCode = (nested as Record<string, unknown>).errorCode;
    if (typeof errorCode === "object" && errorCode !== null) {
      const number = (errorCode as Record<string, unknown>).number;
      if (typeof number === "number" && Number.isInteger(number)) return number;
    }
  }
  const simulationResponse = record.simulationResponse;
  if (typeof simulationResponse === "object" && simulationResponse !== null) {
    const response = simulationResponse as Record<string, unknown>;
    const responseError = response.err;
    if (typeof responseError === "object" && responseError !== null) {
      const instructionError = (responseError as Record<string, unknown>)
        .InstructionError;
      if (Array.isArray(instructionError)) {
        const custom = instructionError[1];
        if (typeof custom === "object" && custom !== null) {
          const number = (custom as Record<string, unknown>).Custom;
          if (typeof number === "number" && Number.isInteger(number)) return number;
        }
      }
    }
    const logs = Array.isArray(response.logs)
      ? response.logs.filter((entry): entry is string => typeof entry === "string")
      : [];
    if (logs.length > 0) {
      try {
        const parsed = AnchorError.parse(logs);
        if (parsed) return parsed.error.errorCode.number;
      } catch {
        // Fall through to other structured error forms.
      }
    }
  }
  const logs = Array.isArray(record.logs)
    ? record.logs.filter((entry): entry is string => typeof entry === "string")
    : [];
  if (logs.length > 0) {
    try {
      const parsed = AnchorError.parse(logs);
      if (parsed) return parsed.error.errorCode.number;
    } catch {
      // Fall through to the top-level numeric code.
    }
  }
  const code = record.code;
  return typeof code === "number" && Number.isInteger(code) ? code : null;
}

function runtimeResult(
  state: SolanaValidationState,
  message: string,
  programId: string,
  epochDay: number,
): SolanaValidationResult {
  return {
    state,
    verified: state === "VERIFIED",
    message,
    programId,
    rpcNetwork: "devnet",
    epochDay,
  };
}

function createReadonlyExecutor(config: ServerConfig): StatValidationViewExecutor {
  if (!config.solana.simulationPayer) {
    throw new RangeError("SOLANA_SIMULATION_PAYER_PUBLIC_KEY is required.");
  }
  const publicKey = new web3.PublicKey(config.solana.simulationPayer);
  const wallet: ConstructorParameters<typeof AnchorProvider>[1] = {
    publicKey,
    async signTransaction() {
      throw new Error("Read-only validation must never request a signature.");
    },
    async signAllTransactions() {
      throw new Error("Read-only validation must never request signatures.");
    },
  };
  const connection = new web3.Connection(config.solana.rpcUrl, "confirmed");
  const provider = new AnchorProvider(connection, wallet, {
    ...AnchorProvider.defaultOptions(),
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
  const program = new Program(txoracleValidationIdl as Idl, provider);
  const programId = new web3.PublicKey(config.solana.programId);

  return {
    async view(compiled) {
      const payerAccount = await connection.getAccountInfo(publicKey, "confirmed");
      if (
        !payerAccount ||
        payerAccount.lamports < 1 ||
        payerAccount.executable ||
        !payerAccount.owner.equals(web3.SystemProgram.programId)
      ) {
        throw new SimulationPayerConfigurationError();
      }
      const [dailyScoresMerkleRoots] = web3.PublicKey.findProgramAddressSync(
        [
          new TextEncoder().encode("daily_scores_roots"),
          compiled.epochDaySeedU16Le,
        ],
        programId,
      );
      const result = await program.methods
        .validateStatV2(compiled.payload, compiled.strategy)
        .accounts({ dailyScoresMerkleRoots })
        .preInstructions([
          web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
        ])
        .view();
      return result === true;
    },
  };
}

/**
 * Simulate TxODDS' read-only validateStatV2 instruction. This never sends a
 * transaction, spends SOL or asks for a private key. The configured public
 * payer address only supplies a valid fee-payer account to Solana simulation.
 */
export async function validateScoreProofOnSolana(
  proof: NormalisedScoreProof,
  config: ServerConfig,
  injectedExecutor?: StatValidationViewExecutor,
): Promise<SolanaValidationResult> {
  const epochDay = proof.dailyScoresRoot.epochDay;
  if (
    !config.solana.validationRequested ||
    !config.solana.simulationPayer ||
    config.network !== "devnet" ||
    config.solana.programId !== TXORACLE_DEVNET_PROGRAM_ID
  ) {
    return runtimeResult(
      "RUNTIME_UNCONFIGURED",
      "Read-only Solana validation is not configured for the published TxLINE devnet program.",
      config.solana.programId,
      epochDay,
    );
  }

  let compiled: CompiledStatValidation;
  let executor: StatValidationViewExecutor;
  try {
    compiled = compileStatValidation(proof);
    executor = injectedExecutor ?? createReadonlyExecutor(config);
  } catch {
    return runtimeResult(
      "RUNTIME_UNCONFIGURED",
      "The Solana RPC or simulation payer public key is invalid.",
      config.solana.programId,
      epochDay,
    );
  }

  try {
    const accepted = await executor.view(compiled);
    return accepted
      ? runtimeResult(
          "VERIFIED",
          "validateStatV2 returned true in a read-only Solana devnet simulation.",
          config.solana.programId,
          epochDay,
        )
      : runtimeResult(
          "PREDICATE_FALSE",
          "The proof executed, but validateStatV2 did not accept every returned stat value.",
          config.solana.programId,
          epochDay,
        );
  } catch (error) {
    if (error instanceof SimulationPayerConfigurationError) {
      return runtimeResult(
        "RUNTIME_UNCONFIGURED",
        "The simulation payer must be a funded, non-executable System Program account on devnet.",
        config.solana.programId,
        epochDay,
      );
    }
    const code = readAnchorErrorCode(error);
    if (code !== null && ROOT_PENDING_CODES.has(code)) {
      return runtimeResult(
        "ROOT_PENDING",
        "The matching daily scores Merkle root is not available on Solana yet.",
        config.solana.programId,
        epochDay,
      );
    }
    if (code !== null && INVALID_PROOF_CODES.has(code)) {
      return runtimeResult(
        "INVALID_PROOF",
        "validateStatV2 rejected the Merkle proof or its stat coverage.",
        config.solana.programId,
        epochDay,
      );
    }
    return runtimeResult(
      "RUNTIME_FAILURE",
      "Solana could not complete the read-only validation simulation.",
      config.solana.programId,
      epochDay,
    );
  }
}
