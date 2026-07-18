import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { register } from "tsx/esm/api";

import { resetAccessControlForTests } from "../server/access-control.ts";

// Application routes use bundler-style extensionless imports. Register the
// same TypeScript resolver used by the local runner before loading them.
const unregisterTypeScriptResolver = register();
const [accessRoute, fixturesRoute, oddsRoute, scoresRoute, streamRoute, verifyRoute] =
  await Promise.all([
    import("../app/api/access/route.ts"),
    import("../app/api/fixtures/route.ts"),
    import("../app/api/odds/route.ts"),
    import("../app/api/scores/route.ts"),
    import("../app/api/stream/route.ts"),
    import("../app/api/verify/route.ts"),
  ]);
const {
  DELETE: deleteAccess,
  GET: getAccess,
  POST: postAccess,
} = accessRoute;
const { GET: getFixtures } = fixturesRoute;
const { GET: getOdds } = oddsRoute;
const { GET: getScores } = scoresRoute;
const { GET: getStream } = streamRoute;
const { GET: getVerification } = verifyRoute;

const ACCESS_CODE = "judge-access-code";
const SIGNING_SECRET = "independent-cookie-signing-secret-0001";
const ENVIRONMENT_KEYS = [
  "PROOFSWITCH_MODE",
  "TXLINE_NETWORK",
  "TXLINE_API_TOKEN",
  "TXLINE_API_ORIGIN",
  "TXLINE_ALLOW_CUSTOM_ORIGIN",
  "PROOFSWITCH_ACCESS_CODE",
  "PROOFSWITCH_ACCESS_SIGNING_SECRET",
  "PROOFSWITCH_ACCESS_SESSION_TTL_SECONDS",
] as const;
const originalEnvironment = new Map(
  ENVIRONMENT_KEYS.map((key) => [key, process.env[key]]),
);

function configureLiveAccess() {
  process.env.PROOFSWITCH_MODE = "live";
  process.env.TXLINE_NETWORK = "devnet";
  process.env.TXLINE_API_TOKEN = "activated-api-token";
  delete process.env.TXLINE_API_ORIGIN;
  delete process.env.TXLINE_ALLOW_CUSTOM_ORIGIN;
  process.env.PROOFSWITCH_ACCESS_CODE = ACCESS_CODE;
  process.env.PROOFSWITCH_ACCESS_SIGNING_SECRET = SIGNING_SECRET;
  process.env.PROOFSWITCH_ACCESS_SESSION_TTL_SECONDS = "600";
}

function sameOriginRequest(
  path: string,
  init: RequestInit = {},
  origin = "http://localhost:3000",
) {
  const headers = new Headers(init.headers);
  headers.set("Origin", origin);
  headers.set("Sec-Fetch-Site", "same-origin");
  return new Request(`http://localhost:3000${path}`, { ...init, headers });
}

before(() => {
  configureLiveAccess();
});

beforeEach(() => {
  configureLiveAccess();
  resetAccessControlForTests();
});

after(() => {
  for (const [key, value] of originalEnvironment) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetAccessControlForTests();
  return unregisterTypeScriptResolver();
});

test("every sponsor-data route rejects live requests without an access cookie", async () => {
  const cases = [
    ["fixtures", getFixtures, "/api/fixtures"],
    ["odds", getOdds, "/api/odds?fixtureId=18241006"],
    ["scores", getScores, "/api/scores?fixtureId=18241006"],
    ["stream", getStream, "/api/stream?kind=odds&fixtureId=18241006"],
    [
      "verification",
      getVerification,
      "/api/verify?fixtureId=18241006&seq=941&statKeys=1,2",
    ],
  ] as const;

  for (const [name, handler, path] of cases) {
    const response = await handler(new Request(`http://localhost:3000${path}`));
    assert.equal(response.status, 401, `${name} must fail closed`);
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
  }
});

test("access route issues, recognises and clears a bounded session cookie", async () => {
  const issued = await postAccess(
    sameOriginRequest("/api/access", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: ACCESS_CODE }),
    }),
  );
  assert.equal(issued.status, 200);
  const setCookie = issued.headers.get("Set-Cookie") ?? "";
  assert.match(setCookie, /^proofswitch_access=/);
  assert.match(setCookie, /; Path=\//);
  assert.match(setCookie, /; HttpOnly/);
  assert.match(setCookie, /; SameSite=Strict/);
  assert.match(setCookie, /; Max-Age=600/);
  assert.doesNotMatch(setCookie, /; Secure/);

  const issuedBody = (await issued.json()) as {
    data: { authenticated: boolean; expiresAt: string };
  };
  assert.equal(issuedBody.data.authenticated, true);
  const remainingLifetime =
    new Date(issuedBody.data.expiresAt).getTime() - Date.now();
  assert.ok(remainingLifetime > 598_000 && remainingLifetime <= 600_000);

  const cookie = setCookie.split(";", 1)[0];
  const recognised = await getAccess(
    new Request("http://localhost:3000/api/access", {
      headers: { Cookie: cookie },
    }),
  );
  assert.equal(recognised.status, 200);
  assert.equal(
    ((await recognised.json()) as { data: { authenticated: boolean } }).data
      .authenticated,
    true,
  );

  const cleared = await deleteAccess(
    sameOriginRequest("/api/access", {
      method: "DELETE",
      headers: { Cookie: cookie },
    }),
  );
  assert.equal(cleared.status, 200);
  assert.equal(
    ((await cleared.json()) as { data: { authenticated: boolean } }).data
      .authenticated,
    false,
  );
  assert.match(
    cleared.headers.get("Set-Cookie") ?? "",
    /^proofswitch_access=; Path=\/; HttpOnly; SameSite=Strict; Max-Age=0$/,
  );
});

test("access DELETE rejects cross-site requests without clearing the cookie", async () => {
  const request = sameOriginRequest(
    "/api/access",
    { method: "DELETE" },
    "https://attacker.example",
  );
  request.headers.set("Sec-Fetch-Site", "cross-site");
  const response = await deleteAccess(request);
  assert.equal(response.status, 403);
  assert.equal(response.headers.get("Set-Cookie"), null);
  assert.equal(
    ((await response.json()) as { error: { code: string } }).error.code,
    "ACCESS_ORIGIN_REJECTED",
  );
});
