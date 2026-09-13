import { createLiteLLMClient, DEFAULT_LITELLM_BASE_URL, resolveModelAlias, type ModelClient } from "../../electron/agent/modelClient.ts";
import type { PolicyState } from "../../electron/agent/contracts.ts";
import { alwaysSearchDecision } from "../../electron/agent/policy.ts";

/** Fixed baseline: always search once with the user goal, then answer. No estimates, no ASK/VERIFY. */
export function alwaysSearchClient(answer: (state: PolicyState) => string = () => ""): ModelClient {
  return {
    async decide(state) {
      return alwaysSearchDecision(state, "always-search-1");
    },
    async verify() {
      return { supported: true, missingClaims: [], confidence: 0.5 };
    },
    async complete() {
      return "";
    },
    async *streamAnswer(input) {
      yield { type: "text_delta", text: answer(input as unknown as PolicyState) || `${input.evidence.map((item) => `${item.snippet} [[${item.evidenceId}]]`).join("\n")}` };
      yield { type: "completed", promptTokens: 0, completionTokens: 0 };
    },
  };
}

/** Bench profiles may leave the alias as a placeholder; the gateway's first model is used then. */
export async function benchModelAlias(explicit: string): Promise<string> {
  const apiKey = process.env.LITELLM_API_KEY;
  if (!apiKey || !explicit.startsWith("<")) return explicit;
  return resolveModelAlias(process.env.LITELLM_BASE_URL ?? DEFAULT_LITELLM_BASE_URL, apiKey, process.env.LITELLM_MODEL_ALIAS);
}

export function benchModelClient(kind: string): ModelClient {
  if (kind === "always-search") return alwaysSearchClient();
  if (kind === "litellm") {
    const apiKey = process.env.LITELLM_API_KEY;
    if (!apiKey) throw new Error("LITELLM_API_KEY is required for --client litellm");
    return createLiteLLMClient({ baseURL: process.env.LITELLM_BASE_URL ?? DEFAULT_LITELLM_BASE_URL, apiKey });
  }
  throw new Error(`unknown client: ${kind}`);
}
