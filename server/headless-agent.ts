import type {
  ApiSuccess,
  AppStatus,
  Fixture,
  MatchWinnerOdds,
  ScoreSnapshot,
  StreamEnvelope,
} from "../lib/contracts.ts";
import {
  AGENT_TRACE_SCHEMA,
  compareShockThresholds,
  replayAgentTrace,
  type AgentTrace,
} from "../app/agent-replay.ts";
import {
  createLiveEngineState,
  createDeterministicPaperFillEvent,
  activeLivePaperOrders,
  remainingLivePaperOrderQuantity,
  reduceLiveEngineEvent,
  type LiveEngineEvent,
  type LiveEngineState,
  type LiveHeartbeatEvent,
  type LiveOddsEvent,
  type LiveScoreEvent,
  type LiveTransportChannel,
} from "../app/live-engine.ts";
import { SseParser } from "./sse.ts";

const HEADLESS_REPORT_SCHEMA = "proofswitch.headless-run.v1" as const;
const MAX_TRACE_EVENTS = 50_000;
const MAX_TRANSPORT_ERRORS = 100;
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

interface AccessStatus {
  required: boolean;
  configured: boolean;
  authenticated: boolean;
  expiresAt: string | null;
}

interface HeadlessTransportSummary {
  oddsConnections: number;
  scoreConnections: number;
  reconnects: number;
  contractErrorsDropped: number;
  contractErrors: Array<{
    channel: "odds" | "scores";
    code: string;
    receivedAt: string;
  }>;
}

export interface HeadlessAgentOptions {
  baseUrl?: string;
  fixtureId?: number;
  durationMs?: number;
  accessCode?: string;
  simulateFills?: boolean;
  requestTimeoutMs?: number;
  fetchImplementation?: typeof fetch;
  onState?: (state: LiveEngineState) => void;
}

export interface HeadlessRunReport {
  schema: typeof HEADLESS_REPORT_SCHEMA;
  integrity: "device-local-unsigned";
  source: "synthetic" | "txline";
  mode: AppStatus["mode"];
  network: AppStatus["network"];
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  fixture: Fixture;
  transport: HeadlessTransportSummary;
  metrics: ReturnType<typeof replayAgentTrace>["metrics"];
  sensitivity: ReturnType<typeof compareShockThresholds>;
  proof: unknown;
  engine: LiveEngineState;
  dataHandling: {
    rawUpstreamPayloadsStored: false;
    canonicalTraceReturnedSeparately: true;
    warning: string;
  };
  execution: {
    paperOnly: true;
    deterministicFillSimulator: boolean;
  };
}

export interface HeadlessRunResult {
  report: HeadlessRunReport;
  trace: AgentTrace;
}

function clockLabel(atMs: number) {
  return new Date(atMs).toLocaleTimeString("en-GB", {
    hour12: false,
    timeZone: "Europe/London",
  });
}

function safeBaseUrl(value: string | undefined) {
  const candidate = value?.trim() || "http://localhost:3000";
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new RangeError("Headless agent base URL must be an absolute URL");
  }
  const localHttp =
    url.protocol === "http:" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  if (url.protocol !== "https:" && !localHttp) {
    throw new RangeError("Headless agent base URL must use HTTPS or local HTTP");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new RangeError("Headless agent base URL cannot contain credentials, query or fragment");
  }
  url.pathname = url.pathname.replace(/\/$/, "");
  return url;
}

function duration(value: number | undefined) {
  const selected = value ?? 15_000;
  if (!Number.isSafeInteger(selected) || selected < 2_000 || selected > 3_600_000) {
    throw new RangeError("Headless agent duration must be between 2 seconds and 1 hour");
  }
  return selected;
}

function requestTimeout(value: number | undefined) {
  const selected = value ?? DEFAULT_REQUEST_TIMEOUT_MS;
  if (!Number.isSafeInteger(selected) || selected < 25 || selected > 60_000) {
    throw new RangeError("Headless request timeout must be between 25ms and 60 seconds");
  }
  return selected;
}

function asObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} returned an invalid object`);
  }
  return value as Record<string, unknown>;
}

function apiMessage(value: unknown, fallback: string) {
  const record = asObject(value, "Local API");
  const error = record.error;
  if (typeof error === "object" && error !== null && !Array.isArray(error)) {
    const message = (error as Record<string, unknown>).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
}

function cookieFrom(response: Response) {
  const header = response.headers.get("set-cookie");
  if (!header) return null;
  const pair = header.split(";", 1)[0]?.trim();
  return pair && pair.includes("=") ? pair : null;
}

function selectFixture(
  fixtures: Fixture[],
  requestedFixtureId: number | undefined,
  preferredFixtureId: number | null,
  now = Date.now(),
) {
  if (fixtures.length === 0) throw new Error("The fixture catalogue is empty");
  if (requestedFixtureId !== undefined) {
    const requested = fixtures.find((fixture) => fixture.fixtureId === requestedFixtureId);
    if (!requested) throw new Error(`Fixture ${requestedFixtureId} is not in the catalogue`);
    return requested;
  }
  const preferred =
    preferredFixtureId === null
      ? undefined
      : fixtures.find((fixture) => fixture.fixtureId === preferredFixtureId);
  if (preferred) return preferred;
  const worldCup = fixtures.filter((fixture) => /world\s*cup/i.test(fixture.competition));
  const candidates = worldCup.length > 0 ? worldCup : fixtures;
  const active = candidates
    .filter(
      (fixture) =>
        now >= fixture.startTime - 15 * 60_000 &&
        now <= fixture.startTime + 4 * 60 * 60_000,
    )
    .sort((left, right) => right.startTime - left.startTime)[0];
  if (active) return active;
  return (
    candidates
      .filter((fixture) => fixture.startTime > now)
      .sort((left, right) => left.startTime - right.startTime)[0] ??
    [...candidates].sort((left, right) => right.startTime - left.startTime)[0]
  );
}

function oddsEvent(
  snapshot: MatchWinnerOdds,
  receivedAt: number,
  eventId?: string | null,
): LiveOddsEvent {
  return {
    kind: "ODDS",
    fixtureId: String(snapshot.fixtureId),
    messageId:
      snapshot.messageId?.trim() ||
      ["headless", snapshot.fixtureId, snapshot.ts, snapshot.market.superOddsType].join(":"),
    sseId: eventId || undefined,
    priceTsMs: snapshot.ts,
    pct: snapshot.probabilities,
    inRunning: snapshot.inRunning,
    gameState: snapshot.gameState,
    atMs: receivedAt,
    clock: clockLabel(receivedAt),
  };
}

function scoreEvent(snapshot: ScoreSnapshot, receivedAt: number): LiveScoreEvent {
  return {
    kind: "SCORE",
    fixtureId: String(snapshot.fixtureId),
    seq: snapshot.seq,
    scoreTsMs: snapshot.ts,
    score: { ...snapshot.score },
    redCards: { ...snapshot.redCards },
    action: snapshot.action ?? undefined,
    confirmed: snapshot.confirmed,
    finalised:
      snapshot.finalised === true ||
      snapshot.action?.toLowerCase().replace(/[\s-]+/g, "_") === "game_finalised",
    atMs: receivedAt,
    clock: clockLabel(receivedAt),
  };
}

function heartbeatEvent(
  fixtureId: number,
  channel: LiveTransportChannel,
  receivedAt: number,
  sseId?: string,
): LiveHeartbeatEvent {
  return {
    kind: "HEARTBEAT",
    fixtureId: String(fixtureId),
    channel,
    atMs: receivedAt,
    clock: clockLabel(receivedAt),
    sseId,
  };
}

function sleep(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(resolve, milliseconds);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

export async function runHeadlessAgent(
  options: HeadlessAgentOptions = {},
): Promise<HeadlessRunResult> {
  const baseUrl = safeBaseUrl(options.baseUrl);
  const runDurationMs = duration(options.durationMs);
  const nonStreamRequestTimeoutMs = requestTimeout(options.requestTimeoutMs);
  const fetchImplementation = options.fetchImplementation ?? fetch;
  let cookie: string | null = null;

  const request = async (
    path: string,
    init: RequestInit = {},
    timeoutMs: number | null = nonStreamRequestTimeoutMs,
  ) => {
    const headers = new Headers(init.headers);
    if (cookie) headers.set("Cookie", cookie);
    if (timeoutMs === null) {
      return fetchImplementation(new URL(path, `${baseUrl.toString()}/`), {
        ...init,
        headers,
        cache: "no-store",
      });
    }
    const controller = new AbortController();
    const suppliedSignal = init.signal;
    const abortFromCaller = () => controller.abort(suppliedSignal?.reason);
    if (suppliedSignal?.aborted) abortFromCaller();
    else suppliedSignal?.addEventListener("abort", abortFromCaller, { once: true });
    let timedOut = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        timedOut = true;
        controller.abort("request-timeout");
        reject(new Error(`${path} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });
    try {
      const fetchPromise = fetchImplementation(
        new URL(path, `${baseUrl.toString()}/`),
        {
          ...init,
          headers,
          cache: "no-store",
          signal: controller.signal,
        },
      );
      return await Promise.race([fetchPromise, timeoutPromise]);
    } catch (error) {
      if (timedOut) throw new Error(`${path} timed out after ${timeoutMs}ms`);
      throw error;
    } finally {
      if (timeout !== null) clearTimeout(timeout);
      suppliedSignal?.removeEventListener("abort", abortFromCaller);
    }
  };

  async function readJsonBody(response: Response, path: string) {
    let timedOut = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        timedOut = true;
        reject(
          new Error(
            `${path} response body timed out after ${nonStreamRequestTimeoutMs}ms`,
          ),
        );
      }, nonStreamRequestTimeoutMs);
    });
    try {
      return await Promise.race([response.json() as Promise<unknown>, timeoutPromise]);
    } catch (error) {
      if (timedOut) throw error;
      throw new Error(`${path} returned non-JSON data`);
    } finally {
      if (timeout !== null) clearTimeout(timeout);
    }
  }

  async function json(path: string, init: RequestInit = {}) {
    const response = await request(path, init);
    const payload = await readJsonBody(response, path);
    if (!response.ok) throw new Error(apiMessage(payload, `${path} returned HTTP ${response.status}`));
    return payload;
  }

  const accessResponse = await request("/api/access");
  if (accessResponse.ok) {
    const accessPayload = asObject(
      await readJsonBody(accessResponse, "/api/access"),
      "Access response",
    );
    const access = asObject(accessPayload.data, "Access status") as unknown as AccessStatus;
    if (access.required && !access.authenticated) {
      if (!access.configured) {
        throw new Error("Live judge access is required but the server has no access configuration");
      }
      if (!options.accessCode?.trim()) {
        throw new Error("Live judge access is required; provide an access code to the headless runner");
      }
      const response = await request("/api/access", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: baseUrl.origin,
        },
        body: JSON.stringify({ code: options.accessCode.trim() }),
      });
      const payload = await readJsonBody(response, "/api/access");
      if (!response.ok) {
        throw new Error(apiMessage(payload, "The judge access code was rejected"));
      }
      cookie = cookieFrom(response);
      if (!cookie) throw new Error("The access endpoint did not issue a session cookie");
    }
  } else if (accessResponse.status !== 404) {
    throw new Error(`/api/access returned HTTP ${accessResponse.status}`);
  }

  const statusEnvelope = asObject(await json("/api/status"), "Status response") as unknown as ApiSuccess<AppStatus>;
  const status = statusEnvelope.data;
  if (!status || (status.mode !== "synthetic" && status.mode !== "live")) {
    throw new Error("The application status contract is invalid");
  }
  if (status.mode === "live" && !status.liveConfigured) {
    throw new Error("Live mode is selected but TxLINE access is not configured");
  }

  const fixturesEnvelope = asObject(await json("/api/fixtures"), "Fixtures response") as unknown as ApiSuccess<Fixture[]>;
  if (!Array.isArray(fixturesEnvelope.data)) throw new Error("The fixture catalogue contract is invalid");
  const fixture = selectFixture(
    fixturesEnvelope.data,
    options.fixtureId,
    status.txline.preferredFixtureId,
  );
  const source = status.mode === "live" ? "txline" : "synthetic";
  const startedAtMs = Date.now();
  let nextSimulatedFillAtMs = startedAtMs + 2_000;
  let engine = createLiveEngineState({
    fixtureId: String(fixture.fixtureId),
    policy: status.policy,
  });
  const events: LiveEngineEvent[] = [];
  const transport: HeadlessTransportSummary = {
    oddsConnections: 0,
    scoreConnections: 0,
    reconnects: 0,
    contractErrorsDropped: 0,
    contractErrors: [],
  };

  const recordTransportError = (
    channel: "odds" | "scores",
    code: string,
    receivedAtMs = Date.now(),
  ) => {
    transport.contractErrors.push({
      channel,
      code: code.trim().slice(0, 120) || "STREAM_FAILURE",
      receivedAt: new Date(receivedAtMs).toISOString(),
    });
    if (transport.contractErrors.length > MAX_TRANSPORT_ERRORS) {
      transport.contractErrors.shift();
      transport.contractErrorsDropped += 1;
    }
  };

  const apply = (event: LiveEngineEvent) => {
    if (engine.status === "CLOSED") return;
    if (events.length >= MAX_TRACE_EVENTS) {
      throw new Error("The bounded headless trace event limit was reached");
    }
    const atMs = Math.max(event.atMs, engine.nowMs);
    const adjusted =
      atMs === event.atMs
        ? event
        : ({ ...event, atMs, clock: clockLabel(atMs) } as LiveEngineEvent);
    engine = reduceLiveEngineEvent(engine, adjusted);
    events.push(adjusted);
    options.onState?.(engine);
  };

  const [oddsEnvelope, scoreEnvelope] = await Promise.all([
    json(`/api/odds?fixtureId=${fixture.fixtureId}`),
    json(`/api/scores?fixtureId=${fixture.fixtureId}`),
  ]);
  const snapshotAtMs = Date.now();
  apply(scoreEvent((scoreEnvelope as ApiSuccess<ScoreSnapshot>).data, snapshotAtMs));
  apply(oddsEvent((oddsEnvelope as ApiSuccess<MatchWinnerOdds>).data, snapshotAtMs + 1));

  const controller = new AbortController();
  const stopTimer = setTimeout(() => controller.abort("duration-complete"), runDurationMs);
  let fatalContractFailure: string | null = null;

  const failClosedForContract = (
    channel: "odds" | "scores",
    code: string,
    receivedAt: number,
  ) => {
    const boundedCode = code.trim().slice(0, 120) || "STREAM_CONTRACT_FAILURE";
    recordTransportError(channel, boundedCode, receivedAt);
    fatalContractFailure = `${channel}:${boundedCode}`;
    if (engine.status !== "CLOSED") {
      apply({
        kind: "SESSION_END",
        fixtureId: String(fixture.fixtureId),
        reason: `The ${channel} stream failed the local data contract (${boundedCode})`,
        atMs: Math.max(receivedAt, engine.nowMs),
        clock: clockLabel(Math.max(receivedAt, engine.nowMs)),
      });
    }
    controller.abort("stream-contract-failure");
  };

  const consume = async (kind: "odds" | "scores") => {
    let lastEventId = "";
    let retryMs = 1_000;
    let opened = 0;
    while (!controller.signal.aborted) {
      try {
        const headers = new Headers({ Accept: "text/event-stream" });
        if (lastEventId) headers.set("Last-Event-ID", lastEventId);
        const response = await request(
          `/api/stream?kind=${kind}&fixtureId=${fixture.fixtureId}`,
          { headers, signal: controller.signal },
          null,
        );
        if (!response.ok || !response.body) {
          throw new Error(`${kind} stream returned HTTP ${response.status}`);
        }
        opened += 1;
        if (kind === "odds") transport.oddsConnections += 1;
        else transport.scoreConnections += 1;
        if (opened > 1) transport.reconnects += 1;

        const reader = response.body.getReader();
        const parser = new SseParser();
        while (!controller.signal.aborted) {
          const { done, value } = await reader.read();
          if (done) break;
          for (const item of parser.push(value)) {
            if (item.type === "retry") {
              retryMs = Math.max(250, Math.min(10_000, item.retry));
              continue;
            }
            if (item.id) lastEventId = item.id;
            const receivedAt = Math.max(Date.now(), engine.nowMs);
            if (item.event === "heartbeat") {
              apply(
                heartbeatEvent(
                  fixture.fixtureId,
                  kind === "odds" ? "ODDS" : "SCORES",
                  receivedAt,
                  item.id || undefined,
                ),
              );
              continue;
            }
            let parsed: unknown;
            try {
              parsed = JSON.parse(item.data);
            } catch {
              failClosedForContract(kind, "LOCAL_INVALID_JSON", receivedAt);
              try {
                await reader.cancel("stream-contract-failure");
              } catch {
                // The shared abort may already have closed the response body.
              }
              reader.releaseLock();
              return;
            }
            if (item.event === "contract-error") {
              let code = "UPSTREAM_CONTRACT_ERROR";
              try {
                const record = asObject(parsed, "Contract error");
                if (typeof record.code === "string" && record.code.trim()) {
                  code = record.code;
                }
              } catch {
                code = "UPSTREAM_INVALID_CONTRACT_ERROR";
              }
              failClosedForContract(kind, code, receivedAt);
              try {
                await reader.cancel("stream-contract-failure");
              } catch {
                // The shared abort may already have closed the response body.
              }
              reader.releaseLock();
              return;
            }
            try {
              const envelope = asObject(parsed, "Stream event") as unknown as StreamEnvelope<
                MatchWinnerOdds | ScoreSnapshot
              >;
              const expectedOddsEvent =
                kind === "odds" && (item.event === "odds" || item.event === "message");
              const expectedScoreEvent =
                kind === "scores" &&
                (item.event === "score" || item.event === "scores" || item.event === "message");
              if (expectedOddsEvent) {
                apply(oddsEvent(envelope.data as MatchWinnerOdds, receivedAt, envelope.eventId));
              } else if (expectedScoreEvent) {
                apply(scoreEvent(envelope.data as ScoreSnapshot, receivedAt));
              } else {
                throw new TypeError(`Unexpected ${kind} SSE event ${item.event}`);
              }
            } catch {
              failClosedForContract(kind, "CLIENT_STREAM_PARSE_FAILED", receivedAt);
              try {
                await reader.cancel("stream-contract-failure");
              } catch {
                // The shared abort may already have closed the response body.
              }
              reader.releaseLock();
              return;
            }
          }
        }
        reader.releaseLock();
      } catch (error) {
        if (controller.signal.aborted) break;
        recordTransportError(
          kind,
          error instanceof Error ? error.message : "STREAM_FAILURE",
        );
      }
      await sleep(retryMs, controller.signal);
    }
  };

  const timerLoop = async () => {
    while (!controller.signal.aborted) {
      await sleep(500, controller.signal);
      if (controller.signal.aborted) break;
      const atMs = Math.max(Date.now(), engine.nowMs);
      apply({ kind: "TIMER", atMs, clock: clockLabel(atMs) });
      if (options.simulateFills && atMs >= nextSimulatedFillAtMs && engine.status === "QUOTING") {
        const order = activeLivePaperOrders(engine).find(
          (candidate) => remainingLivePaperOrderQuantity(engine, candidate.id) > 0,
        );
        if (order) {
          apply(
            createDeterministicPaperFillEvent(engine, {
              fillId: `headless-fill-${engine.paperFills.length + 1}`,
              atMs,
              clock: clockLabel(atMs),
              outcome: order.outcome,
              side: order.side,
              fraction: 0.25,
            }),
          );
        }
        nextSimulatedFillAtMs = atMs + 3_000;
      }
    }
  };

  try {
    await Promise.all([consume("odds"), consume("scores"), timerLoop()]);
  } finally {
    clearTimeout(stopTimer);
    controller.abort("headless-run-finished");
  }

  const finishedAtMs = Math.max(Date.now(), engine.nowMs);
  if (engine.status !== "CLOSED") {
    apply({
      kind: "SESSION_END",
      fixtureId: String(fixture.fixtureId),
      reason: "Headless agent run completed",
      atMs: finishedAtMs,
      clock: clockLabel(finishedAtMs),
    });
  }

  const trace: AgentTrace = {
    schema: AGENT_TRACE_SCHEMA,
    source,
    fixtureId: String(fixture.fixtureId),
    capturedAt: new Date(startedAtMs).toISOString(),
    policy: status.policy,
    events,
  };
  const replay = replayAgentTrace(trace);
  let proof: unknown = fatalContractFailure
    ? {
        state: "SKIPPED_CONTRACT_FAILURE",
        verified: false,
        message: `Proof request skipped after ${fatalContractFailure}.`,
      }
    : null;
  if (engine.lastScoreSeq !== null && fatalContractFailure === null) {
    try {
      proof = await json(
        `/api/verify?fixtureId=${fixture.fixtureId}&seq=${engine.lastScoreSeq}&statKeys=1,2,5,6`,
      );
    } catch (error) {
      proof = {
        state: "REQUEST_FAILED",
        verified: false,
        message: error instanceof Error ? error.message : "Proof request failed",
      };
    }
  }

  return {
    trace,
    report: {
      schema: HEADLESS_REPORT_SCHEMA,
      integrity: "device-local-unsigned",
      source,
      mode: status.mode,
      network: status.network,
      startedAt: new Date(startedAtMs).toISOString(),
      finishedAt: new Date(finishedAtMs).toISOString(),
      durationMs: finishedAtMs - startedAtMs,
      fixture,
      transport,
      metrics: replay.metrics,
      sensitivity: compareShockThresholds(trace),
      proof,
      engine,
      dataHandling: {
        rawUpstreamPayloadsStored: false,
        canonicalTraceReturnedSeparately: true,
        warning:
          "Canonical traces may contain licensed TxLINE-derived data. Keep live traces private and do not commit or redistribute them.",
      },
      execution: {
        paperOnly: true,
        deterministicFillSimulator: options.simulateFills === true,
      },
    },
  };
}

export { selectFixture as selectHeadlessFixture };
