export const themeOptions = [
  { id: "system", label: "System" },
  { id: "lema-light", label: "Lema Light" },
  { id: "lema-dark", label: "Lema Dark" },
  { id: "catppuccin-latte", label: "Catppuccin Latte" },
  { id: "catppuccin-frappe", label: "Catppuccin Frappé" },
  { id: "catppuccin-macchiato", label: "Catppuccin Macchiato" },
  { id: "catppuccin-mocha", label: "Catppuccin Mocha" },
  { id: "nord", label: "Nord" },
  { id: "solarized-light", label: "Solarized Light" },
  { id: "solarized-dark", label: "Solarized Dark" },
  { id: "gruvbox-light", label: "Gruvbox Light" },
  { id: "gruvbox-light-soft", label: "Gruvbox Light Soft" },
  { id: "gruvbox-light-hard", label: "Gruvbox Light Hard" },
  { id: "gruvbox-dark", label: "Gruvbox Dark" },
  { id: "gruvbox-dark-soft", label: "Gruvbox Dark Soft" },
  { id: "gruvbox-dark-hard", label: "Gruvbox Dark Hard" },
  { id: "gruvbox-material-dark", label: "Gruvbox Material Dark" },
  { id: "dracula", label: "Dracula" },
  { id: "tokyo-night", label: "Tokyo Night" },
  { id: "tokyo-night-storm", label: "Tokyo Night Storm" },
  { id: "tokyo-night-moon", label: "Tokyo Night Moon" },
  { id: "tokyo-night-day", label: "Tokyo Night Day" },
  { id: "rose-pine", label: "Rosé Pine" },
  { id: "rose-pine-moon", label: "Rosé Pine Moon" },
  { id: "rose-pine-dawn", label: "Rosé Pine Dawn" },
  { id: "kanagawa-wave", label: "Kanagawa Wave" },
  { id: "kanagawa-dragon", label: "Kanagawa Dragon" },
  { id: "kanagawa-lotus", label: "Kanagawa Lotus" },
  { id: "everforest-dark-hard", label: "Everforest Dark Hard" },
  { id: "everforest-dark", label: "Everforest Dark" },
  { id: "everforest-dark-soft", label: "Everforest Dark Soft" },
  { id: "everforest-light-hard", label: "Everforest Light Hard" },
  { id: "everforest-light", label: "Everforest Light" },
  { id: "everforest-light-soft", label: "Everforest Light Soft" },
  { id: "flexoki-light", label: "Flexoki Light" },
  { id: "flexoki-dark", label: "Flexoki Dark" },
  { id: "ayu-light", label: "Ayu Light" },
  { id: "ayu-mirage", label: "Ayu Mirage" },
  { id: "ayu-dark", label: "Ayu Dark" },
  { id: "one-light", label: "One Light" },
  { id: "one-dark", label: "One Dark" },
  { id: "monokai", label: "Monokai" },
  { id: "monokai-dimmed", label: "Monokai Dimmed" },
  { id: "night-owl", label: "Night Owl" },
  { id: "light-owl", label: "Light Owl" },
  { id: "github-light", label: "GitHub Light" },
  { id: "github-dark", label: "GitHub Dark" },
  { id: "base16-default-dark", label: "Base16 Default Dark" },
] as const;

export type ThemeId = (typeof themeOptions)[number]["id"];
export type ResolvedThemeId = Exclude<ThemeId, "system">;

const themeIds = new Set<ThemeId>(themeOptions.map(({ id }) => id));

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === "string" && themeIds.has(value as ThemeId);
}

export function resolveTheme(theme: ThemeId, prefersDark: boolean): ResolvedThemeId {
  return theme === "system" ? (prefersDark ? "lema-dark" : "lema-light") : theme;
}

export function isDarkTheme(theme: ResolvedThemeId): boolean {
  return !lightThemes.has(theme);
}

const lightThemes = new Set<ResolvedThemeId>([
  "lema-light",
  "catppuccin-latte",
  "solarized-light",
  "gruvbox-light",
  "gruvbox-light-soft",
  "gruvbox-light-hard",
  "tokyo-night-day",
  "rose-pine-dawn",
  "kanagawa-lotus",
  "everforest-light-hard",
  "everforest-light",
  "everforest-light-soft",
  "flexoki-light",
  "ayu-light",
  "one-light",
  "light-owl",
  "github-light",
]);
