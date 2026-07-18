import {
  accessErrorResponse,
  withLiveAccess,
} from "../../../server/access-control";
import {
  isSolanaValidationRuntimeConfigured,
  readServerConfig,
} from "../../../server/config";
import { TxlineClient, TxlineRequestError } from "../../../server/txline";
import {
  ProofBoundaryError,
  fetchScoreStatProof,
  normaliseScoreProofRequest,
  type TxLineProofClient,
} from "../../../server/verification";

export const dynamic = "force-dynamic";

function failure(code: string, message: string, status: number) {
  return Response.json(
    { error: { code, message } },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export async function GET(request: Request) {
  let mode: "synthetic" | "live" | undefined;
  try {
    const config = readServerConfig();
    mode = config.mode;
    return await withLiveAccess(request, config, "request", async () => {
      const url = new URL(request.url);
      const statKeys = (url.searchParams.get("statKeys") ?? "")
        .split(",")
        .filter((value) => value !== "");
      const subject = normaliseScoreProofRequest({
        fixtureId: url.searchParams.get("fixtureId"),
        seq: url.searchParams.get("seq"),
        statKeys,
      });

      let proofClient: TxLineProofClient | null = null;
      if (config.mode === "live" && config.txline.apiToken) {
        const txline = new TxlineClient(config);
        proofClient = {
          getScoreStatValidation: () =>
            txline.getScoreStatValidation({
              fixtureId: subject.fixtureId,
              seq: subject.seq,
              statKeys: subject.statKeys,
            }),
        };
      }

      const result = await fetchScoreStatProof(proofClient, subject, {
        requireRuntimeValidation: config.solana.validationRequested,
      });
      const validation =
        result.proof && isSolanaValidationRuntimeConfigured(config)
          ? await import("../../../server/solana-runtime").then(
              ({ validateScoreProofOnSolana }) =>
                validateScoreProofOnSolana(result.proof!, config),
            )
          : null;
      const payload = {
        state: validation?.state ?? result.state,
        verified: validation?.verified ?? false,
        fixtureId: result.fixtureId,
        seq: result.seq,
        statKeys: [...result.statKeys],
        message: validation?.message ?? result.message,
        proof: result.proof
          ? {
              proofTimestamp: result.proof.ts,
              updateCount: result.proof.fixtureSummary.updateStats.updateCount,
              stats: result.proof.stats.map(({ stat }) => ({ ...stat })),
            }
          : null,
        validation,
      };
      return Response.json(payload, {
        headers: { "Cache-Control": "no-store" },
      });
    });
  } catch (error) {
    const accessFailure = accessErrorResponse(error, mode);
    if (accessFailure) return accessFailure;
    if (error instanceof ProofBoundaryError) {
      if (error.code === "INVALID_REQUEST") {
        return failure(error.code, error.message, 400);
      }
      if (error.code === "INVALID_PROOF") {
        return failure(
          error.code,
          "TxLINE returned a score proof that failed contract validation.",
          502,
        );
      }
      const message =
        error.status === 401 || error.status === 403
          ? "TxLINE rejected proof access. Check that the token, subscription and network match."
          : "The TxLINE score proof could not be retrieved.";
      return failure(error.code, message, 502);
    }
    if (error instanceof TxlineRequestError) {
      return failure(error.code, error.message, error.status);
    }
    return failure(
      "VERIFICATION_FAILED",
      "The proof boundary could not process this request.",
      500,
    );
  }
}
