// @vitest-environment node
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { openAgentDb } from "../db/openAgentDb.ts";
import { WorkSources } from "./sources.ts";
import { listProfiles, saveProfile } from "./profiles.ts";

let folder: string; let db: DatabaseSync; let sources: WorkSources;
beforeEach(async () => { folder = await mkdtemp(join(tmpdir(), "work-source-")); db = openAgentDb(":memory:"); sources = new WorkSources(db); });
afterEach(async () => { db.close(); await rm(folder, { recursive: true, force: true }); });

it("registers references without copying, discovers nested XLSX files and detects changed bytes", async () => {
  const root = join(folder, "selected"); await mkdir(join(root, "nested"), { recursive: true });
  await writeFile(join(root, "nested", "data.xlsx"), "first");
  await writeFile(join(root, "~$locked.xlsx"), "lock");
  const [source] = await sources.register([root], "folder");
  const files = await sources.files(source.id);
  expect(files.map((file) => file.name)).toEqual(["data.xlsx"]);
  const before = await sources.read(files[0]);
  await writeFile(join(root, "nested", "data.xlsx"), "second");
  expect((await sources.read(files[0])).fingerprint).not.toBe(before.fingerprint);
  expect((await sources.register([root], "folder"))).toHaveLength(1);
  sources.remove(source.id);
  await expect(sources.read(files[0])).rejects.toThrow("연결이 해제");
});

it("rejects traversal, absolute paths, symlink escapes and sibling files outside a selected file", async () => {
  const root = join(folder, "selected"); await mkdir(root);
  const outside = join(folder, "private.xlsx"); await writeFile(outside, "outside");
  await symlink(outside, join(root, "linked.xlsx"));
  const [source] = await sources.register([root], "folder");
  for (const path of ["../private.xlsx", outside, "linked.xlsx"]) await expect(sources.read({ sourceId: source.id, relativePath: path, name: "ignored" })).rejects.toThrow();
  expect(await sources.files(source.id)).toEqual([]);
  const all = await sources.register([outside], "file");
  const fileSource = all.find((item) => item.kind === "file")!;
  await expect(sources.read({ sourceId: fileSource.id, relativePath: "other.xlsx", name: "ignored" })).rejects.toThrow();
});

it("persists mappings and rejects stale updates instead of overwriting a newer revision", () => {
  const profile = saveProfile(db, { id: "", revision: 0, name: "ERP", mapping: { sheet: "내역", headerRow: 1, firstDataRow: 2, columns: [{ field: "accountId", header: "계좌", type: "text", required: true }], filters: [] } }, "hash");
  expect(listProfiles(db)).toEqual([profile]);
  expect(saveProfile(db, profile, "hash").revision).toBe(2);
  expect(() => saveProfile(db, profile, "hash")).toThrow("변경되었거나");
});
