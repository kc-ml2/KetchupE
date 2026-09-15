import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { AgentStreamEvent, CollectionSummary } from "../../src/app-types/Agent.types.ts";
import { CollectionWatchers } from "../collectionWatchers.ts";
import { openAgentDb } from "../db/openAgentDb.ts";
import { PIPELINE_PROFILE, type Collection } from "../tomato/tomato.ts";
import { TomatoClient } from "../tomato/tomatoClient.ts";
import { AgentError } from "./contracts.ts";
import { Harness } from "./harness.ts";
import { CanvasFlow } from "./canvas/flow.ts";
import { routeMessage } from "./router.ts";
import type { StartRunInput, StartRunResult } from "../../src/app-types/Agent.types.ts";
import { findOpenRun } from "./store.ts";
import { createLiteLLMClient, listModels, resolveModelAlias, type ModelClient } from "./modelClient.ts";
import { ANSWER_PROMPT_VERSION, assignVariant, POLICY_VARIANTS } from "./policy.ts";
import { loadModelSettings, loadTelemetrySettings, saveModelSettings, type ModelSettings } from "./settings.ts";
import { interactionScore, LangfuseExporter, loadInstallId } from "./telemetry.ts";
import type { InteractionKind } from "../../src/app-types/Agent.types.ts";
import { ensureWorkspace, inactiveCollections } from "./store.ts";
import { MaruClient } from "./maru.ts";

export const DEFAULT_RETRIEVAL = { mode: "hybrid", topK: 8 } as const;

export type AgentRuntime = {
  db: DatabaseSync;
  tomato: TomatoClient;
  watchers: CollectionWatchers;
  harness: Harness;
  canvas: CanvasFlow;
  /** Routes a new message to the agent harness or the canvas flow; resumes an ASK-waiting agent run. */
  startMessage: (input: StartRunInput) => Promise<StartRunResult>;
  collections: () => Collection[];
  refreshCollections: () => Promise<Collection[]>;
  collectionSummaries: (workspaceId: string) => Promise<CollectionSummary[]>;
  settings: () => ModelSettings;
  updateSettings: (settings: ModelSettings) => void;
  listModels: () => Promise<string[]>;
  resolvedModelAlias: () => Promise<string>;
  telemetry: LangfuseExporter;
  variant: string;
  variants: string[];
  recordInteractionScore: (runId: string, kind: InteractionKind) => void;
  stop: () => Promise<void>;
};

export type RuntimeOptions = {
  userData: string;
  workerPath: string;
  appVersion: string;
  emitAgentEvent: (event: AgentStreamEvent) => void;
  emitCollectionsChanged: () => void;
};

/** Model client that reads the current settings on every call so the settings screen takes effect immediately.
 *  The gateway is already wired to its upstream model, so an empty alias resolves to the first model it lists. */
function settingsBackedModelClient(settings: () => ModelSettings, resolvedAlias: () => Promise<string>): ModelClient {
  const client = async () => {
    const current = settings();
    if (!current.apiKey) throw new AgentError("MODEL_AUTH", "LiteLLM 도메인과 API key를 설정에서 입력하세요.");
    return { client: createLiteLLMClient({ baseURL: current.baseURL, apiKey: current.apiKey }), modelAlias: await resolvedAlias() };
  };
  const self: ModelClient = {
    decide: async (state, profile, signal) => {
      const { client: live, modelAlias } = await client();
      const decision = await live.decide(state, { ...profile, modelAlias }, signal);
      self.lastCall = live.lastCall;
      return decision;
    },
    verify: async (input, profile, signal) => {
      const { client: live, modelAlias } = await client();
      const result = await live.verify(input, { ...profile, modelAlias }, signal);
      self.lastCall = live.lastCall;
      return result;
    },
    async *streamAnswer(input, profile, signal) {
      const { client: live, modelAlias } = await client();
      yield* live.streamAnswer(input, { ...profile, modelAlias }, signal);
      self.lastCall = live.lastCall;
    },
    async complete(input, profile, signal) {
      const { client: live, modelAlias } = await client();
      const text = await live.complete(input, { ...profile, modelAlias }, signal);
      self.lastCall = live.lastCall;
      return text;
    },
  };
  return self;
}

