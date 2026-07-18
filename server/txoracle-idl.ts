import type { Idl } from "@coral-xyz/anchor";

/**
 * Minimal, read-only slice of TxODDS' published devnet IDL required by
 * validateStatV2. Keep this in sync with the upstream v1.5.6 IDL:
 * https://github.com/txodds/tx-on-chain/blob/eba4cb4d/examples/devnet/idl/txoracle.json
 * Upstream full-file SHA-256:
 * 1e7d55726eda9ad4d6ef62910fe5d7e007c687f4ff8b1c771a42b69b7089724e
 */
export const TXORACLE_DEVNET_PROGRAM_ID =
  "6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J";

export const txoracleValidationIdl = {
  address: TXORACLE_DEVNET_PROGRAM_ID,
  metadata: {
    name: "txoracle",
    version: "1.5.6",
    spec: "0.1.0",
    description: "TxODDS TxLINE Data system — validateStatV2 subset",
  },
  instructions: [
    {
      name: "validate_stat_v2",
      discriminator: [208, 215, 194, 214, 241, 71, 246, 178],
      accounts: [{ name: "daily_scores_merkle_roots" }],
      args: [
        { name: "payload", type: { defined: { name: "StatValidationInput" } } },
        {
          name: "strategy",
          type: { defined: { name: "NDimensionalStrategy" } },
        },
      ],
      returns: "bool",
    },
  ],
  types: [
    {
      name: "BinaryExpression",
      type: {
        kind: "enum",
        variants: [{ name: "Add" }, { name: "Subtract" }],
      },
    },
    {
      name: "Comparison",
      type: {
        kind: "enum",
        variants: [
          { name: "GreaterThan" },
          { name: "LessThan" },
          { name: "EqualTo" },
        ],
      },
    },
    {
      name: "GeometricTarget",
      type: {
        kind: "struct",
        fields: [
          { name: "stat_index", type: "u8" },
          { name: "prediction", type: "i32" },
        ],
      },
    },
    {
      name: "NDimensionalStrategy",
      type: {
        kind: "struct",
        fields: [
          {
            name: "geometric_targets",
            type: { vec: { defined: { name: "GeometricTarget" } } },
          },
          {
            name: "distance_predicate",
            type: { option: { defined: { name: "TraderPredicate" } } },
          },
          {
            name: "discrete_predicates",
            type: { vec: { defined: { name: "StatPredicate" } } },
          },
        ],
      },
    },
    {
      name: "ProofNode",
      type: {
        kind: "struct",
        fields: [
          { name: "hash", type: { array: ["u8", 32] } },
          { name: "is_right_sibling", type: "bool" },
        ],
      },
    },
    {
      name: "ScoreStat",
      type: {
        kind: "struct",
        fields: [
          { name: "key", type: "u32" },
          { name: "value", type: "i32" },
          { name: "period", type: "i32" },
        ],
      },
    },
    {
      name: "ScoresBatchSummary",
      type: {
        kind: "struct",
        fields: [
          { name: "fixture_id", type: "i64" },
          {
            name: "update_stats",
            type: { defined: { name: "ScoresUpdateStats" } },
          },
          {
            name: "events_sub_tree_root",
            type: { array: ["u8", 32] },
          },
        ],
      },
    },
    {
      name: "ScoresUpdateStats",
      type: {
        kind: "struct",
        fields: [
          { name: "update_count", type: "i32" },
          { name: "min_timestamp", type: "i64" },
          { name: "max_timestamp", type: "i64" },
        ],
      },
    },
    {
      name: "StatLeaf",
      type: {
        kind: "struct",
        fields: [
          { name: "stat", type: { defined: { name: "ScoreStat" } } },
          {
            name: "stat_proof",
            type: { vec: { defined: { name: "ProofNode" } } },
          },
        ],
      },
    },
    {
      name: "StatPredicate",
      type: {
        kind: "enum",
        variants: [
          {
            name: "Single",
            fields: [
              { name: "index", type: "u8" },
              {
                name: "predicate",
                type: { defined: { name: "TraderPredicate" } },
              },
            ],
          },
          {
            name: "Binary",
            fields: [
              { name: "index_a", type: "u8" },
              { name: "index_b", type: "u8" },
              { name: "op", type: { defined: { name: "BinaryExpression" } } },
              {
                name: "predicate",
                type: { defined: { name: "TraderPredicate" } },
              },
            ],
          },
        ],
      },
    },
    {
      name: "StatValidationInput",
      type: {
        kind: "struct",
        fields: [
          { name: "ts", type: "i64" },
          {
            name: "fixture_summary",
            type: { defined: { name: "ScoresBatchSummary" } },
          },
          {
            name: "fixture_proof",
            type: { vec: { defined: { name: "ProofNode" } } },
          },
          {
            name: "main_tree_proof",
            type: { vec: { defined: { name: "ProofNode" } } },
          },
          { name: "event_stat_root", type: { array: ["u8", 32] } },
          { name: "stats", type: { vec: { defined: { name: "StatLeaf" } } } },
        ],
      },
    },
    {
      name: "TraderPredicate",
      type: {
        kind: "struct",
        fields: [
          { name: "threshold", type: "i32" },
          { name: "comparison", type: { defined: { name: "Comparison" } } },
        ],
      },
    },
  ],
  errors: [
    { code: 6003, name: "InvalidSubTreeProof", msg: "Invalid sub-tree proof." },
    { code: 6004, name: "InvalidMainTreeProof", msg: "Invalid main tree proof." },
    { code: 6007, name: "RootNotAvailable", msg: "Merkle root is not available." },
    { code: 6022, name: "InvalidFixtureSubTreeProof", msg: "Invalid fixture sub-tree proof." },
    { code: 6023, name: "InvalidStatProof", msg: "Invalid stat proof." },
    { code: 6062, name: "ProofTooLarge", msg: "Proof too large." },
    { code: 6068, name: "MissingProof", msg: "Missing proof." },
    { code: 6069, name: "TooManyStats", msg: "Too many stats." },
    { code: 6070, name: "DuplicateStatCoverage", msg: "Duplicate stat coverage." },
    { code: 6071, name: "IncompleteStatCoverage", msg: "Incomplete stat coverage." },
    { code: 6073, name: "IndexOutOfBounds", msg: "Index out of bounds." },
    { code: 6075, name: "LengthMismatch", msg: "Length mismatch." },
    { code: 6076, name: "InvalidMultiproof", msg: "Invalid multiproof." },
    { code: 6077, name: "MissingProofNode", msg: "Missing proof node." },
    { code: 6078, name: "InvalidProofPath", msg: "Invalid proof path." },
  ],
} as const satisfies Idl;
