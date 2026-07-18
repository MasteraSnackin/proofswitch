import type { AppMode, AppStatus, TxlineNetwork } from "../lib/contracts";
import { PublicKey } from "@solana/web3.js";

const OFFICIAL_ORIGINS: Record<TxlineNetwork, string> = {
  devnet: "https://txline-dev.txodds.com",
  mainnet: "https://txline.txodds.com",
};

const PROGRAM_IDS: Record<TxlineNetwork, string> = {
  devnet: "6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J",
  mainnet: "9ExbZjAapQww1vfcisDmrngPinHTEfpjYRWMunJgcKaA",
};

export type ServerEnvironment = Readonly<Record<string, string | undefined>>;

export interface ServerConfig {
  mode: AppMode;
  network: TxlineNetwork;
  access: {
    code: string | null;
    signingSecret: string | null;
    sessionTtlSeconds: number;
    maxAccessAttemptsPerMinute: number;
    maxRequestsPerMinute: number;
    maxConcurrentRequests: number;
    maxConcurrentStreams: number;
    maxStreamDurationMs: number;
  };
  txline: {
    origin: string;
    apiToken: string | null;
    preferredFixtureId: number | null;
  };
  solana: {
    rpcUrl: string;
    rpcExplicitlyConfigured: boolean;
    simulationPayer: string | null;
    validationRequested: boolean;
    programId: string;
  };
  policy: {
    shockWindowMs: number;
    shockDelta: number;
    transportTimeoutMs: number;
    maximumPriceSilenceMs: number;
    maximumPriceSourceAgeMs: number;
    minimumSuspendMs: number;
    stableObservationsRequired: number;
    stableObservationDelta: number;
    maximumLiability: number;
    requoteDelta: number;
    minimumRequoteIntervalMs: number;
  };
}

export class ConfigurationError extends Error {
  readonly code: string;

  constructor(
    message: string,
    code = "CONFIG_INVALID",
  ) {
    super(message);
    this.name = "ConfigurationError";
    this.code = code;
  }
}

function readChoice<T extends string>(
  value: string | undefined,
  fallback: T,
  accepted: readonly T[],
  variableName: string,
): T {
  const parsed = value?.trim().toLowerCase() || fallback;
  if (!accepted.includes(parsed as T)) {
    throw new ConfigurationError(
      `${variableName} must be one of: ${accepted.join(", ")}.`,
    );
  }
  return parsed as T;
}

function cleanSecret(value: string | undefined) {
  const cleaned = value?.trim();
  return cleaned ? cleaned : null;
}

function readBoundedSecret(
  value: string | undefined,
  variableName: string,
  minimumLength: number,
  maximumLength: number,
) {
  const secret = cleanSecret(value);
  if (!secret) return null;
  if (secret.length < minimumLength || secret.length > maximumLength) {
    throw new ConfigurationError(
      `${variableName} must contain between ${minimumLength} and ${maximumLength} characters.`,
      "ACCESS_CONFIG_INVALID",
    );
  }
  return secret;
}

function readBoolean(
  value: string | undefined,
  fallback: boolean,
  variableName: string,
) {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = value.trim().toLowerCase();
  if (parsed === "true") return true;
  if (parsed === "false") return false;
  throw new ConfigurationError(`${variableName} must be true or false.`);
}

function readNumber(
  value: string | undefined,
  fallback: number,
  limits: { min: number; max: number; integer?: boolean },
  variableName: string,
) {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (
    !Number.isFinite(parsed) ||
    parsed < limits.min ||
    parsed > limits.max ||
    (limits.integer && !Number.isInteger(parsed))
  ) {
    const kind = limits.integer ? "an integer" : "a number";
    throw new ConfigurationError(
      `${variableName} must be ${kind} between ${limits.min} and ${limits.max}.`,
    );
  }
  return parsed;
}

function readOptionalPositiveInteger(value: string | undefined, variableName: string) {
  if (value === undefined || value.trim() === "") return null;
  return readNumber(
    value,
    1,
    { min: 1, max: Number.MAX_SAFE_INTEGER, integer: true },
    variableName,
  );
}

function readOrigin(
  value: string | undefined,
  network: TxlineNetwork,
  allowCustomOrigin: boolean,
) {
  const candidate = value?.trim() || OFFICIAL_ORIGINS[network];
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new ConfigurationError("TXLINE_API_ORIGIN must be an absolute URL.");
  }

  const isLocalHttp =
    url.protocol === "http:" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  if (url.protocol !== "https:" && !isLocalHttp) {
    throw new ConfigurationError(
      "TXLINE_API_ORIGIN must use HTTPS (HTTP is accepted only for localhost tests).",
    );
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new ConfigurationError(
      "TXLINE_API_ORIGIN cannot contain credentials, a query string or a fragment.",
    );
  }
  const origin = url.toString().replace(/\/$/, "");
  if (!allowCustomOrigin && origin !== OFFICIAL_ORIGINS[network]) {
    throw new ConfigurationError(
      `TXLINE_API_ORIGIN must match the official ${network} origin. Set TXLINE_ALLOW_CUSTOM_ORIGIN=true only for a controlled local test endpoint.`,
    );
  }
  return origin;
}

