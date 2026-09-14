import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { arch, cpus, platform, release, totalmem } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { profileFingerprint } from "../../electron/agent/policy.ts";
import type { PolicyProfile } from "../../electron/agent/contracts.ts";

export const BENCH_ROOT = resolve(new URL("..", import.meta.url).pathname);
/** Shared embedding weights across benchmark runs (gitignored). */
export const BENCH_MODEL_CACHE = join(BENCH_ROOT, "results", ".models");

export type BenchProfile = {
  name: string;
  retrieval: Record<string, unknown> & { mode: "keyword" | "semantic" | "hybrid"; topK: number };
  policy: PolicyProfile;
  answer: { modelAlias: string; promptVersion: string; temperature: number };
};

export type BenchArgs = { dataset: string; profile: string; runs: number; client: string; datasetDir: string; profilePath: string };

export function parseBenchArgs(): BenchArgs {
  const { values } = parseArgs({
    options: {
      dataset: { type: "string", default: "local-rag-v1" },
      profile: { type: "string", default: "baseline-v1" },
      runs: { type: "string", default: "1" },
      client: { type: "string", default: process.env.LITELLM_API_KEY ? "litellm" : "always-search" },
    },
  });
  return {
    dataset: values.dataset,
    profile: values.profile,
    runs: Number(values.runs),
    client: values.client,
    datasetDir: join(BENCH_ROOT, "datasets", values.dataset),
    profilePath: join(BENCH_ROOT, "profiles", `${values.profile}.json`),
  };
}

/** `${LITELLM_MODEL_ALIAS}` placeholders resolve from the environment so aliases never live in the repo. */
export function loadProfile(path: string): BenchProfile {
  const text = readFileSync(path, "utf8").replace(/\$\{(\w+)\}/g, (_match, name: string) => process.env[name] ?? `<${name}>`);
  return JSON.parse(text) as BenchProfile;
}

export function readJsonl<T>(path: string): T[] {
  return readFileSync(path, "utf8").split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line) as T);
}

export function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function gitSha(): string {
  try {
    return execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "unknown";
  }
}

export type BenchOutput = { manifest: Record<string, unknown>; runs: unknown[]; summary: Record<string, unknown> };

export function writeResults(suite: string, args: BenchArgs, profile: BenchProfile, output: BenchOutput): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = join(BENCH_ROOT, "results", `${stamp}-${profile.name}-${suite}`);
  mkdirSync(dir, { recursive: true });
  const manifest = {
    suite,
    gitSha: gitSha(),
    os: `${platform()} ${release()}`,
    node: process.version,
    hardware: {
      arch: arch(),
      cpuCount: cpus().length,
      memoryGiB: Math.round(totalmem() / 1024 ** 3),
      embeddingBackend: process.env.TOMATO_EMBEDDING_BACKEND ?? "onnx-auto",
    },
    dataset: args.dataset,
    datasetHash: sha256File(join(args.datasetDir, "manifest.json")),
    profile: profile.name,
    profileHash: sha256File(args.profilePath),
    fingerprints: { retrieval: profileFingerprint(profile.retrieval), policy: profileFingerprint(profile.policy), answer: profileFingerprint(profile.answer) },
    client: args.client,
    runs: args.runs,
    ...output.manifest,
  };
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
  writeFileSync(join(dir, "runs.jsonl"), `${output.runs.map((run) => JSON.stringify(run)).join("\n")}\n`);
  writeFileSync(join(dir, "summary.json"), JSON.stringify(output.summary, null, 2));
  console.log(`\n[${suite}] ${profile.name} → ${dir}`);
  console.log(JSON.stringify(output.summary, null, 2));
  return dir;
}
