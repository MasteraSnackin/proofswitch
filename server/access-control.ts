import type { AppMode } from "../lib/contracts";
import type { ServerConfig } from "./config";

const COOKIE_NAME = "proofswitch_access";
const COOKIE_VERSION = "v1";
const MAX_ACCESS_BODY_BYTES = 1_024;
const RATE_WINDOW_MS = 60_000;
const MAX_RATE_BUCKETS = 512;

type ResourceKind = "request" | "stream";

interface AccessSession {
  authenticated: boolean;
  expiresAt: string | null;
  fingerprint: string | null;
}

export interface PublicAccessStatus {
  required: boolean;
  configured: boolean;
  authenticated: boolean;
  expiresAt: string | null;
}

export class AccessControlError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryAfterSeconds: number | null;

  constructor(
    code: string,
    message: string,
    status: number,
    retryAfterSeconds: number | null = null,
  ) {
    super(message);
    this.name = "AccessControlError";
    this.code = code;
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

class ResourceLease {
  private released = false;
  readonly kind: ResourceKind;
  private readonly onRelease: () => void;

  constructor(kind: ResourceKind, onRelease: () => void) {
    this.kind = kind;
    this.onRelease = onRelease;
  }

  release() {
    if (this.released) return;
    this.released = true;
    this.onRelease();
  }
}

const encoder = new TextEncoder();
let activeRequests = 0;
let activeStreams = 0;
const rateBuckets = new Map<string, number[]>();

function cryptoRuntime() {
  const runtime = globalThis.crypto;
  if (!runtime?.subtle) {
    throw new AccessControlError(
      "ACCESS_RUNTIME_UNAVAILABLE",
      "Secure access sessions are unavailable in this runtime.",
      503,
    );
  }
  return runtime;
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlToBytes(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  try {
    const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/") + padding);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

async function hmac(secret: string, value: string) {
  const runtime = cryptoRuntime();
  const key = await runtime.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(
    await runtime.subtle.sign("HMAC", key, encoder.encode(value)),
  );
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array) {
  let difference = left.length ^ right.length;
  const comparedLength = Math.max(left.length, right.length);
  for (let index = 0; index < comparedLength; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

function accessConfigured(config: ServerConfig) {
  return config.access.code !== null && config.access.signingSecret !== null;
}

function assertAccessConfigured(config: ServerConfig) {
  if (!accessConfigured(config)) {
    throw new AccessControlError(
      "ACCESS_NOT_CONFIGURED",
      "Live sponsor access is disabled until operator access is configured.",
      503,
    );
  }
}

function cookieValue(request: Request) {
  const header = request.headers.get("Cookie");
  if (!header || header.length > 4_096) return null;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === COOKIE_NAME) {
      const value = part.slice(separator + 1).trim();
      return value.length <= 1_024 ? value : null;
    }
  }
  return null;
}

async function readSession(
  request: Request,
  config: ServerConfig,
  nowMs = Date.now(),
): Promise<AccessSession> {
  if (!accessConfigured(config)) {
    return { authenticated: false, expiresAt: null, fingerprint: null };
  }
  const token = cookieValue(request);
  if (!token) {
    return { authenticated: false, expiresAt: null, fingerprint: null };
  }
  const parts = token.split(".");
  if (parts.length !== 2) {
    return { authenticated: false, expiresAt: null, fingerprint: null };
  }
  const [payload, suppliedSignature] = parts;
  const suppliedBytes = base64UrlToBytes(suppliedSignature);
  if (!suppliedBytes || suppliedBytes.length !== 32) {
    return { authenticated: false, expiresAt: null, fingerprint: null };
  }
  const expectedBytes = await hmac(
    config.access.signingSecret!,
    `session:${payload}`,
  );
  if (!constantTimeEqual(suppliedBytes, expectedBytes)) {
    return { authenticated: false, expiresAt: null, fingerprint: null };
  }
  const payloadBytes = base64UrlToBytes(payload);
  if (!payloadBytes) {
    return { authenticated: false, expiresAt: null, fingerprint: null };
  }
  const decoded = new TextDecoder().decode(payloadBytes);
  const [version, expiresRaw, nonce] = decoded.split(":");
  const expiresSeconds = Number(expiresRaw);
  if (
    version !== COOKIE_VERSION ||
    !Number.isSafeInteger(expiresSeconds) ||
    expiresSeconds <= Math.floor(nowMs / 1_000) ||
    !nonce ||
    !/^[A-Za-z0-9_-]{22}$/.test(nonce)
  ) {
    return { authenticated: false, expiresAt: null, fingerprint: null };
  }
  return {
    authenticated: true,
    expiresAt: new Date(expiresSeconds * 1_000).toISOString(),
    fingerprint: suppliedSignature.slice(0, 16),
  };
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("Origin");
  if (!origin) return false;
  let expectedOrigin: string;
  try {
    expectedOrigin = new URL(request.url).origin;
  } catch {
    return false;
  }
  if (origin !== expectedOrigin) return false;
  const fetchSite = request.headers.get("Sec-Fetch-Site");
  return fetchSite === null || fetchSite === "same-origin";
}

function assertSameOrigin(request: Request) {
  if (!sameOrigin(request)) {
    throw new AccessControlError(
      "ACCESS_ORIGIN_REJECTED",
      "The access request must come from this application.",
      403,
    );
  }
}

function clientKey(request: Request) {
  const cloudflareAddress = request.headers.get("CF-Connecting-IP")?.trim();
  return cloudflareAddress && cloudflareAddress.length <= 64
    ? cloudflareAddress
    : "local-or-unknown";
}

function takeRateSlot(key: string, limit: number, nowMs = Date.now()) {
  const cutoff = nowMs - RATE_WINDOW_MS;
  const recent = (rateBuckets.get(key) ?? []).filter((timestamp) => timestamp > cutoff);
  if (recent.length >= limit) {
    rateBuckets.set(key, recent);
    return false;
  }
  recent.push(nowMs);
  if (!rateBuckets.has(key) && rateBuckets.size >= MAX_RATE_BUCKETS) {
    const oldestKey = rateBuckets.keys().next().value as string | undefined;
    if (oldestKey) rateBuckets.delete(oldestKey);
  }
  rateBuckets.set(key, recent);
  return true;
}

function assertRateAvailable(key: string, limit: number) {
  if (!takeRateSlot(key, limit)) {
    throw new AccessControlError(
      "ACCESS_RATE_LIMITED",
      "Too many access requests were received. Try again shortly.",
      429,
      60,
    );
  }
}

function acquireResource(config: ServerConfig, kind: ResourceKind) {
  if (kind === "request") {
    if (activeRequests >= config.access.maxConcurrentRequests) {
      throw new AccessControlError(
        "ACCESS_CAPACITY_REACHED",
        "The live request capacity is temporarily full.",
        503,
        1,
      );
    }
    activeRequests += 1;
    return new ResourceLease(kind, () => {
      activeRequests = Math.max(0, activeRequests - 1);
    });
  }

  if (activeStreams >= config.access.maxConcurrentStreams) {
    throw new AccessControlError(
      "ACCESS_CAPACITY_REACHED",
      "The live stream capacity is temporarily full.",
      503,
      1,
    );
  }
  activeStreams += 1;
  return new ResourceLease(kind, () => {
    activeStreams = Math.max(0, activeStreams - 1);
  });
}

async function authorise(
  request: Request,
  config: ServerConfig,
  kind: ResourceKind,
) {
  if (config.mode === "synthetic") {
    return new ResourceLease(kind, () => undefined);
  }
  if (!config.txline.apiToken) {
    throw new AccessControlError(
      "LIVE_NOT_CONFIGURED",
      "Live mode requires an activated TXLINE_API_TOKEN. Synthetic data was not substituted.",
      503,
    );
  }
  assertAccessConfigured(config);
  const session = await readSession(request, config);
  if (!session.authenticated || !session.fingerprint) {
    throw new AccessControlError(
      "ACCESS_REQUIRED",
      "Operator access is required for live sponsor data.",
      401,
    );
  }
  assertRateAvailable(
    `live:${session.fingerprint}`,
    config.access.maxRequestsPerMinute,
  );
  return acquireResource(config, kind);
}

function wrapStream(
  source: ReadableStream<Uint8Array>,
  lease: ResourceLease,
  maximumDurationMs: number,
) {
  const reader = source.getReader();
  let finished = false;
  let activeController: ReadableStreamDefaultController<Uint8Array> | null = null;
  const finish = () => {
    if (finished) return;
    finished = true;
    clearTimeout(timeout);
    lease.release();
  };
  const timeout = setTimeout(() => {
    if (finished) return;
    void reader
      .cancel("Maximum live stream duration reached.")
      .catch(() => undefined);
    try {
      activeController?.close();
    } catch {
      // The downstream may have closed between the timeout check and this call.
    }
    finish();
  }, maximumDurationMs);

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      activeController = controller;
      try {
        const chunk = await reader.read();
        if (finished) return;
        if (chunk.done) {
          controller.close();
          finish();
          return;
        }
        controller.enqueue(chunk.value);
      } catch (error) {
        if (!finished) {
          controller.error(error);
          finish();
        }
      }
    },
    async cancel(reason) {
      try {
        await reader.cancel(reason);
      } finally {
        finish();
      }
    },
  });
}

export async function withLiveAccess<T extends Response>(
  request: Request,
  config: ServerConfig,
  kind: ResourceKind,
  operation: () => Promise<T>,
): Promise<T | Response> {
  const lease = await authorise(request, config, kind);
  try {
    const response = await operation();
    if (kind === "stream" && config.mode === "live" && response.body) {
      const headers = new Headers(response.headers);
      headers.append("Vary", "Cookie");
      return new Response(
        wrapStream(
          response.body as ReadableStream<Uint8Array>,
          lease,
          config.access.maxStreamDurationMs,
        ),
        { status: response.status, statusText: response.statusText, headers },
      );
    }
    lease.release();
    return response;
  } catch (error) {
    lease.release();
    throw error;
  }
}

export function accessErrorResponse(
  error: unknown,
  mode?: AppMode,
): Response | null {
  if (!(error instanceof AccessControlError)) return null;
  const headers = new Headers({
    "Cache-Control": "no-store",
    "Content-Type": "application/json",
    Vary: "Cookie",
  });
  if (error.retryAfterSeconds !== null) {
    headers.set("Retry-After", String(error.retryAfterSeconds));
  }
  if (error.status === 401) {
    headers.set("WWW-Authenticate", 'ProofSwitch realm="live"');
  }
  return new Response(
    JSON.stringify({ error: { code: error.code, message: error.message }, mode }),
    { status: error.status, headers },
  );
}

export async function getPublicAccessStatus(
  request: Request,
  config: ServerConfig,
): Promise<PublicAccessStatus> {
  const configured = accessConfigured(config);
  const session = configured
    ? await readSession(request, config)
    : { authenticated: false, expiresAt: null, fingerprint: null };
  return {
    required: config.mode === "live",
    configured,
    authenticated: config.mode === "live" && session.authenticated,
    expiresAt:
      config.mode === "live" && session.authenticated ? session.expiresAt : null,
  };
}

export async function issueAccessSession(
  request: Request,
  config: ServerConfig,
): Promise<{ status: PublicAccessStatus; cookie: string | null }> {
  assertSameOrigin(request);
  if (config.mode === "synthetic") {
    return { status: await getPublicAccessStatus(request, config), cookie: null };
  }
  assertAccessConfigured(config);
  assertRateAvailable(
    `login:${clientKey(request)}`,
    config.access.maxAccessAttemptsPerMinute,
  );

  const contentType = request.headers.get("Content-Type")?.split(";", 1)[0].trim();
  if (contentType !== "application/json") {
    throw new AccessControlError(
      "ACCESS_INVALID_REQUEST",
      "The access request must be JSON.",
      400,
    );
  }
  const declaredLength = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_ACCESS_BODY_BYTES) {
    throw new AccessControlError(
      "ACCESS_INVALID_REQUEST",
      "The access request is too large.",
      413,
    );
  }
  const bodyText = await request.text();
  if (encoder.encode(bodyText).byteLength > MAX_ACCESS_BODY_BYTES) {
    throw new AccessControlError(
      "ACCESS_INVALID_REQUEST",
      "The access request is too large.",
      413,
    );
  }
  let body: unknown;
  try {
    body = JSON.parse(bodyText);
  } catch {
    throw new AccessControlError(
      "ACCESS_INVALID_REQUEST",
      "The access request body is invalid.",
      400,
    );
  }
  const suppliedCode =
    typeof body === "object" && body !== null && "code" in body
      ? (body as { code?: unknown }).code
      : null;
  const boundedCode =
    typeof suppliedCode === "string" && suppliedCode.length <= 256
      ? suppliedCode
      : "";
  const [suppliedDigest, expectedDigest] = await Promise.all([
    hmac(config.access.signingSecret!, `access-code:${boundedCode}`),
    hmac(config.access.signingSecret!, `access-code:${config.access.code!}`),
  ]);
  if (!constantTimeEqual(suppliedDigest, expectedDigest)) {
    throw new AccessControlError(
      "ACCESS_DENIED",
      "The operator access code was not accepted.",
      401,
    );
  }

  const expiresSeconds =
    Math.floor(Date.now() / 1_000) + config.access.sessionTtlSeconds;
  const nonceBytes = new Uint8Array(16);
  cryptoRuntime().getRandomValues(nonceBytes);
  const payload = bytesToBase64Url(
    encoder.encode(
      `${COOKIE_VERSION}:${expiresSeconds}:${bytesToBase64Url(nonceBytes)}`,
    ),
  );
  const signature = bytesToBase64Url(
    await hmac(config.access.signingSecret!, `session:${payload}`),
  );
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  const cookie = `${COOKIE_NAME}=${payload}.${signature}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${config.access.sessionTtlSeconds}${secure}`;
  const authenticatedRequest = new Request(request.url, {
    headers: { Cookie: cookie.split(";", 1)[0] },
  });
  return {
    status: await getPublicAccessStatus(authenticatedRequest, config),
    cookie,
  };
}

export function clearAccessSession(request: Request) {
  assertSameOrigin(request);
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`;
}

export function resetAccessControlForTests() {
  activeRequests = 0;
  activeStreams = 0;
  rateBuckets.clear();
}
