import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import {
  AccessControlError,
  accessErrorResponse,
  getPublicAccessStatus,
  issueAccessSession,
  resetAccessControlForTests,
  withLiveAccess,
} from "../server/access-control.ts";
import { publicAppStatus, readServerConfig } from "../server/config.ts";

const ACCESS_CODE = "judge-access-code";
const SIGNING_SECRET = "independent-cookie-signing-secret-0001";

function liveConfig(overrides: Record<string, string | undefined> = {}) {
  return readServerConfig({
    PROOFSWITCH_MODE: "live",
    TXLINE_NETWORK: "devnet",
    TXLINE_API_TOKEN: "activated-api-token",
    PROOFSWITCH_ACCESS_CODE: ACCESS_CODE,
    PROOFSWITCH_ACCESS_SIGNING_SECRET: SIGNING_SECRET,
    ...overrides,
  });
}

function accessRequest(
  code = ACCESS_CODE,
  origin = "http://localhost:3000",
  url = "http://localhost:3000/api/access",
) {
  return new Request(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      "Sec-Fetch-Site": "same-origin",
    },
    body: JSON.stringify({ code }),
  });
}

async function signedCookie(config = liveConfig()) {
  const result = await issueAccessSession(accessRequest(), config);
  assert.ok(result.cookie);
  return result.cookie.split(";", 1)[0];
}

function authorisedRequest(cookie: string, path = "/api/fixtures") {
  return new Request(`http://localhost:3000${path}`, {
    headers: { Cookie: cookie },
  });
}

beforeEach(() => {
  resetAccessControlForTests();
});

