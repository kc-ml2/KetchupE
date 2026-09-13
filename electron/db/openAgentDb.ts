import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { AGENT_SCHEMA } from "./schema.ts";

export function openAgentDb(path: string): DatabaseSync {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  db.exec(AGENT_SCHEMA);
  // runs.kind distinguishes agent runs from canvas (document authoring) runs.
  const columns = (db.prepare("PRAGMA table_info(runs)").all() as Array<{ name: string }>).map((column) => column.name);
  if (!columns.includes("kind")) db.exec("ALTER TABLE runs ADD COLUMN kind TEXT NOT NULL DEFAULT 'agent'");
  const workspaceColumns = (db.prepare("PRAGMA table_info(workspaces)").all() as Array<{ name: string }>).map((column) => column.name);
  if (!workspaceColumns.includes("memory_enabled")) db.exec("ALTER TABLE workspaces ADD COLUMN memory_enabled INTEGER NOT NULL DEFAULT 1");
  const messageColumns = (db.prepare("PRAGMA table_info(messages)").all() as Array<{ name: string }>).map((column) => column.name);
  if (!messageColumns.includes("applied_context")) db.exec("ALTER TABLE messages ADD COLUMN applied_context TEXT");
  // App restart: a run cannot still be running; only waiting_user resumes.
  db.prepare("UPDATE runs SET status = 'cancelled', error_code = 'CANCELLED', finished_at = ? WHERE status = 'running'").run(new Date().toISOString());
  return db;
}
