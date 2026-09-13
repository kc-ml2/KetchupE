// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createFixtureClient } from "./modelClient.ts";
import { DEFAULT_POLICY_PROFILE } from "./policy.ts";
import { looksLikeAuthoring, routeMessage } from "./router.ts";

const signal = new AbortController().signal;

describe("router", () => {
  it("keeps ordinary questions on chat without a model call", async () => {
    let calls = 0;
    const model = createFixtureClient({ decide: [], complete: () => { calls += 1; return "doc"; } });
    expect(await routeMessage(model, DEFAULT_POLICY_PROFILE, "퇴직 전 연차는 어떻게 정산하나?", signal)).toBe("chat");
    expect(await routeMessage(model, DEFAULT_POLICY_PROFILE, "계약서에서 해지 조항 알려줘", signal)).toBe("chat");
    expect(calls).toBe(0);
  });

  it("lets the model decide when authoring words appear, with keyword fallback", async () => {
    expect(looksLikeAuthoring("A사와 용역 계약서 작성해줘")).toBe(true);
    expect(await routeMessage(createFixtureClient({ decide: [], complete: ["doc"] }), DEFAULT_POLICY_PROFILE, "A사와 용역 계약서 작성해줘", signal)).toBe("doc");
    expect(await routeMessage(createFixtureClient({ decide: [], complete: ["chat"] }), DEFAULT_POLICY_PROFILE, "계약서 작성 절차가 어떻게 돼?", signal)).toBe("chat");
    expect(await routeMessage(createFixtureClient({ decide: [] }), DEFAULT_POLICY_PROFILE, "워크숍 기안서 만들어줘", signal)).toBe("doc");
  });
});
