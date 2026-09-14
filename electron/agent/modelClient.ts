import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { APICallError, generateText, streamText, tool } from "ai";
import type { ZodType } from "zod";
import {
  AgentError,
  PolicyDecisionSchema,
  VerificationResultSchema,
  type AgentErrorCode,
  type AnswerEvent,
  type AnswerInput,
  type PolicyDecision,
  type PolicyProfile,
  type PolicyState,
  type VerificationResult,
  type VerifyInput,
} from "./contracts.ts";
import { buildAnswerMessages, buildPolicyMessages, buildVerifyMessages } from "./policy.ts";

export const DEFAULT_LITELLM_BASE_URL = "https://centinels.ml2-alpha.com/v1/";

/** Accepts a bare domain, a URL, or a URL with /v1; returns `https://host[/path]/v1/`. */
export function normalizeBaseURL(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return DEFAULT_LITELLM_BASE_URL;
  const withScheme = /^[a-z]+:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const url = new URL(withScheme);
  const path = url.pathname.replace(/\/+$/, "");
  url.pathname = `${path.endsWith("/v1") ? path : `${path}/v1`}/`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

/** GET /models on the OpenAI-compatible gateway. The gateway is already wired to its upstream, so only domain + key are needed. */
export async function listModels(baseURL: string, apiKey: string, signal?: AbortSignal): Promise<string[]> {
  const response = await fetch(new URL("models", normalizeBaseURL(baseURL)), { headers: { Authorization: `Bearer ${apiKey}` }, signal });
  if (response.status === 401 || response.status === 403) throw new AgentError("MODEL_AUTH", "LiteLLM API key가 거부되었습니다.");
  if (!response.ok) throw new AgentError("MODEL_PROTOCOL", `GET /models failed: ${response.status}`);
  const body = (await response.json()) as { data?: Array<{ id?: string }> };
  return (body.data ?? []).map((item) => item.id ?? "").filter(Boolean);
}

/** Explicit alias wins; otherwise the first model the gateway exposes. */
export async function resolveModelAlias(baseURL: string, apiKey: string, explicit?: string): Promise<string> {
  if (explicit?.trim()) return explicit.trim();
  const [first] = await listModels(baseURL, apiKey);
  if (!first) throw new AgentError("MODEL_PROTOCOL", "LiteLLM이 노출하는 모델이 없습니다.");
  return first;
}

export interface ModelClient {
  /** Usage/latency of the most recent call; read by the harness right after each call. */
  lastCall?: ModelCallInfo;
  decide(state: PolicyState, profile: PolicyProfile, signal: AbortSignal): Promise<PolicyDecision>;
  verify(input: VerifyInput, profile: PolicyProfile, signal: AbortSignal): Promise<VerificationResult>;
  streamAnswer(input: AnswerInput, profile: PolicyProfile, signal: AbortSignal): AsyncIterable<AnswerEvent>;
  /** Plain text completion (canvas classify/draft/edit). */
  complete(input: { system?: string; prompt: string; purpose?: ModelCallPurpose }, profile: PolicyProfile, signal: AbortSignal): Promise<string>;
}

export type ModelCallPurpose = "policy" | "verify" | "answer" | "canvas";

export type ModelCallInfo = {
  purpose: ModelCallPurpose;
  modelAlias: string;
  latencyMs: number;
  promptTokens: number;
  completionTokens: number;
  finishReason: string;
};

export type LiteLLMClientOptions = {
  baseURL: string;
  apiKey: string;
  onCall?: (info: ModelCallInfo) => void;
};

export function toAgentError(error: unknown): AgentError {
  if (error instanceof AgentError) return error;
  if (error instanceof Error && error.name === "AbortError") return new AgentError("CANCELLED", "cancelled");
  if (error instanceof Error && error.name === "TimeoutError") return new AgentError("MODEL_TIMEOUT", "model timed out");
  if (APICallError.isInstance(error)) {
    const code: AgentErrorCode = error.statusCode === 401 || error.statusCode === 403 ? "MODEL_AUTH" : "MODEL_PROTOCOL";
    return new AgentError(code, `${error.statusCode ?? ""} ${error.message}`.trim());
  }
  return new AgentError("MODEL_PROTOCOL", error instanceof Error ? error.message : String(error));
}

/** Some gateways answer a forced tool call with JSON text instead. Accept that once. */
function extractJsonObject(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new AgentError("MODEL_PROTOCOL", "model returned neither tool call nor JSON");
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new AgentError("MODEL_PROTOCOL", "model returned invalid JSON");
  }
}

