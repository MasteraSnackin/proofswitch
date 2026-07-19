#!/usr/bin/env node

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  chmod,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultWorkDirectory = resolve(repositoryRoot, "work/demo-video");
const defaultNarrationPath = resolve(defaultWorkDirectory, "narration.txt");
const defaultReferenceAudioPath = resolve(defaultWorkDirectory, "narration.aiff");
const defaultVideoPath = resolve(defaultWorkDirectory, "proofswitch-screen-v4.mp4");
const defaultRawVoicePath = resolve(defaultWorkDirectory, "narration-elevenlabs.mp3");
const defaultMasterVoicePath = resolve(defaultWorkDirectory, "narration-elevenlabs-master.wav");
const defaultOutputPath = resolve(defaultWorkDirectory, "proofswitch-screen-elevenlabs.mp4");
const maximumNarrationCharacters = 10_000;
const maximumSubmissionDurationSeconds = 300;
const minimumIntegratedLoudnessLufs = -17;
const maximumIntegratedLoudnessLufs = -15;
const maximumTruePeakDbtp = -1.5;

function argument(name) {
  const inline = process.argv.find((value) => value.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

async function loadLocalEnvironment() {
  const path = resolve(repositoryRoot, ".env.local");
  const contents = await readFile(path, "utf8").catch(() => null);
  if (contents === null) return;
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match || process.env[match[1]] !== undefined) continue;
    let value = match[2].trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
}

function boundedNumber(value, fallback, minimum, maximum, name) {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}`);
  }
  return parsed;
}

function safeApiError(value) {
  if (typeof value !== "string") return "The service returned an unreadable error";
  try {
    const parsed = JSON.parse(value);
    const detail = parsed?.detail;
    if (typeof detail === "string") return detail.slice(0, 300);
    if (typeof detail?.message === "string") return detail.message.slice(0, 300);
  } catch {
    // Fall back to a bounded plain-text response.
  }
  return value.replace(/\s+/g, " ").trim().slice(0, 300);
}

async function run(command, args, options = {}) {
  try {
    return await execFileAsync(command, args, {
      cwd: repositoryRoot,
      maxBuffer: 8 * 1024 * 1024,
      ...options,
    });
  } catch (error) {
    const stderr = typeof error?.stderr === "string" ? error.stderr.trim() : "";
    throw new Error(`${command} failed${stderr ? `: ${stderr.slice(-1_000)}` : ""}`);
  }
}

async function durationSeconds(path) {
  const { stdout } = await run("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    path,
  ]);
  const duration = Number(stdout.trim());
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error(`Could not determine the duration of ${path}`);
  }
  return duration;
}

async function measureLoudness(path) {
  const { stderr } = await run("ffmpeg", [
    "-hide_banner",
    "-nostats",
    "-i",
    path,
    "-map",
    "0:a:0",
    "-filter:a",
    "ebur128=peak=true",
    "-f",
    "null",
    "-",
  ]);
  const summary = stderr.slice(stderr.lastIndexOf("Summary:"));
  const integratedMatch = /I:\s*(-?\d+(?:\.\d+)?) LUFS/.exec(summary);
  const truePeakMatch = /Peak:\s*(-?\d+(?:\.\d+)?) dBFS/.exec(summary);
  const integratedLoudness = Number(integratedMatch?.[1]);
  const truePeak = Number(truePeakMatch?.[1]);
  if (!Number.isFinite(integratedLoudness) || !Number.isFinite(truePeak)) {
    throw new Error("Could not measure final AAC loudness and true peak");
  }
  return { integratedLoudness, truePeak };
}

function atempoFilters(sourceDuration, targetDuration) {
  let ratio = sourceDuration / targetDuration;
  const filters = [];
  while (ratio < 0.5) {
    filters.push("atempo=0.5");
    ratio /= 0.5;
  }
  while (ratio > 2) {
    filters.push("atempo=2");
    ratio /= 2;
  }
  filters.push(`atempo=${ratio.toFixed(8)}`);
  return filters;
}

async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function canonicalPath(path) {
  const existing = await realpath(path).catch(() => null);
  if (existing) return existing;
  const parent = await realpath(dirname(path)).catch(() => dirname(path));
  return resolve(parent, basename(path));
}

async function assertSafeOutputs(inputs, outputs) {
  const protectedPaths = new Map();
  for (const [label, path] of inputs) {
    protectedPaths.set(await canonicalPath(path), label);
  }
  const seenOutputs = new Map();
  for (const [label, path] of outputs) {
    const canonical = await canonicalPath(path);
    const protectedLabel = protectedPaths.get(canonical);
    if (protectedLabel) {
      throw new Error(`${label} cannot overwrite ${protectedLabel}: ${path}`);
    }
    const otherOutput = seenOutputs.get(canonical);
    if (otherOutput) {
      throw new Error(`${label} and ${otherOutput} must use different paths`);
    }
    seenOutputs.set(canonical, label);
  }
}

function requireApiKey() {
  const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "ELEVENLABS_API_KEY is empty. Add it to .env.local; do not paste it into chat or commit it.",
    );
  }
  return apiKey;
}

async function listVoices(apiKey) {
  const response = await fetch("https://api.elevenlabs.io/v2/voices?page_size=100", {
    headers: { "xi-api-key": apiKey },
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`ElevenLabs voice lookup failed (${response.status}): ${safeApiError(body)}`);
  }
  const parsed = JSON.parse(body);
  const voices = Array.isArray(parsed.voices) ? parsed.voices : [];
  if (voices.length === 0) {
    process.stdout.write("No API-accessible voices were returned for this account.\n");
    return;
  }
  process.stdout.write("Voice ID\tName\tAccent\tUse case\tCategory\n");
  for (const voice of voices) {
    const labels = voice && typeof voice.labels === "object" ? voice.labels : {};
    process.stdout.write(
      `${String(voice.voice_id ?? "")}\t${String(voice.name ?? "")}\t${String(labels.accent ?? "")}\t${String(labels.use_case ?? "")}\t${String(voice.category ?? "")}\n`,
    );
  }
}

async function createVoice({ apiKey, voiceId, narration, rawVoicePath }) {
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(voiceId)) {
    throw new Error("ELEVENLABS_VOICE_ID is missing or malformed");
  }
  const modelId = process.env.ELEVENLABS_MODEL_ID?.trim() || "eleven_multilingual_v2";
  const speed = boundedNumber(
    process.env.ELEVENLABS_VOICE_SPEED,
    1,
    0.7,
    1.2,
    "ELEVENLABS_VOICE_SPEED",
  );
  const stability = boundedNumber(
    process.env.ELEVENLABS_VOICE_STABILITY,
    0.5,
    0,
    1,
    "ELEVENLABS_VOICE_STABILITY",
  );
  const similarity = boundedNumber(
    process.env.ELEVENLABS_VOICE_SIMILARITY,
    0.75,
    0,
    1,
    "ELEVENLABS_VOICE_SIMILARITY",
  );

  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: {
        accept: "audio/mpeg",
        "content-type": "application/json",
        "xi-api-key": apiKey,
      },
      body: JSON.stringify({
        text: narration,
        model_id: modelId,
        voice_settings: {
          stability,
          similarity_boost: similarity,
          style: 0,
          use_speaker_boost: true,
          speed,
        },
        apply_text_normalization: "auto",
      }),
      signal: AbortSignal.timeout(300_000),
    },
  );

  if (!response.ok) {
    throw new Error(
      `ElevenLabs synthesis failed (${response.status}): ${safeApiError(await response.text())}`,
    );
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.startsWith("audio/")) {
    throw new Error(`ElevenLabs returned an unexpected content type: ${contentType || "missing"}`);
  }

  const partialPath = `${rawVoicePath}.partial`;
  await mkdir(dirname(rawVoicePath), { recursive: true });
  await writeFile(partialPath, Buffer.from(await response.arrayBuffer()), { mode: 0o600 });
  await rename(partialPath, rawVoicePath);
  await chmod(rawVoicePath, 0o600);
  return { modelId, speed, stability, similarity };
}

async function buildVideo({ sourceAudioPath, targetDuration, videoPath, masterVoicePath, outputPath }) {
  const sourceDuration = await durationSeconds(sourceAudioPath);
  const tempo = atempoFilters(sourceDuration, targetDuration);
  const audioFilter = [
    ...tempo,
    `apad=whole_dur=${targetDuration.toFixed(6)}`,
    `atrim=duration=${targetDuration.toFixed(6)}`,
    // Leave encoding headroom; the encoded output is measured and enforced below.
    "loudnorm=I=-16:LRA=11:TP=-2",
  ].join(",");

  await mkdir(dirname(masterVoicePath), { recursive: true });
  await run("ffmpeg", [
    "-y",
    "-v",
    "error",
    "-i",
    sourceAudioPath,
    "-vn",
    "-af",
    audioFilter,
    "-ar",
    "44100",
    "-ac",
    "1",
    "-c:a",
    "pcm_s16le",
    masterVoicePath,
  ]);

  await mkdir(dirname(outputPath), { recursive: true });
  await run("ffmpeg", [
    "-y",
    "-v",
    "error",
    "-i",
    videoPath,
    "-i",
    masterVoicePath,
    "-map",
    "0:v:0",
    "-map",
    "1:a:0",
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-ar",
    "44100",
    "-ac",
    "1",
    "-shortest",
    "-movflags",
    "+faststart",
    outputPath,
  ]);

  await chmod(masterVoicePath, 0o600);
  await chmod(outputPath, 0o600);
  await run("ffmpeg", ["-v", "error", "-i", outputPath, "-f", "null", "-"]);
  const outputDuration = await durationSeconds(outputPath);
  if (outputDuration >= maximumSubmissionDurationSeconds) {
    await rm(outputPath, { force: true });
    throw new Error(
      `Generated video is ${outputDuration.toFixed(3)} seconds; it must remain under five minutes`,
    );
  }
  const loudness = await measureLoudness(outputPath);
  if (
    loudness.integratedLoudness < minimumIntegratedLoudnessLufs ||
    loudness.integratedLoudness > maximumIntegratedLoudnessLufs ||
    loudness.truePeak > maximumTruePeakDbtp
  ) {
    await rm(outputPath, { force: true });
    throw new Error(
      `Encoded audio failed delivery limits: ${loudness.integratedLoudness.toFixed(1)} LUFS, ${loudness.truePeak.toFixed(1)} dBTP`,
    );
  }
  return { sourceDuration, outputDuration, ...loudness };
}

async function ensureFile(path, label) {
  const metadata = await stat(path).catch(() => null);
  if (!metadata?.isFile()) throw new Error(`${label} is missing: ${path}`);
}

async function main() {
  await loadLocalEnvironment();
  if (hasFlag("--list-voices")) {
    await listVoices(requireApiKey());
    return;
  }

  const narrationPath = resolve(repositoryRoot, argument("--narration") ?? defaultNarrationPath);
  const referenceAudioPath = resolve(
    repositoryRoot,
    argument("--reference-audio") ?? defaultReferenceAudioPath,
  );
  const videoPath = resolve(repositoryRoot, argument("--video") ?? defaultVideoPath);
  const rawVoicePath = resolve(repositoryRoot, argument("--raw-output") ?? defaultRawVoicePath);
  const masterVoicePath = resolve(
    repositoryRoot,
    argument("--master-output") ?? defaultMasterVoicePath,
  );
  const outputPath = resolve(repositoryRoot, argument("--output") ?? defaultOutputPath);
  const suppliedAudioArgument = argument("--audio");
  const suppliedAudioPath = suppliedAudioArgument
    ? resolve(repositoryRoot, suppliedAudioArgument)
    : null;
  const configuredTargetDuration =
    argument("--target-duration") ?? process.env.ELEVENLABS_TARGET_DURATION_SECONDS;

  await ensureFile(videoPath, "Screen recording");
  if (suppliedAudioPath) {
    await ensureFile(suppliedAudioPath, "Supplied narration audio");
  } else {
    await ensureFile(narrationPath, "Narration text");
  }
  if (configuredTargetDuration === undefined || configuredTargetDuration === "") {
    await ensureFile(referenceAudioPath, "Reference narration");
  }
  await run("ffmpeg", ["-version"]);
  await run("ffprobe", ["-version"]);

  let narration = null;
  if (!suppliedAudioPath) {
    narration = (await readFile(narrationPath, "utf8")).trim();
    if (narration.length === 0 || narration.length > maximumNarrationCharacters) {
      throw new Error(
        `Narration must contain between 1 and ${maximumNarrationCharacters.toLocaleString("en-GB")} characters`,
      );
    }
  }
  const videoDuration = await durationSeconds(videoPath);
  const referenceDuration =
    configuredTargetDuration === undefined || configuredTargetDuration === ""
      ? await durationSeconds(referenceAudioPath)
      : null;
  const targetDuration = boundedNumber(
    configuredTargetDuration,
    referenceDuration ?? videoDuration,
    30,
    Math.min(videoDuration, maximumSubmissionDurationSeconds - 0.1),
    "target duration",
  );

  const inputPaths = [["screen recording", videoPath]];
  if (suppliedAudioPath) inputPaths.push(["supplied narration audio", suppliedAudioPath]);
  else inputPaths.push(["narration text", narrationPath]);
  if (referenceDuration !== null) inputPaths.push(["reference narration", referenceAudioPath]);
  const outputPaths = [
    ["voice master output", masterVoicePath],
    ["final video output", outputPath],
  ];
  if (!suppliedAudioPath) {
    outputPaths.push(["raw ElevenLabs output", rawVoicePath]);
    outputPaths.push(["partial ElevenLabs output", `${rawVoicePath}.partial`]);
  }
  await assertSafeOutputs(inputPaths, outputPaths);

  if (hasFlag("--dry-run")) {
    process.stdout.write(
      [
        "ElevenLabs demo pipeline is ready.",
        narration
          ? `Narration: ${narration.length.toLocaleString("en-GB")} characters`
          : `Narration audio: ${suppliedAudioPath}`,
        referenceDuration === null
          ? "Reference audio: not required; target duration supplied"
          : `Reference audio: ${referenceDuration.toFixed(3)} seconds`,
        `Source video: ${videoDuration.toFixed(3)} seconds`,
        `Target audio: ${targetDuration.toFixed(3)} seconds`,
        `Output: ${outputPath}`,
      ].join("\n") + "\n",
    );
    return;
  }

  let sourceAudioPath;
  let generation = null;
  if (suppliedAudioPath) {
    sourceAudioPath = suppliedAudioPath;
  } else {
    const apiKey = requireApiKey();
    const voiceId = argument("--voice-id") ?? process.env.ELEVENLABS_VOICE_ID?.trim();
    if (!voiceId) {
      throw new Error(
        "ELEVENLABS_VOICE_ID is empty. Run `npm run demo:voices`, audition a British narration voice, then add its ID to .env.local.",
      );
    }
    generation = await createVoice({
      apiKey,
      voiceId,
      narration,
      rawVoicePath,
    });
    sourceAudioPath = rawVoicePath;
  }

  const result = await buildVideo({
    sourceAudioPath,
    targetDuration,
    videoPath,
    masterVoicePath,
    outputPath,
  });
  const checksum = await sha256(outputPath);
  process.stdout.write(
    [
      "Demo video generated and decoded successfully.",
      generation
        ? `ElevenLabs model: ${generation.modelId}; speed ${generation.speed.toFixed(2)}`
        : "Narration source: supplied local audio (ElevenLabs request skipped)",
      `Original narration: ${result.sourceDuration.toFixed(3)} seconds`,
      `Final video: ${result.outputDuration.toFixed(3)} seconds`,
      `Final audio: ${result.integratedLoudness.toFixed(1)} LUFS; ${result.truePeak.toFixed(1)} dBTP`,
      `SHA-256: ${checksum}`,
      `Output: ${outputPath}`,
    ].join("\n") + "\n",
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "Demo video generation failed";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
