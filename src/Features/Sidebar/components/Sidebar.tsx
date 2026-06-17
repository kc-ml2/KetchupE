import { useContext, useEffect, useRef, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { isMobile as isMobileDevice } from "react-device-detect";
import {
  LuMessageSquare,
  LuUsers,
  LuPlus,
  LuSun,
  LuMoon,
  LuLogOut,
  LuPin,
  LuPencil,
} from "react-icons/lu";
import { AuthContext } from "@Contexts/AuthContext";
import { AuthContextType } from "@app-types/AuthContext.types";
import { ThemeContext, ThemeContextType } from "@Contexts/ThemeContext";
import { useTeams } from "@Features/TeamDetail/hooks/useTeams";
import { useProfile } from "@Features/Sidebar/hooks/useProfile";
import { getTeamDisplayName } from "@lib/teamDisplayName";
import { getTeamScopeInfo } from "@lib/teamScopeInfo";
import CreateTeamModal from "./CreateTeamModal";
import EditNameModal from "./EditNameModal";

const SIDEBAR_MIN_WIDTH = 220;
const SIDEBAR_MAX_WIDTH = 420;
const SIDEBAR_DEFAULT_WIDTH = 260;
const SIDEBAR_WIDTH_STORAGE_KEY = "ketchupe.sidebar.width";

const clampSidebarWidth = (width: number): number => {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width));
};

