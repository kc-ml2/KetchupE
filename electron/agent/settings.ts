import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { safeStorage } from "electron";
import { DEFAULT_LITELLM_BASE_URL, normalizeBaseURL } from "./modelClient.ts";

/** modelAlias is optional: empty means "first model the gateway lists". */
export type ModelSettings = { baseURL: string; modelAlias: string; apiKey?: string };
type StoredSettings = { baseURL: string; modelAlias?: string; apiKeyEncrypted?: string };

const FILE_NAME = "model-settings.json";

export const TELEMETRY_CONTENT_MODES = ["ops", "redacted_eval", "internal_full"] as const;
export type TelemetryContentMode = (typeof TELEMETRY_CONTENT_MODES)[number];

/** Service-owned telemetry. Official builds bake these values in; end users cannot replace the collector. */
export type TelemetrySettings = {
  endpoint: string;
  token?: string;
  contentMode: TelemetryContentMode;
  environment: string;
  tenantId: string;
  /** Policy variant override; empty → deterministic assignment by install id. */
  variant: string;
};

export function loadTelemetrySettings(): TelemetrySettings {
  const requestedMode = process.env.KETCHUPE_TELEMETRY_CONTENT_MODE;
  const contentMode = TELEMETRY_CONTENT_MODES.includes(requestedMode as TelemetryContentMode)
    ? requestedMode as TelemetryContentMode
    : "ops";
  return {
    endpoint: (process.env.KETCHUPE_OTLP_ENDPOINT ?? "").trim(),
    token: process.env.KETCHUPE_OTLP_TOKEN?.trim() || undefined,
    contentMode,
    environment: process.env.KETCHUPE_ENVIRONMENT?.trim() || "production",
    tenantId: process.env.KETCHUPE_TENANT_ID?.trim() || "public",
    variant: process.env.KETCHUPE_VARIANT ?? "",
  };
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
