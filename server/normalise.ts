import type {
  Fixture,
  MatchOutcome,
  MatchWinnerOdds,
  ScoreSnapshot,
} from "../lib/contracts";
import type {
  TxlineFixtureRecord,
  TxlineOddsRecord,
  TxlineScoreRecord,
} from "./txline";

type UnknownRecord = Record<string, unknown>;

export class DataContractError extends Error {
  readonly code: string;

  constructor(
    code: string,
    message: string,
  ) {
    super(message);
    this.name = "DataContractError";
    this.code = code;
  }
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function integer(value: unknown, field: string, minimum = 0) {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new DataContractError(
      "TXLINE_SCHEMA_MISMATCH",
      `TxLINE field ${field} must be an integer greater than or equal to ${minimum}.`,
    );
  }
  return value as number;
}

function optionalInteger(value: unknown) {
  return Number.isSafeInteger(value) ? (value as number) : null;
}

function finiteNumber(value: unknown, field: string) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new DataContractError(
      "TXLINE_SCHEMA_MISMATCH",
      `TxLINE field ${field} must be a finite number.`,
    );
  }
  return value;
}

function requiredString(value: unknown, field: string) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new DataContractError(
      "TXLINE_SCHEMA_MISMATCH",
      `TxLINE field ${field} must be a non-empty string.`,
    );
  }
  return value.trim();
}

function primitiveString(value: unknown) {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}

