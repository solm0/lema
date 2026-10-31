import { matchPath, Outlet, useLocation, useNavigate } from "react-router-dom";
import { verifyToken } from "../api";
import { useState, useEffect } from "react";
import { File, Home, Menu, MessageSquareMore, Settings, SwatchBook, X } from "lucide-react";
import type { User } from "../types";
import { clearStoredSession, getOfflineSessionUser } from "../authSession";
import { syncOfflineOutbox } from "../offlineData";
import { IconButton } from "./util/Button";
import { MiniPopup } from "./util/MiniPopup";
import { SettingToggle } from "./util/ToggleButton";
import { useSettings } from "./useSettings";
import { useI18n } from "../i18n";
import { CENTRAL_RESTORED_EVENT } from "../network";
import { GRADSHOW_MODE, GRADSHOW_USER } from "../gradshow/mode";

const LAST_PAGE_PATH_STORAGE_KEY = "last-page-path";
const ONLINE_RECONNECT_GRACE_MS = 3000;

function detectMobileLike() {
  if (typeof window === "undefined") return false;

  return window.matchMedia("(pointer: coarse)").matches || window.innerWidth < 768;
}

export function Side() {
  const navigate = useNavigate();
  const location = useLocation();

  const [isMobile, setIsMobile] = useState(detectMobileLike);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [openSettings, setOpenSettings] = useState(false);
  const {
      settings,
      toggleSetting,
    } = useSettings();
  const { t } = useI18n();

  useEffect(() => {
    const check = () => {
      setIsMobile(detectMobileLike());
    };
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  useEffect(() => {
    if (!isMobile) return;

    let startX = 0;
    let startY = 0;
    const onTouchStart = (event: TouchEvent) => {
      const touch = event.touches[0];
      startX = touch?.clientX ?? 0;
      startY = touch?.clientY ?? 0;
    };
    const onTouchEnd = (event: TouchEvent) => {
      const touch = event.changedTouches[0];
      const endX = touch?.clientX ?? startX;
      const endY = touch?.clientY ?? startY;
      if (startX <= 28 && endX - startX > 64 && Math.abs(endY - startY) < 56) {
        setMobileNavOpen(true);
      }
    };

    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchend", onTouchEnd);
    };
  }, [isMobile]);

  const normalMenus = [
    { label: <Home size={isMobile ? 20 : 16} />, path: "/", title: t("Home") },
    { label: <File size={isMobile ? 20 : 16} />, path: "/pages", title: t("Pages") },
    { label: <SwatchBook size={isMobile ? 20 : 16} />, path: "/lemmas", title: t("Lemmas") },
    { label: <MessageSquareMore size={isMobile ? 19 : 15} />, path: "/annotations", title: t("Annotations") },
  ];

  const handleMenuClick = (path: string) => {
    navigate(path === "/pages" && !isMobile ? "/" : path);
    setMobileNavOpen(false);
  };

  const content = normalMenus
    .filter((menu) => isMobile || menu.path !== "/")
    .map((menu) => {
    const active = menu.path === "/pages"
      ? location.pathname === "/" || location.pathname === "/pages" || Boolean(matchPath("/page/:id", location.pathname))
      : location.pathname === menu.path;
    return (
      <IconButton
        key={menu.path}
        icon={menu.label}
        title={menu.title}
        onClick={() => handleMenuClick(menu.path)}
        active={active}
        mobileMenu={isMobile}
      />
    );
    })

  const settingsButtons = isMobile ? (
    <IconButton
      icon={<Settings size={20} />}
      title={t("Settings")}
      onClick={() => navigate("/setting")}
      active={location.pathname === "/setting" || openSettings === true}
      mobileMenu
    />
  ) : (
    <div
      className="relative"
      onMouseEnter={() => location.pathname.startsWith('/page') && setOpenSettings(true)}
    >
      <IconButton
        icon={<Settings size={16} />}
        title={t("Settings")}
        active={
          location.pathname === "/setting" || openSettings
        }
        onClick={() => navigate("/setting")}
      />

      <MiniPopup
        open={openSettings}
        onClose={() => setOpenSettings(false)}
        left row
      >
        <div className="flex flex-col gap-3 min-w-[180px] p-2">
          <div className="flex items-center gap-2">
            <span>{t("Lemma info")}</span>
            <SettingToggle
              settingKey="lemma_info"
              value={settings.lemma_info}
              toggleSetting={toggleSetting}
            />
          </div>
        </div>
      </MiniPopup>
    </div>
  );

  if (isMobile) {
    return (
      <>
        <button
          type="button"
          onClick={() => setMobileNavOpen(true)}
          className="fixed left-3 top-1.5 z-[70] flex h-10 w-10 items-center justify-center rounded-full bg-neutral-50 shadow-sm transition-opacity hover:opacity-70"
          aria-label={t("Open sidebar")}
          title={t("Open sidebar")}
        >
          <Menu size={20} />
        </button>

        <div
          className={`fixed inset-0 z-[80] transition-opacity duration-200 ${mobileNavOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"}`}
          aria-hidden={!mobileNavOpen}
        >
          <button
            type="button"
            aria-label={t("Close sidebar")}
            className="absolute inset-0 bg-neutral-900/20"
            onClick={() => setMobileNavOpen(false)}
          />
          <nav
            className={`relative flex h-full w-68 flex-col bg-neutral-100 px-3 pb-6 pt-16 shadow-xl transition-transform duration-200 ${mobileNavOpen ? "translate-x-0" : "-translate-x-full"}`}
            aria-label={t("Navigation")}
            onTouchStart={(event) => {
              const touch = event.touches[0];
              event.currentTarget.dataset.swipeStartX = String(touch?.clientX ?? 0);
            }}
            onTouchEnd={(event) => {
              const startX = Number(event.currentTarget.dataset.swipeStartX ?? 0);
              const endX = event.changedTouches[0]?.clientX ?? startX;
              if (startX - endX > 48) setMobileNavOpen(false);
            }}
          >
            <button
              type="button"
              onClick={() => setMobileNavOpen(false)}
              className="absolute left-3 top-3 flex h-10 w-10 items-center justify-center rounded-full bg-neutral-50"
              aria-label={t("Close sidebar")}
            >
              <X size={20} />
            </button>
            <div className="flex flex-col gap-1">
              {normalMenus.map((menu) => (
                <button
                  key={menu.path}
                  type="button"
                  onClick={() => handleMenuClick(menu.path)}
                  className={`flex h-12 items-center gap-3 rounded-xl px-3 text-left transition-colors ${location.pathname === menu.path ? "bg-neutral-50" : "hover:bg-neutral-50/70"}`}
                >
                  {menu.label}
                  <span>{menu.title}</span>
                </button>
              ))}
            </div>
            <div className="mt-auto">
              <button
                type="button"
                onClick={() => handleMenuClick("/setting")}
                className={`flex h-12 w-full items-center gap-3 rounded-xl px-3 text-left transition-colors ${location.pathname === "/setting" ? "bg-neutral-50" : "hover:bg-neutral-50/70"}`}
              >
                <Settings size={20} />
                <span>{t("Settings")}</span>
              </button>
            </div>
          </nav>
        </div>
      </>
    )
  } else return (
    <div className="pt-12 top-0 left-0 h-full w-9 bg-neutral-100 border-neutral-300 flex flex-col text-sm items-center gap-2 z-50">
      {content}
      {settingsButtons}
    </div>
  )
}

export default function HomeLayout() {
  const [user, setUser] = useState<User | null | undefined>(() => {
    if (GRADSHOW_MODE) return GRADSHOW_USER;
    const offlineUser = getOfflineSessionUser();
    return offlineUser ?? undefined;
  });

  const navigate = useNavigate();
  const location = useLocation();
  useI18n();

  useEffect(() => {
    if (matchPath("/page/:id", location.pathname)) {
      window.sessionStorage.setItem(
        LAST_PAGE_PATH_STORAGE_KEY,
        location.pathname + location.search + location.hash,
      );
    }
  }, [location.hash, location.pathname, location.search]);

  useEffect(() => {
    if (GRADSHOW_MODE) return;
    let cancelled = false;
    let reconnectTimer: number | null = null;

    const loadUser = async () => {
      const nextUser = await verifyToken();

      if (nextUser) {
        await syncOfflineOutbox().catch(() => false);
      }

      if (cancelled) {
        return;
      }

      setUser(nextUser);
    };

    void loadUser();

    const handleOnline = () => {
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
      }
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        void loadUser();
      }, ONLINE_RECONNECT_GRACE_MS);
    };

    const handleCentralRestored = () => {
      void syncOfflineOutbox();
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener(CENTRAL_RESTORED_EVENT, handleCentralRestored);

    return () => {
      cancelled = true;
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
      }
      window.removeEventListener("online", handleOnline);
      window.removeEventListener(CENTRAL_RESTORED_EVENT, handleCentralRestored);
    };
  }, []);

  useEffect(() => {
    if (GRADSHOW_MODE) return;
    if (user === undefined) return; // 아직 로딩 중
    if (!user) {
      void clearStoredSession().catch(() => undefined);
      navigate("/login");
    }
  }, [navigate, user]);

  return (
    <div className="h-screen w-screen overflow-hidden flex">
      <Side />

      {/* Main Content */}
      <div className={`flex-1 overflow-hidden`}>
        <div className="w-full h-full flex flex-col gap-3 overflow-hidden">
          <Outlet context={user} />
        </div>
      </div>
    </div>
  );
}
