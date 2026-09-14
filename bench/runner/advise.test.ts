// @vitest-environment node
import { describe, expect, it } from "vitest";
import { recommend } from "./advise.ts";

describe("benchmark advisor", () => {
  it("proposes isolated experiments from the first failing stages and budgets", () => {
    const advice = recommend([
      { manifest: { suite: "retrieval" }, summary: { "recall@8": 0.5, latencyP95: 900 } },
      { manifest: { suite: "agent" }, summary: { failureStages: { generation: 2, retrieval: 1 }, rssMbP95: 700 } },
    ], { latencyMs: 500, rssMb: 512 });
    expect(advice.map((item) => item.axis)).toEqual(expect.arrayContaining(["retrieval", "answer", "resource"]));
    expect(advice.find((item) => item.axis === "retrieval")?.experiment).toContain("하나만 변경");
  });
});
