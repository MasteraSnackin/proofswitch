import { chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  compareShockThresholds,
  assertValidAgentTrace,
  replayAgentTrace,
} from "../app/agent-replay.ts";
import { runHeadlessAgent } from "../server/headless-agent.ts";

const MAX_TRACE_FILE_BYTES = 16 * 1024 * 1024;

function argument(name: string) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

function positiveInteger(value: string | undefined, name: string) {
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value)) throw new Error(`${name} must be a positive integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive safe integer`);
  }
  return parsed;
}

function outputName(prefix: string) {
  return resolve(
    "outputs",
    `${prefix}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
  );
}

async function writeJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await chmod(path, 0o600);
}

async function readTrace(path: string) {
  const metadata = await stat(path);
  if (!metadata.isFile() || metadata.size > MAX_TRACE_FILE_BYTES) {
    throw new Error("Replay trace must be a file no larger than 16 MiB");
  }
  const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
  assertValidAgentTrace(parsed);
  return parsed;
}

async function main() {
  const replayPath = argument("--replay");
  const output = resolve(argument("--output") ?? outputName("proofswitch-headless-run"));
  if (replayPath) {
    const trace = await readTrace(resolve(replayPath));
    const replay = replayAgentTrace(trace);
    await writeJson(output, {
      schema: "proofswitch.historical-analysis.v1",
      integrity: "device-local-unsigned",
      source: trace.source,
      fixtureId: trace.fixtureId,
      metrics: replay.metrics,
      sensitivity: compareShockThresholds(trace),
      warning:
        "Keep TxLINE-derived trace files private; do not commit or redistribute licensed feed data.",
    });
    process.stdout.write(`Historical analysis written to ${output}\n`);
    return;
  }

  const durationSeconds = positiveInteger(argument("--duration"), "--duration") ?? 15;
  const fixtureId = positiveInteger(argument("--fixture"), "--fixture");
  const traceOutputArgument = argument("--private-trace-output");
  const result = await runHeadlessAgent({
    baseUrl: argument("--base-url") ?? process.env.PROOFSWITCH_AGENT_BASE_URL,
    fixtureId,
    durationMs: durationSeconds * 1_000,
    accessCode:
      argument("--access-code") ?? process.env.PROOFSWITCH_JUDGE_ACCESS_CODE,
    simulateFills: process.argv.includes("--simulate-fills"),
    onState: (state) => {
      process.stdout.write(
        `\r${state.status.padEnd(13)} fixture ${state.fixtureId} · ${state.reason.slice(0, 72).padEnd(72)}`,
      );
    },
  });
  process.stdout.write("\n");
  await writeJson(output, result.report);
  if (result.report.source === "txline") {
    process.stderr.write(
      "Live report contains TxLINE-derived state. Keep it private and do not publish or redistribute it.\n",
    );
  }
  if (traceOutputArgument) {
    const traceOutput = resolve(traceOutputArgument);
    await writeJson(traceOutput, result.trace);
    process.stdout.write(`Private canonical trace written to ${traceOutput}\n`);
  }
  process.stdout.write(`Headless run report written to ${output}\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Headless agent failed";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
