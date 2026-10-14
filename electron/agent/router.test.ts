// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createFixtureClient } from "./modelClient.ts";
import { DEFAULT_POLICY_PROFILE as profile } from "./policy.ts";
import { CHAT_ROUTE, DOC_ROUTE, routeMessage } from "./router.ts";
const signal = new AbortController().signal;
describe("semantic workflow routing", () => {
  it("offers all manifests even without keyword matches", async () => {
    let prompt = "";
    const model = createFixtureClient({ decide: [], complete: (input) => { prompt = input; return "summary"; } });
    const routes = [CHAT_ROUTE, DOC_ROUTE, { id: "summary", description: "요약", matches: () => false, examples: ["핵심만 정리"], requiredInputs: ["원문"] }];
    expect(await routeMessage(model, profile, "짧게 줄여줘", signal, routes, { recentUserMessages: ["이 문서"] })).toBe("summary");
    for (const text of ["- doc:", "- summary:", "핵심만 정리", "원문", "이 문서"]) expect(prompt).toContain(text);
  });
  it("honors model choices for questions and execution requests", async () => {
    const model = createFixtureClient({ decide: [], complete: ["chat", "doc"] });
    expect(await routeMessage(model, profile, "계약서 작성 절차는?", signal)).toBe("chat");
    expect(await routeMessage(model, profile, "상대방에게 보낼 초안 준비해", signal)).toBe("doc");
  });
  it("never starts an arbitrary workflow on invalid or failed routing", async () => {
    await expect(routeMessage(createFixtureClient({ decide: [], complete: ["unknown"] }), profile, "실행해", signal)).rejects.toThrow("결정하지 못");
    await expect(routeMessage(createFixtureClient({ decide: [] }), profile, "실행해", signal)).rejects.toThrow("연결하지 못");
  });
  it("supports explicit installed IDs without a model and rejects unknown IDs", async () => {
    const model = createFixtureClient({ decide: [] });
    expect(await routeMessage(model, profile, "$doc 초안 작성", signal)).toBe("doc");
    await expect(routeMessage(model, profile, "$missing 실행", signal)).rejects.toThrow("등록되지 않은");
  });
});
