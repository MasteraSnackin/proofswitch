import type { ServerConfig } from "./config";

export interface TxlineFixtureRecord {
  Ts: unknown;
  StartTime: unknown;
  Competition: unknown;
  CompetitionId: unknown;
  FixtureGroupId: unknown;
  Participant1Id: unknown;
  Participant1: unknown;
  Participant2Id: unknown;
  Participant2: unknown;
  FixtureId: unknown;
  Participant1IsHome: unknown;
}

export interface TxlineOddsRecord {
  FixtureId: unknown;
  MessageId: unknown;
  Ts: unknown;
  Bookmaker: unknown;
  BookmakerId: unknown;
  SuperOddsType: unknown;
  InRunning: unknown;
  GameState: unknown;
  MarketParameters: unknown;
  MarketPeriod: unknown;
  PriceNames: unknown;
  Prices: unknown;
  Pct: unknown;
}

export interface TxlineScoreRecord {
  fixtureId: unknown;
  gameState?: unknown;
  startTime?: unknown;
  isTeam?: unknown;
  fixtureGroupId?: unknown;
  competitionId?: unknown;
  countryId?: unknown;
  sportId?: unknown;
  participant1IsHome?: unknown;
  participant2Id?: unknown;
  participant1Id?: unknown;
  action?: unknown;
  id?: unknown;
  ts: unknown;
  connectionId?: unknown;
  seq: unknown;
  coverageSecondaryData?: unknown;
  coverageType?: unknown;
  statusId?: unknown;
  dataSoccer?: unknown;
  scoreSoccer?: unknown;
}

export type TxlineStreamKind = "odds" | "scores";
export type FetchImplementation = (
  input: URL | RequestInfo,
  init?: RequestInit,
) => Promise<Response>;

export class TxlineRequestError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(
    code: string,
    message: string,
    status: number,
  ) {
    super(message);
    this.name = "TxlineRequestError";
    this.code = code;
    this.status = status;
  }
}

export function parseFixtureId(value: unknown) {
  const text = typeof value === "number" ? String(value) : String(value ?? "").trim();
  if (!/^[1-9]\d*$/.test(text)) {
    throw new TxlineRequestError(
      "INVALID_FIXTURE_ID",
      "fixtureId must be a positive integer.",
      400,
    );
  }
  const fixtureId = Number(text);
  if (!Number.isSafeInteger(fixtureId)) {
    throw new TxlineRequestError(
      "INVALID_FIXTURE_ID",
      "fixtureId is outside the supported integer range.",
      400,
    );
  }
  return fixtureId;
}

function parseOptionalInteger(
  value: number | undefined,
  name: string,
  minimum: number,
) {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new TxlineRequestError(
      "INVALID_QUERY",
      `${name} must be an integer greater than or equal to ${minimum}.`,
      400,
    );
  }
  return value;
}

function safeLastEventId(value: string | undefined) {
  if (value === undefined) return undefined;
  if (value.length > 256 || /[\r\n\0]/.test(value)) {
    throw new TxlineRequestError(
      "INVALID_LAST_EVENT_ID",
      "Last-Event-ID contains unsupported characters or is too long.",
      400,
    );
  }
  return value;
}

export class TxlineClient {
  private readonly config: ServerConfig;
  private readonly fetchImplementation: FetchImplementation;
  private guestToken: string | null = null;
  private guestTokenRequest: Promise<string> | null = null;

  constructor(
    config: ServerConfig,
    fetchImplementation: FetchImplementation = fetch,
  ) {
    this.config = config;
    this.fetchImplementation = fetchImplementation;
  }

  async getFixtures(options: {
    startEpochDay?: number;
    competitionId?: number;
  } = {}) {
    const url = new URL("/api/fixtures/snapshot", this.config.txline.origin);
    const startEpochDay = parseOptionalInteger(
      options.startEpochDay,
      "startEpochDay",
      0,
    );
    const competitionId = parseOptionalInteger(
      options.competitionId,
      "competitionId",
      1,
    );
    if (startEpochDay !== undefined) {
      url.searchParams.set("startEpochDay", String(startEpochDay));
    }
    if (competitionId !== undefined) {
      url.searchParams.set("competitionId", String(competitionId));
    }
    return this.requestJson(url);
  }

  async getOddsSnapshot(fixtureIdValue: unknown) {
    const fixtureId = parseFixtureId(fixtureIdValue);
    return this.requestJson(
      new URL(
        `/api/odds/snapshot/${fixtureId}`,
        this.config.txline.origin,
      ),
    );
  }

  async getScoresSnapshot(fixtureIdValue: unknown) {
    const fixtureId = parseFixtureId(fixtureIdValue);
    return this.requestJson(
      new URL(
        `/api/scores/snapshot/${fixtureId}`,
        this.config.txline.origin,
      ),
    );
  }

