import { matchPath, Outlet, useLocation, useNavigate } from "react-router-dom";
import { verifyToken } from "../api";
import { useState, useEffect } from "react";
import { ArrowLeft, File, Home, MessageSquareMore, Settings, SwatchBook, TextAlignStart } from "lucide-react";
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

    let eligible = false;
    const hasOpenPanel = () => Boolean(document.querySelector("[data-mobile-lemma-panel], [data-modal-open='true']"));
    let startX = 0;
    let startY = 0;
    const onTouchStart = (event: TouchEvent) => {
      const target = event.target;
      eligible = !mobileNavOpen && !hasOpenPanel() && event.touches.length === 1
        && !(target instanceof Element && target.closest("button, a, input, textarea, select, [role='button'], [contenteditable='true']"));
      const touch = event.touches[0];
      startX = touch?.clientX ?? 0;
      startY = touch?.clientY ?? 0;
      // Reserve the page edge gesture for its existing back navigation.
      if (matchPath("/page/:id", location.pathname) && startX <= 28) eligible = false;
    };
    const onTouchEnd = (event: TouchEvent) => {
      const touch = event.changedTouches[0];
      const endX = touch?.clientX ?? startX;
      const endY = touch?.clientY ?? startY;
      if (eligible && !hasOpenPanel() && endX - startX > 64 && Math.abs(endY - startY) < 56) {
        setMobileNavOpen(true);
      }
      eligible = false;
    };
    const onTouchCancel = () => { eligible = false; };

    window.addEventListener("touchcancel", onTouchCancel, { passive: true });
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    return () => {
      window.removeEventListener("touchcancel", onTouchCancel);
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchend", onTouchEnd);
    };
  }, [isMobile, location.pathname, mobileNavOpen]);

  const normalMenus = [
    { label: <Home size={isMobile ? 18 : 16} fill="currentColor"  />, path: "/", title: t("Home") },
    { label: <File size={isMobile ? 18 : 16} />, path: "/pages", title: t("Pages") },
    { label: <SwatchBook size={isMobile ? 18 : 16} />, path: "/lemmas", title: t("Lemmas") },
    { label: <MessageSquareMore size={isMobile ? 17 : 15} />, path: "/annotations", title: t("Annotations") },
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
          onClick={() => setMobileNavOpen((open) => !open)}
          className="fixed left-3 top-10 z-[90] flex h-10 w-12 items-center justify-center rounded-full bg-neutral-200 text-neutral-600"
          aria-label={t(mobileNavOpen ? "Close sidebar" : "Open sidebar")}
          title={t(mobileNavOpen ? "Close sidebar" : "Open sidebar")}
          aria-expanded={mobileNavOpen}
          aria-controls="mobile-sidebar"
        >
          <span aria-hidden="true" className="relative block h-[18px] w-[18px] overflow-hidden">
            <span
              className={`absolute inset-0 transition-[translate,opacity] duration-200 ease-in-out motion-reduce:transition-none ${mobileNavOpen ? "translate-x-full opacity-0" : "translate-x-0 opacity-100"}`}
            >
              <TextAlignStart size={18} />
            </span>
            <span
              className={`absolute inset-0 transition-[translate,opacity] duration-200 ease-in-out motion-reduce:transition-none ${mobileNavOpen ? "translate-x-0 opacity-100" : "-translate-x-full opacity-0"}`}
            >
              <ArrowLeft size={18} />
            </span>
          </span>
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
            id="mobile-sidebar"
            className={`relative flex h-full w-72 flex-col bg-neutral-100 px-3 pb-6 pt-[108px] shadow-xl transition-transform duration-200 ${mobileNavOpen ? "translate-x-0" : "-translate-x-full"}`}
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
            <div className="flex flex-col">
              {normalMenus.map((menu) => (
                <button
                  key={menu.path}
                  type="button"
                  onClick={() => handleMenuClick(menu.path)}
                  className={`flex h-12 text-lg items-center gap-3 rounded-full font-body font-medium px-4 text-left transition-colors ${location.pathname === menu.path ? "text-neutral-700 bg-neutral-200" : "text-neutral-600 hover:bg-neutral-200/30"}`}
                >
                  {menu.label}
                  <span className="pb-px">{menu.title}</span>
                </button>
              ))}
            </div>
            <div className="mt-auto">
              <button
                type="button"
                onClick={() => handleMenuClick("/setting")}
                className={`flex h-12 text-lg w-full items-center gap-3 rounded-full font-body font-medium px-4 text-left transition-colors ${location.pathname === "/setting" ? "text-neutral-700 bg-neutral-200" : "text-neutral-600 hover:bg-neutral-200/30"}`}
              >
                <Settings size={18}  />
                <span className="pb-px">{t("Settings")}</span>
              </button>
            </div>
          </nav>
        </div>
      </>
    )
  } else return (
    <div className="pt-13 top-0 left-0 h-full w-9 bg-neutral-100 border-neutral-300 flex flex-col text-sm items-center gap-2 z-50">
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
