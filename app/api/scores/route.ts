import type { ApiFailure, ApiSuccess, ScoreSnapshot } from "../../../lib/contracts";
import {
  accessErrorResponse,
  withLiveAccess,
} from "../../../server/access-control";
import {
  ConfigurationError,
  assertLiveConfigured,
  readServerConfig,
} from "../../../server/config";
import {
  DataContractError,
  normaliseScoreSnapshot,
} from "../../../server/normalise";
import {
  assertSyntheticFixture,
  syntheticScore,
} from "../../../server/synthetic";
import {
  TxlineClient,
  TxlineRequestError,
  parseFixtureId,
} from "../../../server/txline";

export const dynamic = "force-dynamic";

function errorResponse(error: unknown, mode?: "synthetic" | "live") {
  const accessFailure = accessErrorResponse(error, mode);
  if (accessFailure) return accessFailure;
  let status = 500;
  let code = "SCORES_FAILED";
  let message = "Scores could not be loaded.";
  if (error instanceof TxlineRequestError) {
    ({ status, code, message } = error);
  } else if (error instanceof DataContractError) {
    status = error.code === "SCORE_UNAVAILABLE" ? 404 : 502;
    ({ code, message } = error);
  } else if (error instanceof ConfigurationError) {
    status = error.code === "LIVE_NOT_CONFIGURED" ? 503 : 500;
    code = error.code;
    message = error.message;
  }
  const failure: ApiFailure = { error: { code, message }, mode };
  return Response.json(failure, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function GET(request: Request) {
  let mode: "synthetic" | "live" | undefined;
  try {
    const config = readServerConfig();
    mode = config.mode;
    return await withLiveAccess(request, config, "request", async () => {
      const fixtureId = parseFixtureId(
        new URL(request.url).searchParams.get("fixtureId"),
      );
      let score: ScoreSnapshot;

      if (config.mode === "synthetic") {
        assertSyntheticFixture(fixtureId);
        score = syntheticScore();
      } else {
        assertLiveConfigured(config);
        score = normaliseScoreSnapshot(
          await new TxlineClient(config).getScoresSnapshot(fixtureId),
          fixtureId,
        );
      }

      const payload: ApiSuccess<ScoreSnapshot> = {
        data: score,
        mode: config.mode,
        source: config.mode === "live" ? "txline" : "synthetic",
        receivedAt: new Date().toISOString(),
      };
      return Response.json(payload, {
        headers: { "Cache-Control": "no-store" },
      });
    });
  } catch (error) {
    return errorResponse(error, mode);
  }
}
