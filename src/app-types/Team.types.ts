// 팀 멤버 타입 (API: TeamMemberResponse)
export interface TeamMember {
  id: number;
  email: string;
  name: string | null;
  role: "admin" | "member" | "pending";
}

// 폴더 상태 (서버)
export type FolderStatus = "processing" | "completed" | "failed";

// 폴더 업로더 정보
export interface FolderUploader {
  id: number;
  name: string;
  email: string;
}

// /ingest/status 응답
export interface IngestDocument {
  id: string;
  name: string;
  status: string;
  // 폴더(document group) 식별자. TeamFolder.id와 매칭된다.
  group_id: number;
  folder_path: string;
  file_size: number;
  created_at: string;
  updated_at: string;
  error: string | null;
  audit_logs: unknown[];
}

export interface IngestStatusResponse {
  team_id: number;
  documents: IngestDocument[];
  total: number;
}

// 폴더 타입 (API: FolderResponse)
export interface TeamFolder {
  id: number;
  document_id?: string | null;
  name: string;
  document_count: number;
  status: FolderStatus;
  uploaded_by: FolderUploader;
  uploaded_at: string;
  documents?: IngestDocument[];
}

// GET /config 응답 - 업로드 가능한 파일 확장자 목록 (예: ".pdf", ".docx")
export interface ServerConfigResponse {
  supported_extensions: string[];
}

// sync/check 요청
export interface SyncCheckRequest {
  team_id: number;
  folder_path: string;
  files: SyncCheckFileItem[];
}

export interface SyncCheckFileItem {
  relative_path: string;
  file_path?: string;
  absolute_path?: string;
  absolutePath?: string;
  size: number;
  mtime: number;
  fileName?: string;
}

// sync/check 응답
export interface SyncCheckResponse {
  indices_to_upload: number[];
  total: number;
}

// sync/upload 응답
export interface SyncUploadResponse {
  document_group_id: number;
  name: string;
  status: FolderStatus;
  uploaded_by: FolderUploader;
  uploaded_at: string;
}

// /ingest/{document_id}/retry 응답 (API: RetryResponse)
export interface RetryResponse {
  document_id: string;
  name: string;
  // "queued" | "active" | "error" 등 (작업 큐 유무에 따라 달라짐)
  status: string;
  error: string | null;
}

// group retry 항목 (API: RetryItem)
export interface RetryItem {
  document_id: string;
  name: string;
}

// /ingest/groups/{group_id}/retry 응답 (API: GroupRetryResponse)
export interface GroupRetryResponse {
  group_id: number;
  requeued: RetryItem[];
  count: number;
  skipped: number;
}

// 팀 목록용 (API: TeamSummaryResponse)
export interface TeamSummary {
  id: number;
  name: string;
  // 팀 설명 (선택값, 미지정 시 null)
  description: string | null;
  role: "admin" | "member";
}

// 팀 상세 (API: TeamDetailResponse)
export interface TeamDetail {
  id: number;
  name: string;
  // 팀 설명 (선택값, 미지정 시 null)
  description: string | null;
  members: TeamMember[];
  folders: TeamFolder[];
}

// 초대 요청 (API: InviteMemberRequest)
// 이메일만 받는다. 표시명(name)은 초대받은 사용자가 직접 설정한다.
export interface InviteMemberRequest {
  email: string;
}

// 팀 생성 요청 (API: CreateTeamRequest)
export interface CreateTeamRequest {
  name: string;
  // 팀 설명 (선택값, 생략하거나 null이면 설명 없이 생성)
  description?: string | null;
}