function readRpcUrl(value: string | null, network: TxlineNetwork) {
  const candidate =
    value ??
    (network === "devnet"
      ? "https://api.devnet.solana.com"
      : "https://api.mainnet-beta.solana.com");
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new ConfigurationError("SOLANA_RPC_URL must be an absolute URL.");
  }
  const isLocalHttp =
    url.protocol === "http:" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  if (url.protocol !== "https:" && !isLocalHttp) {
    throw new ConfigurationError(
      "SOLANA_RPC_URL must use HTTPS (HTTP is accepted only for localhost tests).",
    );
  }
  if (url.username || url.password || url.hash) {
    throw new ConfigurationError(
      "SOLANA_RPC_URL cannot contain URL credentials or a fragment.",
    );
  }
  return url.toString().replace(/\/$/, "");
}

function readPublicKey(value: string | null, variableName: string) {
  if (!value) return null;
  try {
    return new PublicKey(value).toBase58();
  } catch {
    throw new ConfigurationError(`${variableName} must be a valid Solana public key.`);
  }
}

export function readServerConfig(
  environment: ServerEnvironment = process.env,
): ServerConfig {
  const mode = readChoice(
    environment.PROOFSWITCH_MODE,
    "synthetic",
    ["synthetic", "live"] as const,
    "PROOFSWITCH_MODE",
  );
  const network = readChoice(
    environment.TXLINE_NETWORK,
    "devnet",
    ["devnet", "mainnet"] as const,
    "TXLINE_NETWORK",
  );
  const explicitRpc = cleanSecret(environment.SOLANA_RPC_URL);
  const simulationPayer = readPublicKey(
    cleanSecret(environment.SOLANA_SIMULATION_PAYER_PUBLIC_KEY) ??
      cleanSecret(environment.SOLANA_SIMULATION_PAYER),
    "SOLANA_SIMULATION_PAYER_PUBLIC_KEY",
  );
  const programId = readPublicKey(
    cleanSecret(environment.TXLINE_PROGRAM_ID) ?? PROGRAM_IDS[network],
    "TXLINE_PROGRAM_ID",
  )!;
  const allowCustomOrigin = readBoolean(
    environment.TXLINE_ALLOW_CUSTOM_ORIGIN,
    false,
    "TXLINE_ALLOW_CUSTOM_ORIGIN",
  );
  const accessCode = readBoundedSecret(
    environment.PROOFSWITCH_ACCESS_CODE,
    "PROOFSWITCH_ACCESS_CODE",
    8,
    128,
  );
  const accessSigningSecret = readBoundedSecret(
    environment.PROOFSWITCH_ACCESS_SIGNING_SECRET,
    "PROOFSWITCH_ACCESS_SIGNING_SECRET",
    32,
    256,
  );
  if ((accessCode === null) !== (accessSigningSecret === null)) {
    throw new ConfigurationError(
      "PROOFSWITCH_ACCESS_CODE and PROOFSWITCH_ACCESS_SIGNING_SECRET must be configured together.",
      "ACCESS_CONFIG_INVALID",
    );
  }

  return {
    mode,
    network,
    access: {
      code: accessCode,
      signingSecret: accessSigningSecret,
      sessionTtlSeconds: readNumber(
        environment.PROOFSWITCH_ACCESS_SESSION_TTL_SECONDS,
        3_600,
        { min: 300, max: 86_400, integer: true },
        "PROOFSWITCH_ACCESS_SESSION_TTL_SECONDS",
      ),
      maxAccessAttemptsPerMinute: readNumber(
        environment.PROOFSWITCH_ACCESS_ATTEMPTS_PER_MINUTE,
        5,
        { min: 1, max: 60, integer: true },
        "PROOFSWITCH_ACCESS_ATTEMPTS_PER_MINUTE",
      ),
      maxRequestsPerMinute: readNumber(
        environment.PROOFSWITCH_LIVE_REQUESTS_PER_MINUTE,
        120,
        { min: 10, max: 1_000, integer: true },
        "PROOFSWITCH_LIVE_REQUESTS_PER_MINUTE",
      ),
      maxConcurrentRequests: readNumber(
        environment.PROOFSWITCH_LIVE_MAX_CONCURRENT_REQUESTS,
        16,
        { min: 1, max: 128, integer: true },
        "PROOFSWITCH_LIVE_MAX_CONCURRENT_REQUESTS",
      ),
      maxConcurrentStreams: readNumber(
        environment.PROOFSWITCH_LIVE_MAX_CONCURRENT_STREAMS,
        4,
        { min: 1, max: 16, integer: true },
        "PROOFSWITCH_LIVE_MAX_CONCURRENT_STREAMS",
      ),
      maxStreamDurationMs: readNumber(
        environment.PROOFSWITCH_LIVE_MAX_STREAM_DURATION_MS,
        900_000,
        { min: 30_000, max: 3_600_000, integer: true },
        "PROOFSWITCH_LIVE_MAX_STREAM_DURATION_MS",
      ),
    },
    txline: {
      origin: readOrigin(environment.TXLINE_API_ORIGIN, network, allowCustomOrigin),
      apiToken: cleanSecret(environment.TXLINE_API_TOKEN),
      preferredFixtureId: readOptionalPositiveInteger(
        environment.TXLINE_FIXTURE_ID,
        "TXLINE_FIXTURE_ID",
      ),
    },
    solana: {
      rpcUrl: readRpcUrl(explicitRpc, network),
      rpcExplicitlyConfigured: explicitRpc !== null,
      simulationPayer,
      validationRequested: readBoolean(
        environment.SOLANA_VALIDATION_ENABLED,
        false,
        "SOLANA_VALIDATION_ENABLED",
      ),
      programId,
    },
    policy: {
      shockWindowMs: readNumber(
        environment.PROOFSWITCH_SHOCK_WINDOW_MS,
        2_000,
        { min: 250, max: 60_000, integer: true },
        "PROOFSWITCH_SHOCK_WINDOW_MS",
      ),
      shockDelta: readNumber(
        environment.PROOFSWITCH_SHOCK_DELTA,
        0.04,
        { min: 0.001, max: 0.5 },
        "PROOFSWITCH_SHOCK_DELTA",
      ),
      transportTimeoutMs: readNumber(
        environment.PROOFSWITCH_TRANSPORT_STALE_AFTER_MS,
        20_000,
        { min: 2_500, max: 300_000, integer: true },
        "PROOFSWITCH_TRANSPORT_STALE_AFTER_MS",
      ),
      maximumPriceSilenceMs: readNumber(
        environment.PROOFSWITCH_PRICE_SILENCE_MS,
        120_000,
        { min: 5_000, max: 900_000, integer: true },
        "PROOFSWITCH_PRICE_SILENCE_MS",
      ),
      maximumPriceSourceAgeMs: readNumber(
        environment.PROOFSWITCH_PRICE_SOURCE_AGE_MS,
        120_000,
        { min: 5_000, max: 900_000, integer: true },
        "PROOFSWITCH_PRICE_SOURCE_AGE_MS",
      ),
      minimumSuspendMs: readNumber(
        environment.PROOFSWITCH_MINIMUM_SUSPEND_MS,
        3_000,
        { min: 0, max: 120_000, integer: true },
        "PROOFSWITCH_MINIMUM_SUSPEND_MS",
      ),
      stableObservationsRequired: readNumber(
        environment.PROOFSWITCH_STABLE_OBSERVATIONS,
        3,
        { min: 1, max: 20, integer: true },
        "PROOFSWITCH_STABLE_OBSERVATIONS",
      ),
      stableObservationDelta: readNumber(
        environment.PROOFSWITCH_STABLE_DELTA,
        0.0075,
        { min: 0.0001, max: 0.1 },
        "PROOFSWITCH_STABLE_DELTA",
      ),
      maximumLiability: readNumber(
        environment.PROOFSWITCH_MAXIMUM_LIABILITY,
        1_000,
        { min: 1, max: 1_000_000_000 },
        "PROOFSWITCH_MAXIMUM_LIABILITY",
      ),
      requoteDelta: readNumber(
        environment.PROOFSWITCH_REQUOTE_DELTA ??
          environment.PROOFSWITCH_REPRICE_DELTA,
        0.005,
        { min: 0.001, max: 0.2 },
        "PROOFSWITCH_REQUOTE_DELTA",
      ),
      minimumRequoteIntervalMs: readNumber(
        environment.PROOFSWITCH_MINIMUM_REQUOTE_INTERVAL_MS ??
          environment.PROOFSWITCH_MINIMUM_REPRICE_INTERVAL_MS,
        1_000,
        { min: 250, max: 120_000, integer: true },
        "PROOFSWITCH_MINIMUM_REQUOTE_INTERVAL_MS",
      ),
    },
  };
}