  async getScoreStatValidation(options: {
    fixtureId: unknown;
    seq: unknown;
    statKeys: readonly number[];
  }): Promise<{ status: number; data?: unknown }> {
    const fixtureId = parseFixtureId(options.fixtureId);
    const seq = Number(options.seq);
    if (!Number.isSafeInteger(seq) || seq < 1) {
      throw new TxlineRequestError(
        "INVALID_SCORE_SEQUENCE",
        "seq must be a real score sequence greater than or equal to 1.",
        400,
      );
    }
    if (
      !Array.isArray(options.statKeys) ||
      options.statKeys.length === 0 ||
      options.statKeys.length > 32 ||
      options.statKeys.some(
        (key) => !Number.isSafeInteger(key) || key < 1,
      ) ||
      new Set(options.statKeys).size !== options.statKeys.length
    ) {
      throw new TxlineRequestError(
        "INVALID_STAT_KEYS",
        "statKeys must contain 1 to 32 unique positive integers.",
        400,
      );
    }

    const url = new URL(
      "/api/scores/stat-validation",
      this.config.txline.origin,
    );
    url.searchParams.set("fixtureId", String(fixtureId));
    url.searchParams.set("seq", String(seq));
    url.searchParams.set("statKeys", options.statKeys.join(","));
    const response = await this.authorisedFetch(
      url,
      {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store",
      },
      true,
    );

    let data: unknown;
    try {
      data = await response.json();
    } catch {
      // A non-JSON error response still has a useful status for the caller.
    }
    return data === undefined
      ? { status: response.status }
      : { status: response.status, data };
  }

  async openStream(
    kind: TxlineStreamKind,
    fixtureIdValue: unknown,
    lastEventIdValue?: string,
  ) {
    const fixtureId = parseFixtureId(fixtureIdValue);
    const lastEventId = safeLastEventId(lastEventIdValue);
    const url = new URL(`/api/${kind}/stream`, this.config.txline.origin);
    url.searchParams.set("fixtureId", String(fixtureId));
    const headers = new Headers({ Accept: "text/event-stream" });
    if (lastEventId) headers.set("Last-Event-ID", lastEventId);
    const response = await this.authorisedFetch(url, {
      method: "GET",
      headers,
      cache: "no-store",
    });
    if (!response.body) {
      throw new TxlineRequestError(
        "TXLINE_EMPTY_STREAM",
        "TxLINE returned a stream response without a body.",
        502,
      );
    }
    return response;
  }

  private async requestJson(url: URL) {
    const response = await this.authorisedFetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    try {
      return (await response.json()) as unknown;
    } catch {
      throw new TxlineRequestError(
        "TXLINE_INVALID_JSON",
        "TxLINE returned a response that was not valid JSON.",
        502,
      );
    }
  }

  private async authorisedFetch(
    url: URL,
    init: RequestInit,
    allowNonOk = false,
  ) {
    if (this.config.mode !== "live" || !this.config.txline.apiToken) {
      throw new TxlineRequestError(
        "LIVE_NOT_CONFIGURED",
        "Live mode requires an activated TxLINE API token. Synthetic data was not substituted.",
        503,
      );
    }

    let token = await this.getGuestToken();
    let response = await this.fetchData(url, init, token);

    // Guest JWTs are short-lived. Refresh exactly once on 401. A 403 means the
    // subscription/network is not authorised and must not trigger token churn.
    if (response.status === 401) {
      this.guestToken = null;
      token = await this.getGuestToken();
      response = await this.fetchData(url, init, token);
    }

    if (!response.ok && !allowNonOk) {
      const code =
        response.status === 403
          ? "TXLINE_FORBIDDEN"
          : response.status === 401
            ? "TXLINE_UNAUTHORISED"
            : "TXLINE_UPSTREAM_ERROR";
      throw new TxlineRequestError(
        code,
        `TxLINE request failed with HTTP ${response.status}.`,
        response.status >= 400 && response.status < 500
          ? response.status
          : 502,
      );
    }
    return response;
  }

  private async fetchData(url: URL, init: RequestInit, guestToken: string) {
    try {
      return await this.fetchWithCredentials(url, init, guestToken);
    } catch {
      throw new TxlineRequestError(
        "TXLINE_UNREACHABLE",
        "The TxLINE data endpoint could not be reached.",
        502,
      );
    }
  }

  private fetchWithCredentials(url: URL, init: RequestInit, guestToken: string) {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${guestToken}`);
    headers.set("X-Api-Token", this.config.txline.apiToken ?? "");
    return this.fetchImplementation(url, { ...init, headers });
  }

  private async getGuestToken() {
    if (this.guestToken) return this.guestToken;
    if (this.guestTokenRequest) return this.guestTokenRequest;

    this.guestTokenRequest = this.startGuestSession();
    try {
      this.guestToken = await this.guestTokenRequest;
      return this.guestToken;
    } finally {
      this.guestTokenRequest = null;
    }
  }

  private async startGuestSession() {
    const url = new URL("/auth/guest/start", this.config.txline.origin);
    let response: Response;
    try {
      response = await this.fetchImplementation(url, {
        method: "POST",
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
    } catch {
      throw new TxlineRequestError(
        "TXLINE_UNREACHABLE",
        "The TxLINE guest authentication endpoint could not be reached.",
        502,
      );
    }

    if (!response.ok) {
      throw new TxlineRequestError(
        "TXLINE_GUEST_AUTH_FAILED",
        `TxLINE guest authentication failed with HTTP ${response.status}.`,
        response.status >= 400 && response.status < 500
          ? response.status
          : 502,
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new TxlineRequestError(
        "TXLINE_GUEST_AUTH_INVALID",
        "TxLINE guest authentication returned invalid JSON.",
        502,
      );
    }
    if (
      typeof payload !== "object" ||
      payload === null ||
      typeof (payload as { token?: unknown }).token !== "string" ||
      !(payload as { token: string }).token.trim()
    ) {
      throw new TxlineRequestError(
        "TXLINE_GUEST_AUTH_INVALID",
        "TxLINE guest authentication did not return a token.",
        502,
      );
    }
    return (payload as { token: string }).token.trim();
  }
}