test("synthetic routes remain credential-free", async () => {
  const config = readServerConfig({ PROOFSWITCH_MODE: "synthetic" });
  const response = await withLiveAccess(
    new Request("http://localhost:3000/api/fixtures"),
    config,
    "request",
    async () => Response.json({ ok: true }),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
});

test("live access configuration is all-or-nothing and never exposed by status", () => {
  assert.throws(
    () =>
      readServerConfig({
        PROOFSWITCH_MODE: "live",
        PROOFSWITCH_ACCESS_CODE: ACCESS_CODE,
      }),
    /must be configured together/,
  );

  const locked = readServerConfig({
    PROOFSWITCH_MODE: "live",
    TXLINE_API_TOKEN: "activated-api-token",
  });
  const lockedStatus = publicAppStatus(locked);
  assert.equal(lockedStatus.liveReady, false);
  assert.equal(lockedStatus.capabilities.fixtures, false);

  const config = liveConfig();
  const serialisedStatus = JSON.stringify(publicAppStatus(config));
  assert.equal(publicAppStatus(config).liveReady, true);
  assert.equal(publicAppStatus(config).capabilities.streaming, true);
  assert.equal(serialisedStatus.includes(ACCESS_CODE), false);
  assert.equal(serialisedStatus.includes(SIGNING_SECRET), false);
});

test("live routes fail closed when access is unconfigured or unauthenticated", async () => {
  const missingToken = readServerConfig({ PROOFSWITCH_MODE: "live" });
  await assert.rejects(
    () =>
      withLiveAccess(
        new Request("http://localhost:3000/api/fixtures"),
        missingToken,
        "request",
        async () => new Response("should not run"),
      ),
    (error: unknown) =>
      error instanceof AccessControlError &&
      error.code === "LIVE_NOT_CONFIGURED" &&
      error.status === 503,
  );

  const unconfigured = readServerConfig({
    PROOFSWITCH_MODE: "live",
    TXLINE_API_TOKEN: "activated-api-token",
  });
  await assert.rejects(
    () =>
      withLiveAccess(
        new Request("http://localhost:3000/api/fixtures"),
        unconfigured,
        "request",
        async () => new Response("should not run"),
      ),
    (error: unknown) =>
      error instanceof AccessControlError &&
      error.code === "ACCESS_NOT_CONFIGURED" &&
      error.status === 503,
  );

  await assert.rejects(
    () =>
      withLiveAccess(
        new Request("http://localhost:3000/api/fixtures"),
        liveConfig(),
        "request",
        async () => new Response("should not run"),
      ),
    (error: unknown) =>
      error instanceof AccessControlError &&
      error.code === "ACCESS_REQUIRED" &&
      error.status === 401,
  );
});

test("same-origin code exchange issues a signed HttpOnly strict cookie", async () => {
  const config = liveConfig();
  const issued = await issueAccessSession(accessRequest(), config);
  assert.ok(issued.cookie);
  assert.match(issued.cookie, /HttpOnly/);
  assert.match(issued.cookie, /SameSite=Strict/);
  assert.match(issued.cookie, /Max-Age=3600/);
  assert.doesNotMatch(issued.cookie, /; Secure/);
  assert.equal(issued.cookie.includes(ACCESS_CODE), false);
  assert.equal(issued.cookie.includes(SIGNING_SECRET), false);
  assert.equal(issued.status.authenticated, true);
  assert.ok(issued.status.expiresAt);

  const cookie = issued.cookie.split(";", 1)[0];
  const authenticated = await getPublicAccessStatus(
    authorisedRequest(cookie, "/api/access"),
    config,
  );
  assert.deepEqual(authenticated, issued.status);

  const secureIssued = await issueAccessSession(
    accessRequest(
      ACCESS_CODE,
      "https://proofswitch.example",
      "https://proofswitch.example/api/access",
    ),
    config,
  );
  assert.match(secureIssued.cookie ?? "", /; Secure/);
});

test("cross-origin, incorrect and tampered access attempts are rejected", async () => {
  const config = liveConfig();
  await assert.rejects(
    () => issueAccessSession(accessRequest(ACCESS_CODE, "https://attacker.example"), config),
    (error: unknown) =>
      error instanceof AccessControlError &&
      error.code === "ACCESS_ORIGIN_REJECTED" &&
      error.status === 403,
  );
  await assert.rejects(
    () => issueAccessSession(accessRequest("incorrect-code"), config),
    (error: unknown) =>
      error instanceof AccessControlError &&
      error.code === "ACCESS_DENIED" &&
      error.status === 401 &&
      !error.message.includes(ACCESS_CODE),
  );

  resetAccessControlForTests();
  const cookie = await signedCookie(config);
  const tamperIndex = cookie.length - 10;
  const replacement = cookie[tamperIndex] === "A" ? "B" : "A";
  const tampered = `${cookie.slice(0, tamperIndex)}${replacement}${cookie.slice(tamperIndex + 1)}`;
  const status = await getPublicAccessStatus(
    authorisedRequest(tampered, "/api/access"),
    config,
  );
  assert.equal(status.authenticated, false);
  assert.equal(status.expiresAt, null);
});

test("access attempts are bounded per isolate", async () => {
  const config = liveConfig({
    PROOFSWITCH_ACCESS_ATTEMPTS_PER_MINUTE: "1",
  });
  await assert.rejects(
    () => issueAccessSession(accessRequest("incorrect-code"), config),
    (error: unknown) =>
      error instanceof AccessControlError && error.code === "ACCESS_DENIED",
  );
  await assert.rejects(
    () => issueAccessSession(accessRequest(), config),
    (error: unknown) =>
      error instanceof AccessControlError &&
      error.code === "ACCESS_RATE_LIMITED" &&
      error.status === 429,
  );
});

test("request concurrency is bounded and the lease is released", async () => {
  const config = liveConfig({
    PROOFSWITCH_LIVE_MAX_CONCURRENT_REQUESTS: "1",
  });
  const cookie = await signedCookie(config);
  let announceStart!: () => void;
  let releaseOperation!: () => void;
  const started = new Promise<void>((resolve) => {
    announceStart = resolve;
  });
  const blocker = new Promise<void>((resolve) => {
    releaseOperation = resolve;
  });
  const first = withLiveAccess(
    authorisedRequest(cookie),
    config,
    "request",
    async () => {
      announceStart();
      await blocker;
      return new Response("first");
    },
  );
  await started;

  await assert.rejects(
    () =>
      withLiveAccess(
        authorisedRequest(cookie),
        config,
        "request",
        async () => new Response("second"),
      ),
    (error: unknown) =>
      error instanceof AccessControlError &&
      error.code === "ACCESS_CAPACITY_REACHED",
  );

  releaseOperation();
  assert.equal(await (await first).text(), "first");
  const afterRelease = await withLiveAccess(
    authorisedRequest(cookie),
    config,
    "request",
    async () => new Response("after-release"),
  );
  assert.equal(await afterRelease.text(), "after-release");
});

test("authenticated live requests are rate-limited per isolate", async () => {
  const config = liveConfig({
    PROOFSWITCH_LIVE_REQUESTS_PER_MINUTE: "10",
  });
  const cookie = await signedCookie(config);
  for (let index = 0; index < 10; index += 1) {
    const response = await withLiveAccess(
      authorisedRequest(cookie),
      config,
      "request",
      async () => new Response("ok"),
    );
    assert.equal(response.status, 200);
  }
  await assert.rejects(
    () =>
      withLiveAccess(
        authorisedRequest(cookie),
        config,
        "request",
        async () => new Response("rate limit should prevent this"),
      ),
    (error: unknown) =>
      error instanceof AccessControlError &&
      error.code === "ACCESS_RATE_LIMITED" &&
      error.status === 429,
  );
});

test("SSE concurrency remains held until cancellation and is then released", async () => {
  const config = liveConfig({
    PROOFSWITCH_LIVE_MAX_CONCURRENT_STREAMS: "1",
  });
  const cookie = await signedCookie(config);
  const openStream = () =>
    withLiveAccess(
      authorisedRequest(cookie, "/api/stream?kind=odds&fixtureId=1"),
      config,
      "stream",
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start() {
              // Remain open until the downstream EventSource cancels.
            },
          }),
          { headers: { "Content-Type": "text/event-stream" } },
        ),
    );
  const first = await openStream();
  assert.match(first.headers.get("Vary") ?? "", /Cookie/);

  await assert.rejects(
    openStream,
    (error: unknown) =>
      error instanceof AccessControlError &&
      error.code === "ACCESS_CAPACITY_REACHED",
  );

  await first.body?.cancel();
  const afterCancel = await openStream();
  await afterCancel.body?.cancel();
});