export function createLiteLLMClient(options: LiteLLMClientOptions): ModelClient {
  const self: ModelClient = {} as ModelClient;
  const report = (info: ModelCallInfo) => {
    self.lastCall = info;
    options.onCall?.(info);
  };
  const provider = createOpenAICompatible({
    name: "ketchupe-litellm",
    baseURL: normalizeBaseURL(options.baseURL),
    apiKey: options.apiKey,
    includeUsage: true,
  });

  async function structuredCall<T>(
    purpose: ModelCallPurpose,
    toolName: string,
    description: string,
    schema: ZodType<T>,
    messages: { system: string; prompt: string },
    profile: PolicyProfile,
    signal: AbortSignal,
  ): Promise<T> {
    const startedAt = Date.now();
    try {
      const result = await generateText({
        model: provider(profile.modelAlias),
        system: messages.system,
        prompt: messages.prompt,
        temperature: profile.temperature,
        abortSignal: signal,
        tools: { [toolName]: tool({ description, inputSchema: schema }) },
        toolChoice: { type: "tool", toolName },
      });
      report({
        purpose,
        modelAlias: profile.modelAlias,
        latencyMs: Date.now() - startedAt,
        promptTokens: result.usage.inputTokens ?? 0,
        completionTokens: result.usage.outputTokens ?? 0,
        finishReason: result.finishReason,
      });
      const call = result.toolCalls.find((item) => item.toolName === toolName);
      return (call ? call.input : extractJsonObject(result.text)) as T;
    } catch (error) {
      throw toAgentError(error);
    }
  }

  return Object.assign(self, {
    decide(state, profile, signal) {
      return structuredCall(
        "policy",
        "policy_decision",
        "Choose the next orchestration action with difficulty and probability estimates.",
        PolicyDecisionSchema,
        buildPolicyMessages(state, profile),
        profile,
        signal,
      );
    },
    verify(input, profile, signal) {
      return structuredCall(
        "verify",
        "verification_result",
        "Report whether the evidence supports the claims.",
        VerificationResultSchema,
        buildVerifyMessages(input),
        profile,
        signal,
      );
    },
    async complete(input, profile, signal) {
      const startedAt = Date.now();
      try {
        const result = await generateText({ model: provider(profile.modelAlias), system: input.system, prompt: input.prompt, temperature: profile.temperature, abortSignal: signal });
        report({ purpose: input.purpose ?? "canvas", modelAlias: profile.modelAlias, latencyMs: Date.now() - startedAt, promptTokens: result.usage.inputTokens ?? 0, completionTokens: result.usage.outputTokens ?? 0, finishReason: result.finishReason });
        return result.text;
      } catch (error) {
        throw toAgentError(error);
      }
    },
    async *streamAnswer(input, profile, signal) {
      const startedAt = Date.now();
      const messages = buildAnswerMessages(input);
      try {
        const result = streamText({
          model: provider(profile.modelAlias),
          system: messages.system,
          prompt: messages.prompt,
          temperature: profile.temperature,
          abortSignal: signal,
        });
        for await (const text of result.textStream) yield { type: "text_delta", text };
        const usage = await result.usage;
        const info: ModelCallInfo = {
          purpose: "answer",
          modelAlias: profile.modelAlias,
          latencyMs: Date.now() - startedAt,
          promptTokens: usage.inputTokens ?? 0,
          completionTokens: usage.outputTokens ?? 0,
          finishReason: await result.finishReason,
        };
        report(info);
        yield { type: "completed", promptTokens: info.promptTokens, completionTokens: info.completionTokens };
      } catch (error) {
        throw toAgentError(error);
      }
    },
  } satisfies ModelClient);
}

export type FixtureScript = {
  decide: PolicyDecision[] | ((state: PolicyState) => PolicyDecision);
  answer?: string | ((input: AnswerInput) => string);
  verify?: VerificationResult | ((input: VerifyInput) => VerificationResult);
  /** Text completions for canvas prompts, in call order or by prompt. */
  complete?: string[] | ((prompt: string) => string);
  onCall?: (info: ModelCallInfo) => void;
};

/** Deterministic client for harness tests. */
export function createFixtureClient(script: FixtureScript): ModelClient {
  const queue = Array.isArray(script.decide) ? [...script.decide] : undefined;
  const completions = Array.isArray(script.complete) ? [...script.complete] : undefined;
  const self: ModelClient = {} as ModelClient;
  const report = (purpose: ModelCallPurpose) => {
    self.lastCall = { purpose, modelAlias: "fixture", latencyMs: 0, promptTokens: 0, completionTokens: 0, finishReason: "stop" };
    script.onCall?.(self.lastCall);
  };
  return Object.assign(self, {
    async decide(state) {
      report("policy");
      if (typeof script.decide === "function") return script.decide(state);
      const next = queue?.shift();
      if (!next) throw new AgentError("MODEL_PROTOCOL", "fixture has no more decisions");
      return next;
    },
    async verify(input) {
      report("verify");
      if (!script.verify) return { supported: true, missingClaims: [], confidence: 1 };
      return typeof script.verify === "function" ? script.verify(input) : script.verify;
    },
    async complete(input) {
      report("canvas");
      if (typeof script.complete === "function") return script.complete(input.prompt);
      const next = completions?.shift();
      if (next === undefined) throw new AgentError("MODEL_PROTOCOL", "fixture has no more completions");
      return next;
    },
    async *streamAnswer(input) {
      const text = typeof script.answer === "function" ? script.answer(input) : (script.answer ?? "");
      for (const piece of text.match(/.{1,24}/gsu) ?? []) yield { type: "text_delta", text: piece };
      report("answer");
      yield { type: "completed", promptTokens: 0, completionTokens: 0 };
    },
  } satisfies ModelClient);
}