export function startAgentRuntime(options: RuntimeOptions): AgentRuntime {
  const db = openAgentDb(join(options.userData, "agent.sqlite"));
  ensureWorkspace(db);
  const tomato = new TomatoClient(options.workerPath, join(options.userData, "tomato"));
  let current = loadModelSettings(options.userData);
  const telemetrySettings = loadTelemetrySettings();
  const installId = loadInstallId(options.userData);
  // Variant is fixed for the process lifetime so every run in a session lands in one arm.
  const variant = assignVariant(installId, telemetrySettings.variant);
  const policyProfile = POLICY_VARIANTS[variant];
  const telemetry = new LangfuseExporter(db, () => telemetrySettings, { installId, appVersion: options.appVersion, os: process.platform });
  let collections: Collection[] = [];
  let aliasCache: { key: string; alias: string } | undefined;
  const resolvedModelAlias = async () => {
    const key = `${current.baseURL}\u0000${current.modelAlias}\u0000${current.apiKey ?? ""}`;
    if (aliasCache?.key !== key) aliasCache = { key, alias: await resolveModelAlias(current.baseURL, current.apiKey ?? "", current.modelAlias) };
    return aliasCache.alias;
  };

  const watchers = new CollectionWatchers(tomato, () => options.emitCollectionsChanged(), (result) => telemetry.indexSync(result));
  const harnessModel = settingsBackedModelClient(() => current, resolvedModelAlias);
  const maruToken = process.env.MARU_API_TOKEN?.trim();
  const harness = new Harness({
    db,
    model: harnessModel,
    tools: {
      search: (query, names) => tomato.search(query, { collections: names, mode: DEFAULT_RETRIEVAL.mode, limit: DEFAULT_RETRIEVAL.topK }),
      neighbors: (chunkId, before, after) => tomato.getNeighbors(chunkId, before, after),
      ...(maruToken ? { maru: new MaruClient(maruToken, options.appVersion) } : {}),
    },
    profiles: {
      retrieval: { ...PIPELINE_PROFILE, ...DEFAULT_RETRIEVAL },
      policy: { ...policyProfile, modelAlias: current.modelAlias || "gateway-default" },
      answer: { modelAlias: current.modelAlias || "gateway-default", promptVersion: ANSWER_PROMPT_VERSION, temperature: 0 },
    },
    activeCollections: (workspaceId) => {
      const inactive = inactiveCollections(db, workspaceId);
      return collections.map((collection) => collection.name).filter((name) => !inactive.has(name));
    },
    emit: options.emitAgentEvent,
    runMetadata: { variant, appVersion: options.appVersion, installId },
    onRunSettled: (runId) => telemetry.exportRun(db, runId),
  });
  telemetry.appSession(variant);

  const canvas = new CanvasFlow({
    db,
    model: harnessModel,
    retrieval: {
      search: (query, names, limit) => tomato.search(query, { collections: names, mode: DEFAULT_RETRIEVAL.mode, limit }),
      getChunks: (ids) => tomato.getChunks(ids),
      listSources: (names) => tomato.listSources(names),
      getSourceChunks: (sourceId) => tomato.getSourceChunks(sourceId),
    },
    profile: { ...policyProfile, modelAlias: current.modelAlias || "gateway-default" },
    activeCollections: (workspaceId) => {
      const inactive = inactiveCollections(db, workspaceId);
      return collections.map((collection) => collection.name).filter((name) => !inactive.has(name));
    },
    emit: options.emitAgentEvent,
    onRunSettled: (runId) => telemetry.exportRun(db, runId),
  });

  const refreshCollections = async () => {
    collections = await tomato.call("listCollections", []);
    return collections;
  };

  void refreshCollections()
    .then((list) => {
      watchers.start(list);
      for (const collection of list) watchers.requestSync(collection.name);
    })
    .catch((error) => console.warn("[agent] tomato unavailable at startup:", error));

  return {
    db,
    tomato,
    watchers,
    harness,
    canvas,
    async startMessage(input) {
      const open = findOpenRun(db, input.threadId);
      const forced = input.mode === "doc" ? "doc" : input.mode === "chat" ? "chat" : undefined;
      const route = open ? "chat" : forced ?? (await routeMessage(harnessModel, { ...policyProfile, modelAlias: current.modelAlias || "gateway-default" }, input.text, new AbortController().signal));
      const result = route === "doc"
        ? { runId: canvas.start({ workspaceId: input.workspaceId, threadId: input.threadId, instruction: input.text }).runId, kind: "canvas" as const }
        : { runId: harness.startRun(input).runId, kind: "agent" as const };
      telemetry.exportRun(db, result.runId); // queues a marker so a crash can be exported after restart
      return result;
    },
    collections: () => collections,
    refreshCollections,
    settings: () => current,
    updateSettings: (settings) => {
      saveModelSettings(options.userData, settings);
      current = loadModelSettings(options.userData);
      aliasCache = undefined;
    },
    listModels: () => (current.apiKey ? listModels(current.baseURL, current.apiKey) : Promise.resolve([])),
    resolvedModelAlias,
    telemetry,
    variant,
    variants: Object.keys(POLICY_VARIANTS),
    recordInteractionScore: (runId, kind) => telemetry.score(interactionScore(runId, kind)),
    async collectionSummaries(workspaceId) {
      const inactive = inactiveCollections(db, workspaceId);
      const status = await tomato.call("status", []);
      return status.map((item) => {
        const state = watchers.state(item.name);
        return {
          name: item.name,
          path: item.path,
          active: !inactive.has(item.name),
          sources: item.sources,
          chunks: item.chunks,
          embedded: item.embedded,
          syncing: state?.syncing ?? false,
          lastError: state?.lastError,
        };
      });
    },
    stop: async () => {
      watchers.stop();
      tomato.stop();
      await telemetry.stop();
      db.close();
    },
  };
}