export function assertLiveConfigured(config: ServerConfig) {
  if (config.mode !== "live") {
    throw new ConfigurationError(
      "The live TxLINE client cannot be used while PROOFSWITCH_MODE is synthetic.",
    );
  }
  if (!config.txline.apiToken) {
    throw new ConfigurationError(
      "Live mode requires an activated TXLINE_API_TOKEN. Synthetic data was not substituted.",
      "LIVE_NOT_CONFIGURED",
    );
  }
}

export function isSolanaValidationRuntimeConfigured(config: ServerConfig) {
  return (
    config.solana.validationRequested &&
    config.solana.simulationPayer !== null &&
    config.network === "devnet" &&
    config.solana.programId === PROGRAM_IDS.devnet
  );
}

export function publicAppStatus(config: ServerConfig): AppStatus {
  const apiTokenPresent = config.txline.apiToken !== null;
  const operatorAccessConfigured =
    config.access.code !== null && config.access.signingSecret !== null;
  const simulationPayerConfigured = config.solana.simulationPayer !== null;
  const onchainValidation = isSolanaValidationRuntimeConfigured(config);
  const limitations: string[] = [];
  const missing: string[] = [];
  const configured: string[] = [];

  if (config.mode === "live") configured.push("PROOFSWITCH_MODE=live");
  else missing.push("PROOFSWITCH_MODE=live");
  if (apiTokenPresent) configured.push("TXLINE_API_TOKEN");
  else missing.push("TXLINE_API_TOKEN");
  if (operatorAccessConfigured) {
    configured.push("PROOFSWITCH_ACCESS_CODE");
    configured.push("PROOFSWITCH_ACCESS_SIGNING_SECRET");
  } else {
    missing.push("PROOFSWITCH_ACCESS_CODE");
    missing.push("PROOFSWITCH_ACCESS_SIGNING_SECRET");
  }
  if (config.solana.validationRequested) configured.push("SOLANA_VALIDATION_ENABLED=true");
  if (simulationPayerConfigured) configured.push("SOLANA_SIMULATION_PAYER_PUBLIC_KEY");
  else if (config.solana.validationRequested) missing.push("SOLANA_SIMULATION_PAYER_PUBLIC_KEY");

  const liveReady = config.mode === "live" && apiTokenPresent && operatorAccessConfigured;
  const liveReadiness =
    liveReady && onchainValidation
      ? {
          state: "ready" as const,
          missing,
          configured,
          nextAction:
            "Unlock operator access, load fixtures and connect a covered live fixture.",
        }
      : liveReady
        ? {
            state: "validation_optional" as const,
            missing,
            configured,
            nextAction:
              "Live TxLINE access is ready. Add Solana validation settings only if the demo must claim on-chain verification.",
          }
        : {
            state: "configuration_required" as const,
            missing,
            configured,
            nextAction:
              "Add the missing server-side values, restart the app and recheck this status before connecting a live fixture.",
          };

  if (config.mode === "live" && !apiTokenPresent) {
    limitations.push(
      "Live mode is selected, but an activated TxLINE API token is not configured.",
    );
  }
  if (config.mode === "live" && !operatorAccessConfigured) {
    limitations.push(
      "Live sponsor routes are locked until operator access is configured.",
    );
  }
  limitations.push(
    "Wallet subscription and token activation remain external; this web application stores no wallet secret.",
  );
  if (config.solana.validationRequested && !simulationPayerConfigured) {
    limitations.push(
      "On-chain validation was requested, but SOLANA_SIMULATION_PAYER_PUBLIC_KEY is not configured.",
    );
  } else if (
    config.solana.validationRequested &&
    (config.network !== "devnet" || config.solana.programId !== PROGRAM_IDS.devnet)
  ) {
    limitations.push(
      "The bundled read-only validator supports the published TxLINE devnet program only.",
    );
  } else if (!config.solana.validationRequested) {
    limitations.push("On-chain validation is disabled.");
  }

  return {
    mode: config.mode,
    network: config.network,
    liveConfigured: apiTokenPresent,
    liveReady,
    liveReadiness,
    txline: {
      configured: apiTokenPresent,
      origin: config.txline.origin,
      apiTokenPresent,
      guestAuthentication: "on-demand",
      preferredFixtureId: config.txline.preferredFixtureId,
    },
    solana: {
      network: config.network,
      rpcConfigured: true,
      walletConfigured: false,
      simulationPayerConfigured,
      runtimeConfigured: onchainValidation,
      validationEnabled: onchainValidation,
      programId: config.solana.programId,
    },
    policy: { ...config.policy },
    capabilities: {
      fixtures:
        config.mode === "synthetic" ||
        (apiTokenPresent && operatorAccessConfigured),
      odds:
        config.mode === "synthetic" ||
        (apiTokenPresent && operatorAccessConfigured),
      scores:
        config.mode === "synthetic" ||
        (apiTokenPresent && operatorAccessConfigured),
      streaming:
        config.mode === "synthetic" ||
        (apiTokenPresent && operatorAccessConfigured),
      paperExecution: true,
      onchainValidation,
    },
    limitations,
  };
}
