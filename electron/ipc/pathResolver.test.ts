import { describe, expect, it } from "vitest";
import {
  createOpenPathCandidates,
  normalizeInputPath,
  shouldSearchNestedByLeafName,
} from "./pathResolver";

describe("pathResolver", () => {
  it("normalizes Windows file URLs", () => {
    expect(
      normalizeInputPath("file:///Z:/team/docs/test.md", "win32"),
    ).toBe("Z:\\team\\docs\\test.md");
  });

  it("tries the original Windows drive path before remapped drive paths", () => {
    const candidates = createOpenPathCandidates(
      "Z:\\team\\docs\\test.md",
      "win32",
      ["F:\\", "Z:\\"],
    );

    expect(candidates).toEqual([
      "Z:\\team\\docs\\test.md",
      "F:\\team\\docs\\test.md",
    ]);
  });

  it("handles Windows paths that use URL-style slashes", () => {
    const candidates = createOpenPathCandidates("z://testtest.md", "win32", [
      "F:\\",
    ]);

    expect(candidates).toEqual(["z:\\testtest.md", "F:\\testtest.md"]);
  });

  it("maps UNC share paths to mapped Windows drive roots", () => {
    const candidates = createOpenPathCandidates(
      "\\\\server\\share\\team\\docs\\test.md",
      "win32",
      ["F:\\"],
    );

    expect(candidates).toEqual([
      "\\\\server\\share\\team\\docs\\test.md",
      "F:\\team\\docs\\test.md",
    ]);
  });

  it("searches relative paths under all Windows drive roots", () => {
    const candidates = createOpenPathCandidates("team/docs/test.md", "win32", [
      "C:\\",
      "F:\\",
    ]);

    expect(candidates).toEqual([
      "C:\\team\\docs\\test.md",
      "F:\\team\\docs\\test.md",
    ]);
  });

  it("remaps macOS volume paths across mounted volumes", () => {
    const candidates = createOpenPathCandidates(
      "/Volumes/TeamDrive/team/docs/test.md",
      "darwin",
      ["/Volumes/OtherDrive", "/Users/me/Documents"],
    );

    expect(candidates).toEqual([
      "/Volumes/TeamDrive/team/docs/test.md",
      "/Volumes/OtherDrive/team/docs/test.md",
    ]);
  });

  it("enables nested leaf-name fallback only when a path has parent context", () => {
    expect(shouldSearchNestedByLeafName("team/test.md", "darwin")).toBe(true);
    expect(shouldSearchNestedByLeafName("team\\test.md", "win32")).toBe(true);
    expect(shouldSearchNestedByLeafName("test.md", "darwin")).toBe(false);
    expect(shouldSearchNestedByLeafName("test.md", "win32")).toBe(false);
  });
});
