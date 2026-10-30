import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  isDarkTheme,
  resolveTheme,
  type ResolvedThemeId,
  type ThemeId,
} from "../themes";
import { useSettings } from "./useSettings";

const MEDIA_QUERY = "(prefers-color-scheme: dark)";

type ThemeContextValue = {
  theme: ThemeId;
  resolvedTheme: ResolvedThemeId;
  isDark: boolean;
  setTheme: (theme: ThemeId) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function systemPrefersDark() {
  return typeof window !== "undefined" && window.matchMedia(MEDIA_QUERY).matches;
}

export function applyTheme(theme: ThemeId, prefersDark = systemPrefersDark()) {
  if (typeof document === "undefined") return;

  const resolvedTheme = resolveTheme(theme, prefersDark);
  const root = document.documentElement;

  root.classList.toggle("dark", isDarkTheme(resolvedTheme));
  root.dataset.theme = resolvedTheme;
  root.style.colorScheme = isDarkTheme(resolvedTheme) ? "dark" : "light";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { settings, setSettings } = useSettings();
  const [prefersDark, setPrefersDark] = useState(systemPrefersDark);
  const resolvedTheme = resolveTheme(settings.theme, prefersDark);
  const isDark = isDarkTheme(resolvedTheme);

  useEffect(() => {
    applyTheme(settings.theme, prefersDark);
  }, [settings.theme, prefersDark]);

  useEffect(() => {
    const media = window.matchMedia(MEDIA_QUERY);
    const syncSystemTheme = () => setPrefersDark(media.matches);

    syncSystemTheme();
    media.addEventListener("change", syncSystemTheme);
    return () => media.removeEventListener("change", syncSystemTheme);
  }, []);

  const value = useMemo(
    () => ({
      theme: settings.theme,
      resolvedTheme,
      isDark,
      setTheme: (theme: ThemeId) => {
        setSettings((previous) => ({ ...previous, theme }));
      },
    }),
    [isDark, resolvedTheme, setSettings, settings.theme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used inside ThemeProvider");
  return context;
}
