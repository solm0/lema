import { matchPath, Outlet, useLocation, useNavigate } from "react-router-dom";
import { verifyToken } from "../api";
import { useState, useEffect } from "react";
import { File, MessageSquareMore, Settings2, Star } from "lucide-react";
import type { User } from "../types";
import { clearStoredSession, getOfflineSessionUser } from "../authSession";
import { syncOfflineOutbox } from "../offlineData";
import { IconButton } from "./util/Button";
import { MiniPopup } from "./util/MiniPopup";
import { SettingToggle } from "./util/ToggleButton";
import { useSettings } from "./useSettings";
import { useI18n } from "../i18n";
import { CENTRAL_RESTORED_EVENT } from "../network";

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

  const normalMenus = [
    { label: <File size={isMobile ? 20 : 16} />, path: "/", title: t("Pages") },
    { label: <MessageSquareMore size={isMobile ? 20 : 16} />, path: "/annotations", title: t("Annotations") },
    { label: <Star size={isMobile ? 20 : 16} />, path: "/lemmas", title: t("My Lemmas") },
  ];

  const handleMenuClick = (path: string) => {
    if (path !== "/") {
      navigate(path);
      return;
    }

    if (matchPath("/page/:id", location.pathname)) {
      navigate("/");
      return;
    }

    const lastPagePath = window.sessionStorage.getItem(LAST_PAGE_PATH_STORAGE_KEY);
    navigate(lastPagePath || "/");
  };

  const content = normalMenus.map((menu) => {
    const active = location.pathname === menu.path;
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
      icon={<Settings2 size={20} />}
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
        icon={<Settings2 size={16} />}
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
      <div className="fixed bottom-0 left-0 h-16 w-full border-t bg-neutral-transparent border-neutral-200 flex justify-around p-3 text-sm items-center z-50 backdrop-blur-sm">
        {content}
        {settingsButtons}
      </div>
    )
  } else return (
    <div className="pt-12 top-0 left-0 h-full w-9 bg-neutral-transparent border-neutral-300 flex flex-col text-sm items-center gap-2 z-50">
      {content}
      {settingsButtons}
    </div>
  )
}

export default function HomeLayout() {
  const [user, setUser] = useState<User | null | undefined>(() => {
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
    if (user === undefined) return; // 아직 로딩 중
    if (!user) {
      clearStoredSession();
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
