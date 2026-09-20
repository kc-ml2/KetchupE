// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { createLiteLLMClient } from "./modelClient.ts";
import { DEFAULT_POLICY_PROFILE } from "./policy.ts";

afterEach(() => vi.unstubAllGlobals());

it("omits temperature from LiteLLM requests", async () => {
  let body: Record<string, unknown> | undefined;
  vi.stubGlobal("fetch", vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
    body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({
      choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }), { status: 200, headers: { "content-type": "application/json" } });
  }));

  const client = createLiteLLMClient({ baseURL: "https://gateway.example.com/v1/", apiKey: "test" });
  await expect(client.complete({ prompt: "hello" }, DEFAULT_POLICY_PROFILE, new AbortController().signal)).resolves.toBe("ok");
  expect(body).not.toHaveProperty("temperature");
});
