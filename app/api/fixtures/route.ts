import type { ApiFailure, ApiSuccess, Fixture } from "../../../lib/contracts";
import {
  accessErrorResponse,
  withLiveAccess,
} from "../../../server/access-control";
import {
  ConfigurationError,
  assertLiveConfigured,
  readServerConfig,
} from "../../../server/config";
import { DataContractError, normaliseFixtures } from "../../../server/normalise";
import { syntheticFixtures } from "../../../server/synthetic";
import { TxlineClient, TxlineRequestError } from "../../../server/txline";

export const dynamic = "force-dynamic";

function optionalInteger(
  url: URL,
  name: "startEpochDay" | "competitionId",
  minimum: number,
) {
  const raw = url.searchParams.get(name);
  if (raw === null) return undefined;
  if (!/^\d+$/.test(raw)) {
    throw new TxlineRequestError(
      "INVALID_QUERY",
      `${name} must be an integer greater than or equal to ${minimum}.`,
      400,
    );
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) {
    throw new TxlineRequestError(
      "INVALID_QUERY",
      `${name} must be an integer greater than or equal to ${minimum}.`,
      400,
    );
  }
  return parsed;
}

function errorResponse(error: unknown, mode?: "synthetic" | "live") {
  const accessFailure = accessErrorResponse(error, mode);
  if (accessFailure) return accessFailure;
  let status = 500;
  let code = "FIXTURES_FAILED";
  let message = "Fixtures could not be loaded.";
  if (error instanceof TxlineRequestError) {
    ({ status, code, message } = error);
  } else if (error instanceof DataContractError) {
    status = 502;
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
      const url = new URL(request.url);
      const startEpochDay = optionalInteger(url, "startEpochDay", 0);
      const competitionId = optionalInteger(url, "competitionId", 1);
      let fixtures: Fixture[];

      if (config.mode === "synthetic") {
        fixtures = syntheticFixtures().filter((fixture) => {
          const fixtureEpochDay = Math.floor(fixture.startTime / 86_400_000);
          return (
            (startEpochDay === undefined || fixtureEpochDay >= startEpochDay) &&
            (competitionId === undefined || fixture.competitionId === competitionId)
          );
        });
      } else {
        assertLiveConfigured(config);
        const raw = await new TxlineClient(config).getFixtures({
          startEpochDay,
          competitionId,
        });
        fixtures = normaliseFixtures(raw);
      }

      const payload: ApiSuccess<Fixture[]> = {
        data: fixtures,
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
