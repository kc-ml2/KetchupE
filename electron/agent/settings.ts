import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { safeStorage } from "electron";
import { DEFAULT_LITELLM_BASE_URL, normalizeBaseURL } from "./modelClient.ts";

/** modelAlias is optional: empty means "first model the gateway lists". */
export type ModelSettings = { baseURL: string; modelAlias: string; apiKey?: string };
type StoredSettings = { baseURL: string; modelAlias?: string; apiKeyEncrypted?: string };

const FILE_NAME = "model-settings.json";
const TELEMETRY_FILE_NAME = "telemetry.json";

function encryptSecret(value: string): string {
  if (!safeStorage.isEncryptionAvailable()) throw new Error("이 환경에서는 비밀 값을 안전하게 저장할 수 없습니다.");
  return safeStorage.encryptString(value).toString("base64");
}

function decryptSecret(encrypted?: string): string | undefined {
  if (!encrypted || !safeStorage.isEncryptionAvailable()) return undefined;
  try {
    return safeStorage.decryptString(Buffer.from(encrypted, "base64"));
  } catch {
    return undefined;
  }
}

function readJson<T>(path: string): T | undefined {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return undefined;
  }
}

export type TelemetrySettings = {
  enabled: boolean;
  host: string;
  publicKey: string;
  secretKey?: string;
  /** Who this install is for Langfuse's user views (e-mail or name); empty → anonymous install id. */
  userId: string;
  /** Send question/answer/context/retrieval evidence text; off by default (hashes only). */
  includeContent: boolean;
  /** Policy variant override; empty → deterministic assignment by install id. */
  variant: string;
};
type StoredTelemetry = Omit<TelemetrySettings, "secretKey"> & { secretKeyEncrypted?: string };

export function loadTelemetrySettings(userData: string): TelemetrySettings {
  const stored = readJson<Partial<StoredTelemetry>>(join(userData, TELEMETRY_FILE_NAME)) ?? {};
  const secretKey = process.env.LANGFUSE_SECRET_KEY ?? decryptSecret(stored.secretKeyEncrypted);
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY ?? stored.publicKey ?? "";
  return {
    enabled: process.env.LANGFUSE_PUBLIC_KEY ? true : (stored.enabled ?? false),
    host: (process.env.LANGFUSE_HOST ?? stored.host ?? "https://cloud.langfuse.com").replace(/\/+$/, ""),
    publicKey,
    secretKey,
    userId: process.env.KETCHUPE_USER_ID ?? stored.userId ?? "",
    includeContent: stored.includeContent ?? false,
    variant: process.env.KETCHUPE_VARIANT ?? stored.variant ?? "",
  };
}

export function saveTelemetrySettings(userData: string, settings: TelemetrySettings): void {
  const path = join(userData, TELEMETRY_FILE_NAME);
  const previous = readJson<StoredTelemetry>(path);
  let secretKeyEncrypted = previous?.secretKeyEncrypted;
  if (settings.secretKey !== undefined) secretKeyEncrypted = settings.secretKey ? encryptSecret(settings.secretKey) : undefined;
  mkdirSync(dirname(path), { recursive: true });
  const stored: StoredTelemetry = {
    enabled: settings.enabled,
    host: settings.host.replace(/\/+$/, ""),
    publicKey: settings.publicKey.trim(),
    userId: settings.userId.trim(),
    includeContent: settings.includeContent,
    variant: settings.variant,
    secretKeyEncrypted,
  };
  writeFileSync(path, JSON.stringify(stored, null, 2));
}

/** Dev: env vars win. Packaged: settings file with the key encrypted by safeStorage. The key never reaches the renderer or traces. */
export function loadModelSettings(userData: string): ModelSettings {
  let stored: StoredSettings = { baseURL: DEFAULT_LITELLM_BASE_URL, modelAlias: "" };
  try {
    stored = { ...stored, ...(JSON.parse(readFileSync(join(userData, FILE_NAME), "utf8")) as StoredSettings) };
  } catch {
    // first run
  }
  let apiKey: string | undefined;
  if (stored.apiKeyEncrypted && safeStorage.isEncryptionAvailable()) {
    try {
      apiKey = safeStorage.decryptString(Buffer.from(stored.apiKeyEncrypted, "base64"));
    } catch {
      apiKey = undefined;
    }
  }
  return {
    baseURL: normalizeBaseURL(process.env.LITELLM_BASE_URL ?? stored.baseURL),
    modelAlias: process.env.LITELLM_MODEL_ALIAS ?? stored.modelAlias ?? "",
    apiKey: process.env.LITELLM_API_KEY ?? apiKey,
  };
}

export function saveModelSettings(userData: string, settings: ModelSettings): void {
  const path = join(userData, FILE_NAME);
  let previous: StoredSettings | undefined;
  try {
    previous = JSON.parse(readFileSync(path, "utf8")) as StoredSettings;
  } catch {
    previous = undefined;
  }
  let apiKeyEncrypted = previous?.apiKeyEncrypted;
  if (settings.apiKey !== undefined) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error("이 환경에서는 API key를 안전하게 저장할 수 없습니다.");
    apiKeyEncrypted = settings.apiKey ? safeStorage.encryptString(settings.apiKey).toString("base64") : undefined;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ baseURL: normalizeBaseURL(settings.baseURL), modelAlias: settings.modelAlias.trim(), apiKeyEncrypted } satisfies StoredSettings, null, 2));
}
