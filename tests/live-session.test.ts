import assert from "node:assert/strict";
import test from "node:test";
import {
  createDeterministicPaperFillEvent,
  createLiveEngineState,
  defaultLivePolicy,
  reduceLiveEngineEvent,
  selectLivePaperRisk,
  type LiveAuditEntry,
  type LiveEngineState,
  type LiveExecutionCommand,
  type LivePaperOrder,
} from "../app/live-engine.ts";
import {
  PAPER_SESSION_MAX_BYTES,
  PAPER_SESSION_SCHEMA,
  PAPER_SESSION_STORAGE_KEY,
  clearPaperSession,
  compactLiveEngineState,
  decodePaperSession,
  readPaperSession,
  serialisePaperSession,
  writePaperSession,
  type PaperSessionDraft,
  type StorageLike,
} from "../app/live-session.ts";

const fixtureId = "18241006";

class MemoryStorage implements StorageLike {
  readonly values = new Map<string, string>();
  failRead = false;
  failRemove = false;
  mutateThenFailNextSet = false;

  getItem(key: string) {
    if (this.failRead) throw new Error("read disabled");
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
    if (this.mutateThenFailNextSet) {
      this.mutateThenFailNextSet = false;
      throw new Error("quota exceeded");
    }
  }

  removeItem(key: string) {
    if (this.failRemove) throw new Error("remove disabled");
    this.values.delete(key);
  }
}

function quotingState() {
  let state = createLiveEngineState({ fixtureId });
  state = reduceLiveEngineEvent(state, {
    kind: "SCORE",
    fixtureId,
    seq: 1,
    scoreTsMs: 1,
    score: { home: 0, away: 0 },
    redCards: { home: 0, away: 0 },
    confirmed: true,
    atMs: 1,
    clock: "00:01",
  });
  return reduceLiveEngineEvent(state, {
    kind: "ODDS",
    fixtureId,
    messageId: "stable-1",
    sseId: "100:1",
    priceTsMs: 100,
    pct: { HOME: 0.45, DRAW: 0.3, AWAY: 0.25 },
    inRunning: true,
    gameState: "in_running",
    atMs: 100,
    clock: "00:02",
  });
}

function draft(
  engine: LiveEngineState = quotingState(),
  overrides: Partial<PaperSessionDraft> = {},
): PaperSessionDraft {
  return {
    sessionId: "session-2026-world-cup",
    writerId: "tab-a",
    savedAtMs: 1_720_000_000_000,
    network: "devnet",
    fixture: {
      fixtureId: Number(fixtureId),
      competition: "World Cup",
      startTime: 1_720_000_000_000,
      home: { id: 10, name: "Aurora" },
      away: { id: 20, name: "Pacifica" },
    },
    engine,
    ...overrides,
  };
}

interface StoredSessionShape extends Record<string, unknown> {
  engine: Record<string, unknown> & {
    policy: Record<string, unknown>;
    paperOrders: Array<Record<string, unknown>>;
    executionCommands: Array<Record<string, unknown>>;
  };
}

function storedObject(storage: MemoryStorage) {
  return JSON.parse(storage.getItem(PAPER_SESSION_STORAGE_KEY)!) as StoredSessionShape;
}

test("round-trips a live paper session with its audit and execution commands", () => {
  const storage = new MemoryStorage();
  const written = writePaperSession(storage, draft(), { expectedRevision: 0 });
  assert.equal(written.status, "saved");
  if (written.status !== "saved") return;
  assert.equal(written.session.revision, 1);
  assert.equal(written.session.integrity, "device-local-unsigned");

  const read = readPaperSession(storage, "devnet");
  assert.equal(read.status, "ready");
  if (read.status !== "ready") return;
  assert.equal(read.session.engine.fixtureId, fixtureId);
  assert.equal(read.session.engine.status, "QUOTING");
  assert.equal(read.session.engine.paperOrders.length, 6);
  assert.equal(read.session.engine.executionCommands.length, 1);
  assert.ok(read.session.engine.audit.length > 0);
  assert.deepEqual(read.session.engine.policy, {
    ...defaultLivePolicy,
    requiredTransportChannels: [...defaultLivePolicy.requiredTransportChannels],
  });
  assert.doesNotThrow(() => JSON.parse(serialisePaperSession(read.session)));
});

