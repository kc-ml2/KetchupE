// 그룹 멤버 타입
export interface Member {
  id: string;
  name: string;
  email?: string;
  role: "관리자" | "멤버" | "초대 대기";
  color: string;
}

// 업로드된 폴더 타입
export interface Folder {
  id: string;
  name: string;
  fileCount: number;
  size: string;
  date: string;
}

// 그룹 기본 정보 (목록용)
export interface GroupSummary {
  id: string;
  name: string;
  color?: string;
}

// 그룹 상세 정보
export interface GroupDetail {
  id: string;
  name: string;
  members: Member[];
  folders: Folder[];
}

// 초대할 멤버 타입
export interface PendingInvite {
  name: string;
  email: string;
}
