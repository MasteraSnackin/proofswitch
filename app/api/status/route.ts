import type { ApiFailure, ApiSuccess, AppStatus } from "../../../lib/contracts";
import {
  ConfigurationError,
  publicAppStatus,
  readServerConfig,
} from "../../../server/config";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const config = readServerConfig();
    const payload: ApiSuccess<AppStatus> = {
      data: publicAppStatus(config),
      mode: config.mode,
      source: config.mode === "live" ? "txline" : "synthetic",
      receivedAt: new Date().toISOString(),
    };
    return Response.json(payload, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const failure: ApiFailure = {
      error: {
        code: error instanceof ConfigurationError ? error.code : "STATUS_FAILED",
        message:
          error instanceof ConfigurationError
            ? error.message
            : "Application status could not be read.",
      },
    };
    return Response.json(failure, {
      status: 500,
      headers: { "Cache-Control": "no-store" },
    });
  }
}