test("round-trips paper fills, risk ledger and the latched emergency stop", () => {
  const storage = new MemoryStorage();
  let engine = quotingState();
  engine = reduceLiveEngineEvent(
    engine,
    createDeterministicPaperFillEvent(engine, {
      fillId: "persisted-fill-1",
      atMs: 200,
      clock: "00:03",
      outcome: "HOME",
      side: "BID",
      fraction: 0.5,
    }),
  );
  engine = reduceLiveEngineEvent(engine, {
    kind: "EMERGENCY_STOP",
    fixtureId,
    stopId: "persisted-stop-1",
    reason: "Persist risk evidence",
    atMs: 300,
    clock: "00:04",
  });

  assert.equal(writePaperSession(storage, draft(engine)).status, "saved");
  const read = readPaperSession(storage, "devnet");
  assert.equal(read.status, "ready");
  if (read.status !== "ready") return;
  assert.equal(read.session.engine.paperFills.length, 1);
  assert.equal(read.session.engine.paperCash, -54.75);
  assert.deepEqual(read.session.engine.paperInventory, {
    HOME: 125,
    DRAW: 0,
    AWAY: 0,
  });
  assert.equal(selectLivePaperRisk(read.session.engine).liability, 54.75);
  assert.equal(read.session.engine.emergencyStop?.stopId, "persisted-stop-1");
  assert.ok(read.session.engine.suspensionCauses.includes("EMERGENCY_STOP"));
});

test("loads a pre-risk-ledger v1 session with safe zero-value defaults", () => {
  const storage = new MemoryStorage();
  assert.equal(writePaperSession(storage, draft()).status, "saved");
  const stored = storedObject(storage);
  delete stored.engine.policy.maximumLiability;
  delete stored.engine.paperFills;
  delete stored.engine.paperCash;
  delete stored.engine.paperInventory;
  delete stored.engine.paperFilledNotional;
  delete stored.engine.paperFillRejects;
  delete stored.engine.settledOutcome;
  delete stored.engine.settledPnl;
  delete stored.engine.emergencyStop;
  delete stored.engine.seenPaperFillIds;
  const retention = stored.retention as Record<string, unknown>;
  delete retention.fillsDropped;

  const decoded = decodePaperSession(JSON.stringify(stored));
  assert.equal(decoded.status, "ready");
  if (decoded.status !== "ready") return;
  assert.equal(decoded.session.engine.policy.maximumLiability, 1_000);
  assert.deepEqual(decoded.session.engine.paperFills, []);
  assert.deepEqual(decoded.session.engine.paperInventory, {
    HOME: 0,
    DRAW: 0,
    AWAY: 0,
  });
  assert.equal(decoded.session.retention.fillsDropped, 0);
});

test("accepts legacy TXLINE audit actors while new sessions use source-neutral FEED actors", () => {
  const storage = new MemoryStorage();
  assert.equal(writePaperSession(storage, draft()).status, "saved");
  const current = storedObject(storage);
  assert.ok((current.engine.audit as Array<{ source?: unknown }>).some((entry) => entry.source === "FEED"));
  for (const entry of current.engine.audit as Array<{ source?: unknown }>) {
    if (entry.source === "FEED") entry.source = "TXLINE";
  }
  assert.equal(decodePaperSession(JSON.stringify(current)).status, "ready");
});

test("returns a network mismatch without activating or deleting the stored session", () => {
  const storage = new MemoryStorage();
  assert.equal(writePaperSession(storage, draft()).status, "saved");
  const before = storage.getItem(PAPER_SESSION_STORAGE_KEY);
  const read = readPaperSession(storage, "mainnet");
  assert.equal(read.status, "network-mismatch");
  if (read.status === "network-mismatch") {
    assert.equal(read.session.scope.network, "devnet");
  }
  assert.equal(storage.getItem(PAPER_SESSION_STORAGE_KEY), before);
});

test("rejects malformed JSON and preserves unsupported future versions", () => {
  assert.equal(decodePaperSession("not json").status, "invalid");
  const future = decodePaperSession(
    JSON.stringify({ schema: PAPER_SESSION_SCHEMA, version: 99 }),
  );
  assert.equal(future.status, "incompatible");
  if (future.status === "incompatible") assert.equal(future.foundVersion, 99);
});

test("enforces the UTF-8 storage limit before parsing", () => {
  const raw = `{"padding":"${"x".repeat(PAPER_SESSION_MAX_BYTES)}"}`;
  const decoded = decodePaperSession(raw);
  assert.equal(decoded.status, "too-large");
  if (decoded.status === "too-large") {
    assert.ok(decoded.bytes > PAPER_SESSION_MAX_BYTES);
  }
});

test("preserves the validated policy that governed the historical session", () => {
  const storage = new MemoryStorage();
  const historicalPolicy = {
    transportTimeoutMs: 45_000,
    shockDelta: 0.08,
    baseHalfSpread: 0.02,
    priceTick: 0.001,
  };
  const engine = createLiveEngineState({ fixtureId, policy: historicalPolicy });
  assert.equal(writePaperSession(storage, draft(engine)).status, "saved");

  const read = readPaperSession(storage, "devnet");
  assert.equal(read.status, "ready");
  if (read.status !== "ready") return;
  assert.equal(
    read.session.engine.policy.transportTimeoutMs,
    historicalPolicy.transportTimeoutMs,
  );
  assert.equal(read.session.engine.policy.shockDelta, historicalPolicy.shockDelta);
  assert.equal(
    read.session.engine.policy.baseHalfSpread,
    historicalPolicy.baseHalfSpread,
  );
  assert.equal(read.session.engine.policy.priceTick, historicalPolicy.priceTick);
});

