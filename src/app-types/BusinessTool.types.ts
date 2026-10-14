import type { WorkFile } from "./WorkSource.types";

/** `multiple` lets a file field take several files (e.g. one bank statement per account). */
export type BusinessField = { key: string; label: string; type: "file" | "date" | "text"; required: boolean; multiple?: boolean };
export type BusinessInput = { values: Record<string, string>; files: Record<string, WorkFile[]> };
export type BusinessAction = {
  id: string; type: "business_tool"; title: string; question: string;
  fields: BusinessField[]; input: BusinessInput; lockedKeys?: string[];
};
export type BusinessArtifact = { id: string; runId: string; name: string; toolId: string; version: string };
export interface BusinessToolAPI {
  submitBusinessInput(runId: string, actionId: string, input: BusinessInput): Promise<void>;
  listBusinessArtifacts(threadId: string): Promise<BusinessArtifact[]>;
  openBusinessArtifact(id: string): Promise<void>;
}
