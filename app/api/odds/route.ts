import type { ApiFailure, ApiSuccess, MatchWinnerOdds } from "../../../lib/contracts";
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
  normaliseFixtures,
  normaliseMatchWinnerOdds,
} from "../../../server/normalise";
import {
  assertSyntheticFixture,
  syntheticOdds,
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
  let code = "ODDS_FAILED";
  let message = "Odds could not be loaded.";
  if (error instanceof TxlineRequestError) {
    ({ status, code, message } = error);
  } else if (error instanceof DataContractError) {
    status = error.code === "MATCH_WINNER_UNAVAILABLE" ? 404 : 502;
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
      let odds: MatchWinnerOdds;

      if (config.mode === "synthetic") {
        assertSyntheticFixture(fixtureId);
        odds = syntheticOdds();
      } else {
        assertLiveConfigured(config);
        const client = new TxlineClient(config);
        const rawOdds = await client.getOddsSnapshot(fixtureId);
        try {
          odds = normaliseMatchWinnerOdds(rawOdds, {
            expectedFixtureId: fixtureId,
          });
        } catch (error) {
          if (
            !(error instanceof DataContractError) ||
            error.code !== "MATCH_WINNER_UNAVAILABLE"
          ) {
            throw error;
          }
          const fixture = normaliseFixtures(await client.getFixtures()).find(
            (candidate) => candidate.fixtureId === fixtureId,
          );
          if (!fixture) throw error;
          odds = normaliseMatchWinnerOdds(rawOdds, {
            expectedFixtureId: fixtureId,
            fixture,
          });
        }
      }

      const payload: ApiSuccess<MatchWinnerOdds> = {
        data: odds,
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
