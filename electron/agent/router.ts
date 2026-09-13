// Message router ported from MARU's graph_router: chat (answer with evidence) vs doc (draft a document canvas).
// Cheap keyword gate first so ordinary questions never pay for a routing call; the model decides only when authoring words appear.
import type { PolicyProfile } from "./contracts.ts";
import type { ModelClient } from "./modelClient.ts";

export type Route = "chat" | "doc";

const ROUTE_OPTIONS = `- chat: 등록된 문서를 검색하거나 일반 대화로 사용자 질문에 답한다 (기본).
- doc: 등록된 문서를 근거로 계약서·기안서·공문·이메일·보고서 등 새 문서의 초안을 작성하고, 블록 단위로 사용자 피드백을 받아 수정한다.`;

const DOC_NOUNS = ["계약서", "기안서", "기안", "품의", "공문", "보고서", "제안서", "이메일", "메일", "초안", "문서", "양식", "안내문", "공지"];
const DOC_VERBS = ["작성", "써", "써줘", "써 줘", "만들", "만들어", "초안", "드래프트", "draft", "write"];

export const routerPrompt = (message: string): string =>
  `다음 사용자 요청을 처리하기에 가장 적합한 그래프를 고르라.

선택지 (id: 설명):
${ROUTE_OPTIONS}

위 id 중 정확히 하나만 출력하라. 다른 텍스트는 절대 출력하지 마라.

사용자 요청: ${message}
선택:`;

/** True when the message mentions both a document noun and an authoring verb. */
export function looksLikeAuthoring(message: string): boolean {
  const text = message.normalize("NFC").toLowerCase();
  return DOC_NOUNS.some((noun) => text.includes(noun)) && DOC_VERBS.some((verb) => text.includes(verb));
}

export async function routeMessage(model: ModelClient, profile: PolicyProfile, message: string, signal: AbortSignal): Promise<Route> {
  if (!looksLikeAuthoring(message)) return "chat";
  try {
    const answer = (await model.complete({ prompt: routerPrompt(message), purpose: "policy" }, profile, signal)).trim().toLowerCase();
    if (/\bdoc\b/.test(answer)) return "doc";
    if (/\bchat\b/.test(answer)) return "chat";
  } catch {
    // fall through to the keyword decision
  }
  return "doc";
}