const Sidebar = (): React.JSX.Element => {
  const { teams, createTeam } = useTeams();
  const { updateName } = useProfile();
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isEditNameModalOpen, setIsEditNameModalOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    if (typeof window === "undefined") return SIDEBAR_DEFAULT_WIDTH;
    const saved = Number(
      window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY),
    );
    return Number.isFinite(saved)
      ? clampSidebarWidth(saved)
      : SIDEBAR_DEFAULT_WIDTH;
  });
  const resizeStateRef = useRef<{
    startX: number;
    startWidth: number;
    previousCursor: string;
    previousUserSelect: string;
  } | null>(null);
  const { user, logout } = useContext(AuthContext) as AuthContextType;
  const { theme, setTheme } = useContext(ThemeContext) as ThemeContextType;
  const navigate = useNavigate();
  const location = useLocation();

  const userName = user?.name || user?.email?.split("@")[0] || "사용자";
  const userInitial = userName.charAt(0).toUpperCase();

  const isChatActive = location.pathname === "/chatbot";
  const activeTeamId = location.pathname.startsWith("/team/")
    ? location.pathname.split("/team/")[1]
    : null;

  useEffect(() => {
    window.localStorage.setItem(
      SIDEBAR_WIDTH_STORAGE_KEY,
      String(sidebarWidth),
    );
  }, [sidebarWidth]);

  useEffect(() => {
    if (isMobileDevice) return;

    const handlePointerMove = (event: PointerEvent) => {
      const resizeState = resizeStateRef.current;
      if (!resizeState) return;

      const deltaX = event.clientX - resizeState.startX;
      setSidebarWidth(clampSidebarWidth(resizeState.startWidth + deltaX));
    };

    const stopResize = () => {
      const resizeState = resizeStateRef.current;
      if (!resizeState) return;

      document.body.style.cursor = resizeState.previousCursor;
      document.body.style.userSelect = resizeState.previousUserSelect;
      resizeStateRef.current = null;
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopResize);
    window.addEventListener("pointercancel", stopResize);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("pointercancel", stopResize);
      stopResize();
    };
  }, []);

  const handleResizeStart = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;

    event.preventDefault();
    resizeStateRef.current = {
      startX: event.clientX,
      startWidth: sidebarWidth,
      previousCursor: document.body.style.cursor,
      previousUserSelect: document.body.style.userSelect,
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  return (
    <>
      {!isMobileDevice && (
        <div
          className="flex relative flex-col h-full bg-[#18181B] px-3 py-4 flex-shrink-0"
          style={{ width: `${sidebarWidth}px` }}
        >
          {/* App Header */}
          <div className="flex items-center gap-2.5 h-11 px-1">
            <LuMessageSquare className="w-[22px] h-[22px] text-[#0066FF]" />
            <span className="text-lg font-semibold text-[#FAFAFA]">
              케찹이 팀즈
            </span>
          </div>

          {/* Divider */}
          <div className="h-px w-full bg-[#27272A]" />

          {/* Chat Channel */}
          <div className="flex flex-col gap-1 py-3 w-full">
            {/* <span className="text-[11px] font-medium text-[#71717A] tracking-[0.5px]">
            채널
          </span> */}
            <button
              onClick={() => navigate("/chatbot")}
              className={`flex items-center gap-2.5 h-9 px-2 rounded-md w-full transition-colors ${
                isChatActive ? "bg-[#0066FF]" : "hover:bg-[#27272A]"
              }`}
            >
              <LuMessageSquare
                className={`w-[18px] h-[18px] ${isChatActive ? "text-white" : "text-[#71717A]"}`}
              />
              <span
                className={`text-sm font-medium ${isChatActive ? "text-white" : "text-[#FAFAFA]"}`}
              >
                채팅
              </span>
            </button>
          </div>

          {/* Divider */}
          <div className="h-px w-full bg-[#27272A]" />

          {/* Teams Section */}
          <div className="flex flex-col gap-1 py-3 flex-1 w-full">
            <span className="text-[11px] font-medium text-[#71717A] tracking-[0.5px]">
              내 팀
            </span>
            {teams.map((team) => {
              const isActive = activeTeamId === String(team.id);
              const displayName = getTeamDisplayName(team.name);
              const teamScopeInfo = getTeamScopeInfo(team.name);
              const TeamIcon = teamScopeInfo ? LuPin : LuUsers;
              return (
                <button
                  key={team.id}
                  onClick={() => navigate(`/team/${team.id}`)}
                  className={`group/team relative flex items-center gap-2.5 h-9 px-2 rounded-md w-full transition-colors ${
                    isActive ? "bg-[#0066FF]" : "hover:bg-[#27272A]"
                  }`}
                >
                  <TeamIcon
                    className={`w-[18px] h-[18px] ${isActive ? "text-white" : "text-[#71717A]"}`}
                  />
                  <span
                    className={`min-w-0 flex-1 truncate text-left text-sm ${isActive ? "text-white font-medium" : "text-[#FAFAFA]"}`}
                  >
                    {displayName}
                  </span>
                  {teamScopeInfo && (
                    <>
                      <span
                        className={`flex-shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-semibold leading-none ${
                          isActive
                            ? "border-white/30 bg-white/15 text-white"
                            : teamScopeInfo.type === "public"
                              ? "border-[#1D4ED8] bg-[#172554] text-[#BFDBFE]"
                              : "border-[#B91C1C] bg-[#450A0A] text-[#FECACA]"
                        }`}
                      >
                        {teamScopeInfo.tagLabel}
                      </span>
                      <span
                        className="pointer-events-none absolute left-[calc(100%+10px)] top-1/2 z-50 hidden min-w-[176px] -translate-y-1/2 rounded-lg bg-[#0066FF] px-3 py-2 text-left shadow-xl group-hover/team:block"
                      >
                        <span className="absolute -left-1 top-1/2 h-2.5 w-2.5 -translate-y-1/2 rotate-45 bg-[#0066FF]" />
                        <span className="block text-[11px] font-semibold leading-4 text-white/75">
                          {teamScopeInfo.label}
                        </span>
                        <span className="block whitespace-nowrap text-sm font-semibold leading-5 text-white">
                          {teamScopeInfo.description}
                        </span>
                      </span>
                    </>
                  )}
                </button>
              );
            })}
          </div>

          {/* Divider */}
          <div className="h-px w-full bg-[#27272A]" />

          {/* Add Team Button */}
          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="flex items-center justify-center gap-2 h-10 rounded-lg border border-[#ffffff] w-full cursor-pointer text-[#ffffff] hover:border-[#0066FF] hover:bg-[#0066FF] transition-colors"
          >
            <LuPlus className="w-[18px] h-[18px]" />
            <span className="text-sm font-medium">팀 만들기</span>
          </button>

          {/* Divider */}
          <div className="h-px w-full bg-[#27272A] mt-3" />

          {/* User Section */}
          <div className="flex flex-col gap-3 pt-3 w-full">
            {/* User Profile */}
            <div className="flex items-center gap-2.5 w-full">
              <div className="flex items-center justify-center w-9 h-9 rounded-full bg-[#0066FF]">
                <span className="text-sm font-medium text-white">
                  {userInitial}
                </span>
              </div>
              <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                <span className="text-sm font-medium text-[#FAFAFA] truncate">
                  {userName}
                </span>
                <span className="text-[11px] text-[#71717A] truncate">
                  {user?.email || "user@company.com"}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setIsEditNameModalOpen(true)}
                aria-label="이름 변경"
                title="이름 변경"
                className="flex items-center justify-center w-7 h-7 rounded-md flex-shrink-0 text-[#71717A] hover:bg-[#27272A] hover:text-[#FAFAFA] cursor-pointer transition-colors"
              >
                <LuPencil className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Action Row */}
            <div className="flex items-center gap-2 w-full">
              {/* Theme Toggle */}
              <div className="flex items-center gap-1 h-9 p-1 rounded-lg bg-[#27272A] flex-1">
                <button
                  type="button"
                  onClick={() => setTheme("light")}
                  className={`flex items-center justify-center flex-1 h-full rounded-md cursor-pointer transition-colors ${
                    theme === "light" ? "bg-[#3F3F46]" : "hover:bg-[#3F3F46]"
                  }`}
                >
                  <LuSun
                    className={`w-3.5 h-3.5 ${theme === "light" ? "text-[#FAFAFA]" : "text-[#71717A]"}`}
                  />
                </button>
                <button
                  type="button"
                  onClick={() => setTheme("dark")}
                  className={`flex items-center justify-center flex-1 h-full rounded-md cursor-pointer transition-colors ${
                    theme === "dark" ? "bg-[#3F3F46]" : "hover:bg-[#3F3F46]"
                  }`}
                >
                  <LuMoon
                    className={`w-3.5 h-3.5 ${theme === "dark" ? "text-[#FAFAFA]" : "text-[#71717A]"}`}
                  />
                </button>
              </div>

              {/* Logout Button */}
              <button
                onClick={logout}
                className="flex items-center justify-center gap-1.5 h-9 px-3 rounded-lg border border-[#27272A] hover:bg-[#27272A] cursor-pointer transition-colors"
              >
                <LuLogOut className="w-3.5 h-3.5 text-[#71717A]" />
                <span className="text-xs font-medium text-[#71717A]">
                  로그아웃
                </span>
              </button>
            </div>
          </div>

          <button
            type="button"
            onPointerDown={handleResizeStart}
            aria-label="사이드바 너비 조절"
            className="absolute top-0 right-0 h-full w-2 cursor-col-resize bg-transparent hover:bg-[#3F3F46]/50 active:bg-[#3F3F46]/70 transition-colors"
            style={{ touchAction: "none" }}
          />
        </div>
      )}

      <CreateTeamModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onSubmit={createTeam}
      />

      <EditNameModal
        isOpen={isEditNameModalOpen}
        currentName={userName}
        onClose={() => setIsEditNameModalOpen(false)}
        onSubmit={updateName}
      />
    </>
  );
};

export default Sidebar;
