import { getTeamDisplayName } from "@lib/teamDisplayName";

const DEFAULT_AFFILIATE_TEAM_NAMES = new Set([
  "kc",
  "kct",
  "kctech",
  "kcenc",
  "kcinnovation",
  "kcindustrial",
  "kcpartstech",
]);

export type TeamScopeInfo = {
  type: "public" | "affiliate";
  tagLabel: string;
  label: string;
  description: string;
};

export const getTeamScopeInfo = (teamName: string): TeamScopeInfo | null => {
  const normalizedName = teamName.trim().toLowerCase();

  if (normalizedName === "public") {
    return {
      type: "public",
      tagLabel: "KC 그룹사",
      label: "공유 범위",
      description: "KC 그룹사 전체",
    };
  }

  if (DEFAULT_AFFILIATE_TEAM_NAMES.has(normalizedName)) {
    return {
      type: "affiliate",
      tagLabel: `${getTeamDisplayName(teamName)}임직원`,
      label: "공유 범위",
      description: `${getTeamDisplayName(teamName)} 임직원 전체`,
    };
  }

  return null;
};
