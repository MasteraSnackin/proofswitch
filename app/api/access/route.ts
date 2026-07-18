import {
  accessErrorResponse,
  clearAccessSession,
  getPublicAccessStatus,
  issueAccessSession,
} from "../../../server/access-control";
import {
  ConfigurationError,
  readServerConfig,
} from "../../../server/config";

export const dynamic = "force-dynamic";

function response(data: unknown, cookie?: string | null) {
  const headers = new Headers({
    "Cache-Control": "no-store",
    Vary: "Cookie",
  });
  if (cookie) headers.set("Set-Cookie", cookie);
  return Response.json({ data }, { headers });
}

function failure(error: unknown) {
  const accessFailure = accessErrorResponse(error);
  if (accessFailure) return accessFailure;
  const code = error instanceof ConfigurationError ? error.code : "ACCESS_FAILED";
  const message =
    error instanceof ConfigurationError
      ? error.message
      : "Operator access could not be processed.";
  return Response.json(
    { error: { code, message } },
    { status: 500, headers: { "Cache-Control": "no-store", Vary: "Cookie" } },
  );
}

export async function GET(request: Request) {
  try {
    const config = readServerConfig();
    return response(await getPublicAccessStatus(request, config));
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    const config = readServerConfig();
    const result = await issueAccessSession(request, config);
    return response(result.status, result.cookie);
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const config = readServerConfig();
    const cookie = clearAccessSession(request);
    const anonymousRequest = new Request(request.url);
    return response(await getPublicAccessStatus(anonymousRequest, config), cookie);
  } catch (error) {
    return failure(error);
  }
}