function serialisedValue(value: unknown) {
  const primitive = primitiveString(value);
  if (primitive !== null) return primitive;
  if (value === null || value === undefined) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function canonical(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function normaliseFixtures(payload: unknown): Fixture[] {
  if (!Array.isArray(payload)) {
    throw new DataContractError(
      "TXLINE_SCHEMA_MISMATCH",
      "TxLINE fixtures snapshot must be an array.",
    );
  }

  return payload
    .map((value, index) => normaliseFixture(value, index))
    .sort((left, right) => left.startTime - right.startTime);
}

function normaliseFixture(value: unknown, index: number): Fixture {
  if (!isRecord(value)) {
    throw new DataContractError(
      "TXLINE_SCHEMA_MISMATCH",
      `TxLINE fixture at index ${index} must be an object.`,
    );
  }
  const record = value as unknown as TxlineFixtureRecord;
  const participant1 = {
    id: integer(record.Participant1Id, "Participant1Id", 1),
    name: requiredString(record.Participant1, "Participant1"),
  };
  const participant2 = {
    id: integer(record.Participant2Id, "Participant2Id", 1),
    name: requiredString(record.Participant2, "Participant2"),
  };
  if (typeof record.Participant1IsHome !== "boolean") {
    throw new DataContractError(
      "TXLINE_SCHEMA_MISMATCH",
      "TxLINE field Participant1IsHome must be a boolean.",
    );
  }

  return {
    fixtureId: integer(record.FixtureId, "FixtureId", 1),
    fixtureGroupId: optionalInteger(record.FixtureGroupId),
    competitionId: integer(record.CompetitionId, "CompetitionId", 1),
    competition: requiredString(record.Competition, "Competition"),
    startTime: finiteNumber(record.StartTime, "StartTime"),
    updatedAt: finiteNumber(record.Ts, "Ts"),
    participant1IsHome: record.Participant1IsHome,
    participant1,
    participant2,
    home: record.Participant1IsHome ? participant1 : participant2,
    away: record.Participant1IsHome ? participant2 : participant1,
  };
}

const HOME_ALIASES = new Set([
  "1",
  "home",
  "homewin",
]);
const DRAW_ALIASES = new Set(["x", "draw", "tie"]);
const AWAY_ALIASES = new Set([
  "2",
  "away",
  "awaywin",
]);

function labelOutcome(label: string, fixture?: Fixture): MatchOutcome | null {
  const value = canonical(label);
  if (HOME_ALIASES.has(value)) return "HOME";
  if (DRAW_ALIASES.has(value)) return "DRAW";
  if (AWAY_ALIASES.has(value)) return "AWAY";
  if (fixture) {
    if (value === "participant1" || value === "team1") {
      return fixture.participant1IsHome ? "HOME" : "AWAY";
    }
    if (value === "participant2" || value === "team2") {
      return fixture.participant1IsHome ? "AWAY" : "HOME";
    }
    if (value === canonical(fixture.home.name)) return "HOME";
    if (value === canonical(fixture.away.name)) return "AWAY";
  }
  return null;
}

function probability(value: unknown) {
  if (typeof value !== "string" || !/^\d{1,3}(?:\.\d{1,3})?$/.test(value)) {
    return null;
  }
  const percentage = Number(value);
  if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) {
    return null;
  }
  return percentage / 100;
}

function isFullMatchMarket(superOddsType: string, marketPeriod: string | null) {
  const type = canonical(superOddsType);
  const period = canonical(marketPeriod ?? "");
  if (
    /(firsthalf|secondhalf|halftime|quarter|period[1-9]|[12]h)/.test(
      `${type}${period}`,
    )
  ) {
    return false;
  }
  return /(1x2|matchwinner|matchresult|fulltimeresult|threeway|threewaymoneyline)/.test(type);
}

function tryNormaliseOddsRecord(
  value: unknown,
  expectedFixtureId?: number,
  fixture?: Fixture,
): MatchWinnerOdds | null {
  if (!isRecord(value)) return null;
  const record = value as unknown as TxlineOddsRecord;
  if (!Number.isSafeInteger(record.FixtureId) || (record.FixtureId as number) < 1) {
    return null;
  }
  if (
    expectedFixtureId !== undefined &&
    record.FixtureId !== expectedFixtureId
  ) {
    return null;
  }
  if (
    typeof record.SuperOddsType !== "string" ||
    !Array.isArray(record.PriceNames) ||
    record.PriceNames.length !== 3 ||
    !record.PriceNames.every((name) => typeof name === "string") ||
    !Array.isArray(record.Pct) ||
    record.Pct.length !== 3
  ) {
    return null;
  }

  const names = record.PriceNames as [string, string, string];
  const outcomes = names.map((name) => labelOutcome(name, fixture));
  if (
    outcomes.some((outcome) => outcome === null) ||
    new Set(outcomes).size !== 3
  ) {
    return null;
  }

  const marketPeriod = primitiveString(record.MarketPeriod);
  if (!isFullMatchMarket(record.SuperOddsType, marketPeriod)) {
    return null;
  }
  if (
    /(firsthalf|secondhalf|halftime|quarter|period[1-9]|[12]h)/.test(
      canonical(marketPeriod ?? ""),
    )
  ) {
    return null;
  }

  const rawPct = {} as Record<MatchOutcome, string>;
  const probabilities = {} as Record<MatchOutcome, number>;
  for (let index = 0; index < outcomes.length; index += 1) {
    const outcome = outcomes[index] as MatchOutcome;
    const raw = record.Pct[index];
    const parsed = probability(raw);
    if (parsed === null) return null;
    rawPct[outcome] = raw as string;
    probabilities[outcome] = parsed;
  }

  if (
    typeof record.InRunning !== "boolean" ||
    typeof record.Ts !== "number" ||
    !Number.isFinite(record.Ts)
  ) {
    return null;
  }

  return {
    fixtureId: record.FixtureId as number,
    messageId: primitiveString(record.MessageId),
    ts: record.Ts,
    inRunning: record.InRunning,
    gameState: primitiveString(record.GameState),
    source: {
      bookmaker:
        typeof record.Bookmaker === "string" && record.Bookmaker.trim()
          ? record.Bookmaker.trim()
          : null,
      bookmakerId: optionalInteger(record.BookmakerId),
    },
    market: {
      superOddsType: record.SuperOddsType,
      period: marketPeriod,
      parameters: serialisedValue(record.MarketParameters),
      priceNames: names,
    },
    rawPct,
    probabilities,
  };
}

export function normaliseMatchWinnerOdds(
  payload: unknown,
  options: { expectedFixtureId?: number; fixture?: Fixture } = {},
) {
  const records = Array.isArray(payload) ? payload : [payload];
  const candidates = records
    .map((record) =>
      tryNormaliseOddsRecord(
        record,
        options.expectedFixtureId,
        options.fixture,
      ),
    )
    .filter((record): record is MatchWinnerOdds => record !== null)
    .sort((left, right) => right.ts - left.ts);

  if (!candidates[0]) {
    throw new DataContractError(
      "MATCH_WINNER_UNAVAILABLE",
      "TxLINE did not return an unambiguous full-match three-way winner market with numeric Pct values.",
    );
  }
  return candidates[0];
}

function optionalScoreInteger(value: unknown) {
  if (typeof value === "string" && /^\d+$/.test(value)) value = Number(value);
  return Number.isSafeInteger(value) && (value as number) >= 0
    ? (value as number)
    : null;
}

function pairFromObject(
  value: unknown,
  participant1IsHome: boolean | null,
): { home: number | null; away: number | null } {
  if (Array.isArray(value) && value.length >= 2) {
    const participant1 = optionalScoreInteger(value[0]);
    const participant2 = optionalScoreInteger(value[1]);
    return participant1IsHome === false
      ? { home: participant2, away: participant1 }
      : { home: participant1, away: participant2 };
  }
  if (!isRecord(value)) return { home: null, away: null };

  const directHome = optionalScoreInteger(value.Home ?? value.home);
  const directAway = optionalScoreInteger(value.Away ?? value.away);
  if (directHome !== null || directAway !== null) {
    return { home: directHome, away: directAway };
  }

  const participant1 = optionalScoreInteger(
    value.Participant1 ?? value.participant1 ?? value.Team1 ?? value.team1 ?? value["1"],
  );
  const participant2 = optionalScoreInteger(
    value.Participant2 ?? value.participant2 ?? value.Team2 ?? value.team2 ?? value["2"],
  );
  return participant1IsHome === false
    ? { home: participant2, away: participant1 }
    : { home: participant1, away: participant2 };
}

function soccerTotals(value: unknown) {
  if (!isRecord(value)) return null;
  const stats = value.Stats;
  if (!isRecord(stats)) return null;
  const total = stats.Total;
  return isRecord(total) ? total : null;
}

function scoreSoccerTotals(
  value: unknown,
  participant1IsHome: boolean | null,
) {
  if (!isRecord(value)) return null;
  const participant1 = value.Participant1;
  const participant2 = value.Participant2;
  if (!isRecord(participant1) || !isRecord(participant2)) return null;
  const participant1Total = participant1.Total;
  const participant2Total = participant2.Total;
  if (!isRecord(participant1Total) || !isRecord(participant2Total)) return null;

  const participantPair = (field: "Goals" | "RedCards") => {
    const first = optionalScoreInteger(participant1Total[field]);
    const second = optionalScoreInteger(participant2Total[field]);
    return participant1IsHome === false
      ? { home: second, away: first }
      : { home: first, away: second };
  };

  return {
    score: participantPair("Goals"),
    redCards: participantPair("RedCards"),
  };
}

function confirmationFromAction(action: string | null) {
  if (!action) return null;
  const value = canonical(action);
  if (value.includes("pending") || value.includes("unconfirmed")) return false;
  if (
    value.includes("confirmed") ||
    value === "gamefinalised"
  ) {
    return true;
  }
  return null;
}

function confirmationFromEventData(value: unknown) {
  if (!isRecord(value)) return null;
  const nestedData = isRecord(value.Data) ? value.Data : null;
  const candidates = [
    value.Confirmed,
    value.IsConfirmed,
    value.confirmed,
    value.isConfirmed,
    nestedData?.Confirmed,
    nestedData?.IsConfirmed,
    nestedData?.confirmed,
    nestedData?.isConfirmed,
  ];
  const explicit = candidates.find((candidate) => typeof candidate === "boolean");
  return typeof explicit === "boolean" ? explicit : null;
}

export function normaliseScoreRecord(
  value: unknown,
  expectedFixtureId?: number,
): ScoreSnapshot {
  if (!isRecord(value)) {
    throw new DataContractError(
      "TXLINE_SCHEMA_MISMATCH",
      "TxLINE score record must be an object.",
    );
  }
  const record = value as unknown as TxlineScoreRecord;
  const fixtureId = integer(record.fixtureId, "fixtureId", 1);
  if (expectedFixtureId !== undefined && fixtureId !== expectedFixtureId) {
    throw new DataContractError(
      "FIXTURE_MISMATCH",
      "TxLINE score record did not match the requested fixture.",
    );
  }
  // Sequence zero is never manufactured or accepted: proof requests must use
  // a sequence observed on an actual score record.
  const seq = integer(record.seq, "seq", 1);
  const ts = finiteNumber(record.ts, "ts");
  const participant1IsHome =
    typeof record.participant1IsHome === "boolean"
      ? record.participant1IsHome
      : null;
  const cumulative = scoreSoccerTotals(
    record.scoreSoccer,
    participant1IsHome,
  );
  const totals = soccerTotals(record.dataSoccer);
  const score =
    cumulative?.score ?? pairFromObject(totals?.Goals, participant1IsHome);
  const redCards =
    cumulative?.redCards ??
    pairFromObject(totals?.RedCards, participant1IsHome);
  const id =
    typeof record.id === "string" || typeof record.id === "number"
      ? record.id
      : null;
  const connectionId =
    typeof record.connectionId === "string" && record.connectionId
      ? record.connectionId
      : typeof record.connectionId === "number" &&
          Number.isFinite(record.connectionId)
        ? String(record.connectionId)
        : null;
  const action = primitiveString(record.action);
  const explicitConfirmation = confirmationFromEventData(record.dataSoccer);
  const statusId = optionalInteger(record.statusId);
  const dedupeKey = JSON.stringify([
    fixtureId,
    connectionId,
    seq,
    id,
  ]);

  return {
    fixtureId,
    seq,
    id,
    ts,
    connectionId,
    dedupeKey,
    action,
    confirmed: explicitConfirmation ?? confirmationFromAction(action),
    finalised: canonical(action ?? "") === "gamefinalised" || statusId === 100,
    statusId,
    gameState: primitiveString(record.gameState),
    score,
    redCards,
    participant1IsHome,
    coverage: {
      secondaryData:
        typeof record.coverageSecondaryData === "boolean"
          ? record.coverageSecondaryData
          : null,
      type: primitiveString(record.coverageType),
    },
  };
}

export function normaliseScoreSnapshot(
  payload: unknown,
  expectedFixtureId?: number,
) {
  const records = Array.isArray(payload) ? payload : [payload];
  const accepted: ScoreSnapshot[] = [];
  let lastError: DataContractError | null = null;

  for (const record of records) {
    try {
      accepted.push(normaliseScoreRecord(record, expectedFixtureId));
    } catch (error) {
      if (error instanceof DataContractError) lastError = error;
      else throw error;
    }
  }
  accepted.sort((left, right) => right.ts - left.ts || right.seq - left.seq);
  if (!accepted[0]) {
    throw (
      lastError ??
      new DataContractError(
        "SCORE_UNAVAILABLE",
        "TxLINE did not return a score record for the requested fixture.",
      )
    );
  }
  return accepted[0];
}
