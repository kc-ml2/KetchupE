// @vitest-environment node
import { describe, expect, it } from "vitest";
import { sanitizeTelemetry } from "./telemetry-gateway.ts";

describe("telemetry gateway", () => {
  it("redacts common secrets and identifiers recursively", () => {
    expect(sanitizeTelemetry({
      input: "a@b.com 010-1234-5678 Bearer abc.def sk-live_123456789012 /Users/me/secret.txt C:\\Users\\me\\secret.txt",
      apiKey: "plain-value",
    })).toEqual({
      input: "[EMAIL] [PHONE] Bearer [SECRET] [SECRET] [PATH] [PATH]",
      apiKey: "[SECRET]",
    });
  });
});
