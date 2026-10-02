/** Cookie so the server renders the right theme on first load. */
export const THEME_COOKIE = "agent_desk_theme";

export const THEMES = ["light", "dark", "system"] as const;
export type Theme = (typeof THEMES)[number];

export function toTheme(value: string | undefined): Theme {
  return THEMES.includes(value as Theme) ? (value as Theme) : "light";
}