test("rejects a stored policy that cannot safely describe an engine", () => {
  const storage = new MemoryStorage();
  assert.equal(writePaperSession(storage, draft()).status, "saved");
  const stored = storedObject(storage);
  stored.engine.policy.priceTick = 0;

  const decoded = decodePaperSession(JSON.stringify(stored));
  assert.equal(decoded.status, "invalid");
  if (decoded.status === "invalid") {
    assert.match(decoded.message, /priceTick must be greater than zero/);
  }
});

test("strips unknown fields so credentials cannot become session properties", () => {
  const storage = new MemoryStorage();
  const unsafe = draft() as PaperSessionDraft & {
    apiToken: string;
    walletPath: string;
  };
  unsafe.apiToken = "activated-api-token";
  unsafe.walletPath = "/secret/wallet.json";
  (unsafe.engine as LiveEngineState & { guestJwt: string }).guestJwt = "guest-secret";

  const written = writePaperSession(storage, unsafe);
  assert.equal(written.status, "saved");
  const raw = storage.getItem(PAPER_SESSION_STORAGE_KEY)!;
  assert.equal(raw.includes("activated-api-token"), false);
  assert.equal(raw.includes("/secret/wallet.json"), false);
  assert.equal(raw.includes("guest-secret"), false);
  assert.equal("apiToken" in storedObject(storage), false);
  assert.equal("guestJwt" in storedObject(storage).engine, false);
});

test("rejects dangling command references and cross-fixture orders", () => {
  const storage = new MemoryStorage();
  assert.equal(writePaperSession(storage, draft()).status, "saved");
  const dangling = storedObject(storage);
  dangling.engine.paperOrders.pop();
  assert.equal(decodePaperSession(JSON.stringify(dangling)).status, "invalid");

  const crossFixture = storedObject(storage);
  crossFixture.engine.paperOrders[0].fixtureId = "999";
  assert.equal(decodePaperSession(JSON.stringify(crossFixture)).status, "invalid");
});

test("compacts deterministically while preserving retained command references", () => {
  const base = quotingState();
  const paperOrders: LivePaperOrder[] = [];
  const commands: LiveExecutionCommand[] = [];
  for (let epoch = 1; epoch <= 220; epoch += 1) {
    const id = `${fixtureId}:${epoch}:HOME:BID`;
    paperOrders.push({
      id,
      fixtureId,
      epoch,
      outcome: "HOME",
      side: "BID",
      price: 0.4,
      quantity: 10,
      state: "CANCELLED",
      createdAtMs: epoch,
      cancelledAtMs: epoch + 1,
    });
    commands.push({
      id: `${fixtureId}:cancel:${epoch}`,
      kind: "CANCEL_ALL",
      atMs: epoch + 1,
      orderIds: [id],
    });
  }
  const audits: LiveAuditEntry[] = Array.from({ length: 300 }, (_, index) => ({
    id: `audit-${300 - index}`,
    atMs: 300 - index,
    clock: `${300 - index}ms`,
    source: "AGENT",
    tone: "neutral",
    title: `Audit ${300 - index}`,
    detail: "Bounded deterministic evidence",
  }));
  const engine: LiveEngineState = {
    ...base,
    status: "STALE",
    reason: "Compaction fixture",
    quoteEpoch: 220,
    paperOrders,
    cancelledOrders: 220,
    executionCommands: commands,
    audit: audits,
    seenOddsMessageIds: Array.from({ length: 600 }, (_, index) => `message-${index}`),
    seenOddsSseIds: Array.from({ length: 600 }, (_, index) => `sse-${index}`),
    seenScoreKeys: Array.from({ length: 600 }, (_, index) => `score-${index}`),
    seenMaterialSignalIds: Array.from({ length: 600 }, (_, index) => `signal-${index}`),
  };

  const first = compactLiveEngineState(engine);
  const second = compactLiveEngineState(engine);
  assert.deepEqual(first, second);
  assert.equal(first.engine.executionCommands.length, 200);
  assert.equal(first.engine.paperOrders.length, 200);
  assert.equal(first.engine.audit.length, 250);
  assert.equal(first.engine.seenOddsMessageIds.length, 500);
  assert.equal(first.retention.commandsDropped, 20);
  assert.equal(first.retention.ordersDropped, 20);
  assert.equal(first.retention.auditDropped, 50);
  assert.equal(first.retention.seenIdentitiesDropped, 400);
  const retainedOrders = new Set(first.engine.paperOrders.map((order) => order.id));
  assert.ok(
    first.engine.executionCommands.every((command) =>
      command.orderIds.every((orderId) => retainedOrders.has(orderId)),
    ),
  );

  const storage = new MemoryStorage();
  const firstWrite = writePaperSession(storage, draft(engine));
  assert.equal(firstWrite.status, "saved");
  const firstRead = readPaperSession(storage, "devnet");
  assert.equal(firstRead.status, "ready");
  if (firstRead.status !== "ready") return;

  const secondWrite = writePaperSession(
    storage,
    draft(firstRead.session.engine, {
      savedAtMs: firstRead.session.savedAtMs + 1,
      priorRetention: firstRead.session.retention,
    }),
    { expectedRevision: firstRead.session.revision },
  );
  assert.equal(secondWrite.status, "saved");
  if (secondWrite.status !== "saved") return;
  assert.deepEqual(secondWrite.session.retention, firstRead.session.retention);
});

