// Inspect local agent trajectories (state → decision → observation → outcome) straight from agent.sqlite.
// Usage: node scripts/trajectory.ts [--db <agent.sqlite>] [--run <runId>] [--limit 20] [--json]
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";
import { readTrace, transitions } from "../electron/agent/trace.ts";

const APP_NAME = "케찹이";
function defaultDbPath(): string {
  if (platform() === "darwin") return join(homedir(), "Library", "Application Support", APP_NAME, "agent.sqlite");
  if (platform() === "win32") return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), APP_NAME, "agent.sqlite");
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), APP_NAME, "agent.sqlite");
}

const { values } = parseArgs({
  options: {
    db: { type: "string", default: defaultDbPath() },
    run: { type: "string" },
    limit: { type: "string", default: "20" },
    json: { type: "boolean", default: false },
  },
});
const db = new DatabaseSync(values.db, { readOnly: true });

if (!values.run) {
  const rows = db.prepare(`
    SELECT r.id, r.status, r.error_code, r.created_at, substr(r.goal, 1, 40) AS goal,
      (SELECT COUNT(*) FROM trace_events t WHERE t.run_id = r.id AND t.type = 'policy.decided') AS steps,
      (SELECT group_concat(kind) FROM interaction_events i WHERE i.run_id = r.id) AS interactions
    FROM runs r ORDER BY r.created_at DESC LIMIT ?
  `).all(Number(values.limit));
  if (values.json) console.log(JSON.stringify(rows, null, 2));
  else console.table(rows);
  process.exit(0);
}

const runId = values.run;
const steps = transitions(db, runId).map((transition, index) => ({
  step: index + 1,
  action: transition.decision.action,
  reason: transition.decision.reasonCode,
  difficulty: transition.decision.taskDifficulty,
  pSuccess: transition.decision.predictedSuccess,
  evidence: transition.state.evidence.length,
  detail: transition.decision.search?.query ?? transition.decision.search?.evidenceId ?? transition.decision.question ?? transition.decision.stopReason ?? "",
  observation: transition.observation?.kind ?? "",
  outcome: transition.outcome ?? "",
}));
const events = readTrace(db, runId);
const models = events.filter((event) => event.type === "model.completed").map((event) => ({ purpose: event.payload.purpose, latencyMs: event.payload.latencyMs }));
const tools = events.filter((event) => event.type === "tool.completed").map((event) => ({ tool: event.payload.tool, cached: Boolean(event.payload.cached), observation: event.payload.observation }));
const answer = events.find((event) => event.type === "answer.validated")?.payload;
const failure = events.find((event) => event.type === "run.failed")?.payload;

if (values.json) {
  console.log(JSON.stringify({ runId, steps, models, tools, answer, failure, events }, null, 2));
} else {
  console.log(`run ${runId}`);
  console.table(steps);
  console.log("model calls:", JSON.stringify(models));
  console.log("tool calls:", JSON.stringify(tools));
  if (answer) console.log("citations:", JSON.stringify(answer));
  if (failure) console.log("failed:", JSON.stringify(failure));
}
