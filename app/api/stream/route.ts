import type {
  ApiFailure,
  Fixture,
  MatchWinnerOdds,
  ScoreSnapshot,
  StreamEnvelope,
} from "../../../lib/contracts";
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
  normaliseScoreRecord,
} from "../../../server/normalise";
import { mapSseStream, type SseMessage } from "../../../server/sse";
import { createSyntheticStream } from "../../../server/synthetic";
import {
  TxlineClient,
  TxlineRequestError,
  parseFixtureId,
  type TxlineStreamKind,
} from "../../../server/txline";

export const dynamic = "force-dynamic";

const streamHeaders = {
  "Cache-Control": "no-cache, no-store",
  "Content-Type": "text/event-stream; charset=utf-8",
  "X-Accel-Buffering": "no",
};

function readKind(url: URL): TxlineStreamKind {
  const kind = url.searchParams.get("kind");
  if (kind !== "odds" && kind !== "scores") {
    throw new TxlineRequestError(
      "INVALID_STREAM_KIND",
      "kind must be either odds or scores.",
      400,
    );
  }
  return kind;
}

function errorResponse(error: unknown, mode?: "synthetic" | "live") {
  const accessFailure = accessErrorResponse(error, mode);
  if (accessFailure) return accessFailure;
  let status = 500;
  let code = "STREAM_FAILED";
  let message = "The data stream could not be opened.";
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

function contractErrorEvent(
  kind: TxlineStreamKind,
  message: SseMessage,
  code: string,
): SseMessage {
  return {
    type: "event",
    event: "contract-error",
    id: message.id,
    data: JSON.stringify({
      code,
      channel: kind,
      eventId: message.id || null,
      receivedAt: new Date().toISOString(),
      message: `A ${kind} stream event failed the local data contract.`,
    }),
  };
}

function heartbeat(kind: TxlineStreamKind, message: SseMessage): SseMessage {
  let payload: unknown;
  try {
    payload = JSON.parse(message.data);
  } catch {
    return contractErrorEvent(kind, message, "TXLINE_INVALID_JSON");
  }
  if (
    typeof payload !== "object" ||
    payload === null ||
    typeof (payload as { Ts?: unknown }).Ts !== "number" ||
    !Number.isFinite((payload as { Ts: number }).Ts)
  ) {
    return contractErrorEvent(kind, message, "TXLINE_SCHEMA_MISMATCH");
  }
  return {
    type: "event",
    event: "heartbeat",
    id: message.id,
    data: JSON.stringify({
      Ts: (payload as { Ts: number }).Ts,
      source: "txline",
      receivedAt: new Date().toISOString(),
    }),
  };
}

function safeUpstreamMessage(
  kind: TxlineStreamKind,
  fixtureId: number,
  message: SseMessage,
  fixture?: Fixture,
): SseMessage | null {
  if (message.event === "heartbeat") return heartbeat(kind, message);

  let raw: unknown;
  try {
    raw = JSON.parse(message.data);
  } catch {
    return contractErrorEvent(kind, message, "TXLINE_INVALID_JSON");
  }

  try {
    const data: MatchWinnerOdds | ScoreSnapshot =
      kind === "odds"
        ? normaliseMatchWinnerOdds(raw, { expectedFixtureId: fixtureId, fixture })
        : normaliseScoreRecord(raw, fixtureId);
    const eventId = message.id || null;
    const envelope: StreamEnvelope<typeof data> = {
      data,
      mode: "live",
      source: "txline",
      receivedAt: new Date().toISOString(),
      eventId,
    };
    return {
      type: "event",
      event: kind === "odds" ? "odds" : "score",
      id: message.id,
      data: JSON.stringify(envelope),
    };
  } catch (error) {
    if (error instanceof DataContractError) {
      return contractErrorEvent(kind, message, error.code);
    }
    throw error;
  }
}

export async function GET(request: Request) {
  let mode: "synthetic" | "live" | undefined;
  try {
    const config = readServerConfig();
    mode = config.mode;
    return await withLiveAccess(request, config, "stream", async () => {
      const url = new URL(request.url);
      const kind = readKind(url);
      const fixtureId = parseFixtureId(url.searchParams.get("fixtureId"));

      if (config.mode === "synthetic") {
        return new Response(createSyntheticStream(kind, fixtureId), {
          headers: streamHeaders,
        });
      }

      assertLiveConfigured(config);
      const lastEventId = request.headers.get("Last-Event-ID") ?? undefined;
      const client = new TxlineClient(config);
      const fixture =
        kind === "odds"
          ? normaliseFixtures(await client.getFixtures()).find(
              (candidate) => candidate.fixtureId === fixtureId,
            )
          : undefined;
      const upstream = await client.openStream(
        kind,
        fixtureId,
        lastEventId,
      );
      const safeStream = mapSseStream(
        upstream.body as ReadableStream<Uint8Array>,
        (message) => safeUpstreamMessage(kind, fixtureId, message, fixture),
      );
      return new Response(safeStream, { headers: streamHeaders });
    });
  } catch (error) {
    return errorResponse(error, mode);
  }
}