test("SSE concurrency is released after the upstream stream reaches natural EOF", async () => {
  const config = liveConfig({
    PROOFSWITCH_LIVE_MAX_CONCURRENT_STREAMS: "1",
  });
  const cookie = await signedCookie(config);
  const openFiniteStream = () =>
    withLiveAccess(
      authorisedRequest(cookie, "/api/stream?kind=odds&fixtureId=1"),
      config,
      "stream",
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("event: end\n\n"));
              controller.close();
            },
          }),
          { headers: { "Content-Type": "text/event-stream" } },
        ),
    );

  const first = await openFiniteStream();
  assert.equal(await first.text(), "event: end\n\n");

  const afterEof = await openFiniteStream();
  assert.equal(await afterEof.text(), "event: end\n\n");
});

test("SSE duration limit closes the stream and releases its concurrency lease", async () => {
  const baseConfig = liveConfig({
    PROOFSWITCH_LIVE_MAX_CONCURRENT_STREAMS: "1",
  });
  const config = {
    ...baseConfig,
    access: {
      ...baseConfig.access,
      // Production configuration enforces a 30-second minimum. A short,
      // injected value keeps the lease lifecycle test deterministic.
      maxStreamDurationMs: 10,
    },
  };
  const cookie = await signedCookie(config);
  const openStream = () =>
    withLiveAccess(
      authorisedRequest(cookie, "/api/stream?kind=scores&fixtureId=1"),
      config,
      "stream",
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start() {
              // The access wrapper, rather than the source, must end this stream.
            },
          }),
          { headers: { "Content-Type": "text/event-stream" } },
        ),
    );

  const first = await openStream();
  const firstRead = await first.body!.getReader().read();
  assert.equal(firstRead.done, true);

  const afterTimeout = await openStream();
  await afterTimeout.body?.cancel();
});

test("access errors use bounded no-store API responses", async () => {
  const error = new AccessControlError(
    "ACCESS_REQUIRED",
    "Operator access is required for live sponsor data.",
    401,
  );
  const response = accessErrorResponse(error, "live");
  assert.ok(response);
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.match(response.headers.get("Vary") ?? "", /Cookie/);
  assert.match(response.headers.get("WWW-Authenticate") ?? "", /ProofSwitch/);
  const body = (await response.json()) as {
    error: { code: string; message: string };
    mode: string;
  };
  assert.equal(body.error.code, "ACCESS_REQUIRED");
  assert.equal(body.mode, "live");
  assert.equal(JSON.stringify(body).includes(ACCESS_CODE), false);
  assert.equal(JSON.stringify(body).includes(SIGNING_SECRET), false);
});
