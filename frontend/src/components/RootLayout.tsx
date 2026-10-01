import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { App as CapacitorApp } from "@capacitor/app";

import {
  matchPath,
  Outlet,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { IconButton } from "./util/Button";
import {
  PanelLeft,
} from "lucide-react";
import { isCapacitorApp } from "../platform";
import { useSettings } from "./useSettings";
import NotificationPermissionModal from "./setting/NotificationPermissionModal";
import {
  getAppNotificationPermissionStatus,
  hasSeenNotificationPrompt,
  markNotificationPromptSeen,
  openAppNotificationSettings,
  setNowPlayingNotificationsEnabled,
} from "../notificationPreferences";
import { useI18n } from "../i18n";
import { GRADSHOW_MODE } from "../gradshow/mode";


// ======================================
// CONTEXT
// ======================================

type LayoutContextType = {
  setTitlebarAction: (fn: (() => void) | null) => void;
  panelOpen: boolean;
  setPanelOpen: (open: boolean) => void;
  pageSidebarOpen: boolean;
  setPageSidebarOpen: (open: boolean) => void;
};

const PAGE_SIDEBAR_OPEN_STORAGE_KEY = "pages.sidebar.open";

const LayoutContext =
  createContext<LayoutContextType | null>(null);

type URLOpenListenerEvent = {
  url: string;
};

function loadPageSidebarOpen() {
  if (typeof window === "undefined") return true;

  try {
    const raw = window.localStorage.getItem(PAGE_SIDEBAR_OPEN_STORAGE_KEY);
    if (raw === null) return true;

    const parsed = JSON.parse(raw);
    return typeof parsed === "boolean" ? parsed : true;
  } catch {
    return true;
  }
}


// ======================================
// HOOK
// ======================================

export function useLayout() {
  const ctx = useContext(LayoutContext);

  if (!ctx) {
    throw new Error(
      "useLayout must be used inside RootLayout"
    );
  }

  return ctx;
}


// ======================================
// ROOT LAYOUT
// ======================================

export default function RootLayout() {
  const { t } = useI18n();
  const location = useLocation();
  const navigate = useNavigate();
  const { settings } = useSettings();
  const [, setTitlebarAction] =
    useState<(() => void) | null>(null);
  const [openNotificationPrompt, setOpenNotificationPrompt] = useState(false);

  const [panelOpen, setPanelOpen] =
    useState(false);
  const [pageSidebarOpen, setPageSidebarOpen] =
    useState(() => loadPageSidebarOpen());

  const isPagePath =
    matchPath("/page/:id", location.pathname) !==
    null;

  useEffect(() => {
    if (typeof window === "undefined") return;

    window.localStorage.setItem(
      PAGE_SIDEBAR_OPEN_STORAGE_KEY,
      JSON.stringify(pageSidebarOpen)
    );
  }, [pageSidebarOpen]);

  useEffect(() => {
    if (GRADSHOW_MODE) return;
    void setNowPlayingNotificationsEnabled(settings.now_playing_notifications);
  }, [settings.now_playing_notifications]);

  useEffect(() => {
    if (!isCapacitorApp()) return;

    let isCancelled = false;
    let listenerHandle: Awaited<ReturnType<typeof CapacitorApp.addListener>> | null = null;

    const attach = async () => {
      try {
        listenerHandle = await CapacitorApp.addListener("backButton", ({ canGoBack }) => {
          if (GRADSHOW_MODE) return;
          if (panelOpen) {
            setPanelOpen(false);
            return;
          }

          if (isPagePath) {
            setPageSidebarOpen(true);
            window.dispatchEvent(new Event("lema:mobile-page-back"));
            return;
          }

          if (canGoBack) {
            window.history.back();
            return;
          }

          if (location.pathname !== "/") {
            navigate(-1);
            return;
          }

          void CapacitorApp.exitApp();
        });

        if (isCancelled) {
          await listenerHandle.remove();
        }
      } catch (error) {
        console.warn("Capacitor App plugin is unavailable.", error);
      }
    };

    void attach();

    return () => {
      isCancelled = true;
      void listenerHandle?.remove();
    };
  }, [isPagePath, location.pathname, navigate, pageSidebarOpen, panelOpen]);

  useEffect(() => {
    if (GRADSHOW_MODE) return;
    let isCancelled = false;
    let urlListenerHandle: Awaited<ReturnType<typeof CapacitorApp.addListener>> | null = null;
    let removeElectronListener: (() => void) | void;

    const openLyricRoute = () => {
      if (window.location.hash !== "#/lyric") {
        window.location.hash = "/lyric";
        return;
      }

      navigate("/lyric", { replace: true });
    };

    const openPageRoute = (pageId: string) => {
      navigate(`/page/${pageId}`, { replace: true });
    };

    const navigateFromUrl = (url: string | null | undefined) => {
      if (!url) return;

      if (/^(?:lema|nautilus):\/\/lyric/.test(url)) {
        openLyricRoute();
        return;
      }

      const match = url.match(/^(?:lema|nautilus):\/\/page\/([^/?#]+)(?:[/?#].*)?$/);
      if (match?.[1]) {
        openPageRoute(match[1]);
      }
    };

    const attach = async () => {
      removeElectronListener = window.electronAPI?.onDeepLink?.((url) => {
        navigateFromUrl(url);
      });

      if (!isCapacitorApp()) return;

      try {
        const launch = await CapacitorApp.getLaunchUrl();
        if (!isCancelled) {
          navigateFromUrl(launch?.url);
        }

        urlListenerHandle = await CapacitorApp.addListener("appUrlOpen", (event: URLOpenListenerEvent) => {
          navigateFromUrl(event.url);
        });

        if (isCancelled) {
          await urlListenerHandle.remove();
        }
      } catch (error) {
        console.warn("Capacitor app URL listener is unavailable.", error);
      }
    };

    void attach();

    return () => {
      isCancelled = true;
      removeElectronListener?.();
      void urlListenerHandle?.remove();
    };
  }, [navigate]);

  useEffect(() => {
    if (GRADSHOW_MODE) return;
    if (!isCapacitorApp()) return;
    if (!settings.now_playing_notifications) return;
    if (hasSeenNotificationPrompt()) return;

    let cancelled = false;

    const maybePrompt = async () => {
      const permission = await getAppNotificationPermissionStatus();
      if (cancelled) return;

      if (!permission.granted) {
        setOpenNotificationPrompt(true);
        markNotificationPromptSeen();
      }
    };

    void maybePrompt();

    return () => {
      cancelled = true;
    };
  }, [settings.now_playing_notifications]);

  async function handleOpenNotificationSettings() {
    setOpenNotificationPrompt(false);
    await openAppNotificationSettings();
  }

  const value = useMemo(
    () => ({
      setTitlebarAction: (fn: (() => void) | null) => {
        setTitlebarAction(fn ? () => fn : null);
      },
      panelOpen,
      setPanelOpen,
      pageSidebarOpen,
      setPageSidebarOpen,
    }),
    [panelOpen, pageSidebarOpen]
  );

  return (
    <LayoutContext.Provider value={value}>
      <div className="titlebar fixed top-0 left-0 w-full h-10 z-999 flex items-center justify-between px-6 pl-22">
        <div className="hidden md:flex relative z-10 items-center gap-2 no-drag pt-0.5 pl-1 text-neutral-500">
          {isPagePath && (
            <IconButton
              icon={<PanelLeft size={15} />}
              onClick={() =>
                setPageSidebarOpen(!pageSidebarOpen)
              }
              title={
                pageSidebarOpen
                  ? t("Close sidebar")
                  : t("Open sidebar")
              }
            />
          )}
        </div>
      </div>

      <Outlet />

      <NotificationPermissionModal
        open={openNotificationPrompt}
        onClose={() => setOpenNotificationPrompt(false)}
        onOpenSettings={handleOpenNotificationSettings}
        title="Turn on notifications"
        body="Lema can show now playing alerts while the app is in the background. Allow notifications in Android settings to use this feature."
      />
    </LayoutContext.Provider>
  );
}
