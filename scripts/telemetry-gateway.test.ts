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

  it("keeps OTLP nanosecond timestamps, which contain phone-shaped digit runs", () => {
    const span = { startTimeUnixNano: "1790920781563000000", endTimeUnixNano: "1790920781587000000", traceId: "f7c0e6a78e4d46e08d6a70fbb404c612" };
    expect(sanitizeTelemetry(span)).toEqual(span);
  });
});