test("preserves the last good value when a storage write mutates then fails", () => {
  const storage = new MemoryStorage();
  const first = writePaperSession(storage, draft(), { expectedRevision: 0 });
  assert.equal(first.status, "saved");
  const previous = storage.getItem(PAPER_SESSION_STORAGE_KEY);

  storage.mutateThenFailNextSet = true;
  const failed = writePaperSession(
    storage,
    draft(quotingState(), { writerId: "tab-b", savedAtMs: 1_720_000_001_000 }),
    { expectedRevision: 1 },
  );
  assert.equal(failed.status, "unavailable");
  assert.equal(storage.getItem(PAPER_SESSION_STORAGE_KEY), previous);
});

test("detects stale revision writes and preserves a different stored session", () => {
  const storage = new MemoryStorage();
  assert.equal(writePaperSession(storage, draft(), { expectedRevision: 0 }).status, "saved");
  const previous = storage.getItem(PAPER_SESSION_STORAGE_KEY);
  assert.equal(
    writePaperSession(storage, draft(), { expectedRevision: 0 }).status,
    "conflict",
  );
  assert.equal(
    writePaperSession(storage, draft(undefined, { sessionId: "other-session" })).status,
    "conflict",
  );
  assert.equal(storage.getItem(PAPER_SESSION_STORAGE_KEY), previous);
});

test("does not overwrite a different network or fixture without explicit replacement", () => {
  const storage = new MemoryStorage();
  assert.equal(writePaperSession(storage, draft()).status, "saved");
  const previous = storage.getItem(PAPER_SESSION_STORAGE_KEY);

  assert.equal(
    writePaperSession(storage, draft(undefined, { network: "mainnet" })).status,
    "conflict",
  );
  assert.equal(
    writePaperSession(
      storage,
      draft(undefined, {
        fixture: {
          ...draft().fixture,
          fixtureId: 999,
        },
      }),
    ).status,
    "conflict",
  );
  assert.equal(storage.getItem(PAPER_SESSION_STORAGE_KEY), previous);
});

test("reports storage failures without throwing into the paper engine", () => {
  const storage = new MemoryStorage();
  storage.failRead = true;
  assert.equal(readPaperSession(storage).status, "unavailable");
  assert.equal(writePaperSession(storage, draft()).status, "unavailable");
  storage.failRead = false;
  storage.failRemove = true;
  assert.equal(clearPaperSession(storage).status, "unavailable");
});

test("clear removes only the ProofSwitch paper-session key", () => {
  const storage = new MemoryStorage();
  storage.setItem("unrelated", "keep");
  assert.equal(writePaperSession(storage, draft()).status, "saved");
  assert.deepEqual(clearPaperSession(storage), { status: "cleared" });
  assert.equal(storage.getItem(PAPER_SESSION_STORAGE_KEY), null);
  assert.equal(storage.getItem("unrelated"), "keep");
});

test("persists the terminal SESSION_END result with no open paper orders", () => {
  const quoting = quotingState();
  const ended = reduceLiveEngineEvent(quoting, {
    kind: "SESSION_END",
    fixtureId,
    reason: "Operator disconnected",
    atMs: 500,
    clock: "00:05",
  });
  assert.equal(ended.status, "CLOSED");
  assert.equal(ended.paperOrders.some((order) => order.state === "OPEN"), false);
  assert.equal(ended.executionCommands.at(-1)?.kind, "CANCEL_ALL");

  const storage = new MemoryStorage();
  assert.equal(writePaperSession(storage, draft(ended)).status, "saved");
  const read = readPaperSession(storage, "devnet");
  assert.equal(read.status, "ready");
  if (read.status === "ready") {
    assert.equal(read.session.engine.status, "CLOSED");
    assert.equal(read.session.engine.paperOrders.some((order) => order.state === "OPEN"), false);
    assert.ok(read.session.engine.suspensionCauses.includes("SESSION_ENDED"));
  }
});
