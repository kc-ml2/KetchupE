const TEAM_NAME_OVERRIDES: Record<string, string> = {
  public: "KC 그룹사",
  kct: "kc",
};

const formatLeadingKc = (name: string): string => {
  return name.replace(/^kc/i, "KC");
};

export const getTeamDisplayName = (name: string): string => {
  const displayName = TEAM_NAME_OVERRIDES[name.toLowerCase()] ?? name;
  return formatLeadingKc(displayName);
};
