// @vitest-environment node
import { expect, it } from "vitest";
import { normalizeMaruFindResult } from "./maru.ts";

it("keeps signed download URLs out of MARU prompt and trace material", () => {
  const signedUrl = "https://maru.ml2-alpha.com/download/report.pdf?token=top-secret-signature";
  const normalized = normalizeMaruFindResult({
    result_kind: "matches",
    results: [{
      path: "규정/report.pdf",
      type: "file",
      matched_in: ["content"],
      matches: [{ line: 3, text: "연차는 수당으로 정산한다." }],
      size: 1234,
      modified_at: "2026-09-17T00:00:00Z",
      storage_id: "storage-1",
      storage_name: "공유문서",
      download: { status: "ready", url: signedUrl, expires_at: "2026-09-17T00:05:00Z" },
    }],
  });

  expect(normalized.documents).toEqual([expect.objectContaining({ provider: "maru", storageId: "storage-1", path: "규정/report.pdf" })]);
  expect(normalized.summary).toContain("ref_id");
  expect(normalized.summary).toContain("expires_at");
  expect(normalized.summary).not.toContain(signedUrl);
  expect(normalized.summary).not.toContain("top-secret-signature");
});

it("does not echo an unrecognized MARU result that may contain a URL", () => {
  const normalized = normalizeMaruFindResult("download https://maru.ml2-alpha.com/file?token=secret");
  expect(normalized.documents).toEqual([]);
  expect(normalized.summary).toContain("unsupported");
  expect(normalized.summary).not.toContain("token=secret");
});
