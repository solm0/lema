import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import {
  deleteAccount,
  getLatestVersionInfo,
  isNewerVersion,
  type LatestVersionInfo,
  updateName,
  verifyToken,
} from "../../api";
import { Check, Pencil } from "lucide-react";
import { type User } from "../../types";
import Button, { IconButtonEvent } from "../util/Button";
import { useLocation, useNavigate } from "react-router-dom";
import PackTable from "./PackTable";
import ThemeToggle, { SettingToggle } from "../util/ToggleButton";
import { useSettings } from "../useSettings";
import { isCapacitorApp } from "../../platform";
import { ResponsiveModal } from "../util/ResponsiveModal";
import NotificationPermissionModal from "./NotificationPermissionModal";
import { useI18n } from "../../i18n";
import { relaunchApp } from "../../relaunch";
import {
  getAppNotificationPermissionStatus,
  openAppNotificationSettings,
  type AppNotificationPermissionStatus,
} from "../../notificationPreferences";
import { clearStoredSession, updateStoredUser } from "../../authSession";
import OfflineState from "../util/OfflineState";
import { isNetworkError } from "../../network";
import { ANDROID_PRIVACY_POLICY_URL } from "../../config";
import { exportLocalLibrary, importLocalLibrary } from "../../localLibrary";
import ThemeLogo from "../ThemeLogo";

const APP_VERSION = __APP_VERSION__;

function AppVersionSection() {
  const { t } = useI18n();
  const [latestVersionInfo, setLatestVersionInfo] =
    useState<LatestVersionInfo | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadLatestVersion = async () => {
      try {
        const next = await getLatestVersionInfo();
        if (!cancelled) {
          setLatestVersionInfo(next);
        }
      } catch {
        if (!cancelled) {
          setLatestVersionInfo(null);
        }
      }
    };

    void loadLatestVersion();

    return () => {
      cancelled = true;
    };
  }, []);

  const latestVersion = latestVersionInfo?.version;
  const hasNewVersion =
    latestVersion != null && isNewerVersion(latestVersion, APP_VERSION);

  function openDownloadPage() {
    const target = latestVersionInfo?.download_url ?? "https://nautilus.solmi.wiki/#download";
    window.open(target, "_blank", "noopener,noreferrer");
  }

  return (
    <section className="w-full flex flex-col gap-6 items-start">
      <h3 className="sticky top-0 pt-8 md:pt-12 bg-neutral-50 font-pretendard! w-full pb-1">{t("App version")}</h3>
      <div className="flex items-center gap-2 text-sm">
        <ThemeLogo
          variant="transparent"
          alt="Lema"
          className="size-8 object-contain select-none"
        />
        <span>{APP_VERSION}</span>
        {!hasNewVersion && latestVersionInfo && (
          <span className="rounded-full bg-green-200/60 px-2 py-0.5 text-xs text-green-700">
            {t("Latest")}
          </span>
        )}
      </div>

      {hasNewVersion && latestVersionInfo && (
        <div className="flex flex-col items-start gap-3 rounded-lg border border-neutral-300 p-4">
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium">
              {t("A new version({version}) is available.", {
                version: latestVersionInfo.version,
              })}
            </p>
            {latestVersionInfo.notes.length > 0 && (
              <ul className="list-disc pl-5 text-sm text-neutral-600">
                {latestVersionInfo.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            )}
          </div>
          <Button text={t("Download now")} onClick={openDownloadPage} black />
        </div>
      )}
    </section>
  );
}

function LocalLibrarySection() {
  const { t } = useI18n();
  const [busy, setBusy] = useState<"export" | "import" | null>(null);
  const [message, setMessage] = useState("");

  async function handleExport() {
    setBusy("export");
    setMessage("");
    try {
      const result = await exportLocalLibrary();
      if (result) setMessage(t("Library exported."));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("Could not export library."));
    } finally {
      setBusy(null);
    }
  }

  async function handleImport() {
    setBusy("import");
    setMessage("");
    try {
      const result = await importLocalLibrary();
      if (!result) return;
      window.dispatchEvent(new Event("lema:library-changed"));
      setMessage(t("Import complete: {pages} pages, {notebooks} notebooks, {annotations} annotations, {conflicts} conflicts.", result));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("Could not import library."));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="w-full flex flex-col gap-6 items-start">
      <h3 className="sticky top-0 pt-8 md:pt-12 bg-neutral-50 font-pretendard! z-10 w-full pb-1">
        {t("Local library")}
      </h3>
      <p className="max-w-xl text-sm text-neutral-600">
        {t("Pages, notebooks, and annotations are stored only on this device. Export a backup to move or restore them on another device.")}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          text={busy === "export" ? t("Exporting...") : t("Export library")}
          onClick={() => void handleExport()}
          disabled={busy !== null}
        />
        <Button
          text={busy === "import" ? t("Importing...") : t("Import and merge")}
          onClick={() => void handleImport()}
          disabled={busy !== null}
        />
      </div>
      <p className="text-xs text-neutral-500">
        {t("Import keeps existing data and merges the selected library. Conflicting copies are preserved separately.")}
      </p>
      {message ? <p className="text-sm text-neutral-700">{message}</p> : null}
    </section>
  );
}

export function UserProfile() {
  const { t } = useI18n();
  const mobileApp = isCapacitorApp();
  const [editing, setEditing] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [value, setValue] = useState("");
  const [openLogoutModal, setOpenLogoutModal] = useState(false);
  const [openDeleteModal, setOpenDeleteModal] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [offline, setOffline] = useState(
    mobileApp && typeof navigator !== "undefined" ? !navigator.onLine : false,
  );
  const navigate = useNavigate();

  const loadProfile = useCallback(async () => {
    if (mobileApp && typeof navigator !== "undefined" && !navigator.onLine) {
      setOffline(true);
      return;
    }

    try {
      const nextUser = await verifyToken({ throwOnNetworkError: mobileApp });
      setUser(nextUser);
      if (nextUser?.name) {
        setValue(nextUser.name);
      }
      setOffline(false);
    } catch (error) {
      if (mobileApp && isNetworkError(error)) {
        setOffline(true);
      }
    }
  }, [mobileApp]);

  useEffect(() => {
    const initialLoadTimer = window.setTimeout(() => void loadProfile(), 0);

    if (!mobileApp) {
      return () => window.clearTimeout(initialLoadTimer);
    }

    const handleOnline = () => void loadProfile();
    const handleOffline = () => setOffline(true);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.clearTimeout(initialLoadTimer);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [loadProfile, mobileApp]);

  async function handleSave() {
    await updateName(value);
    setUser((prev) => {
      if (!prev) {
        return prev;
      }

      const nextUser = { ...prev, name: value };
      updateStoredUser(nextUser);
      return nextUser;
    });
    setEditing(false);
  }

  function logout() {
    clearStoredSession();
    navigate("/login");
  }

  async function handleDeleteAccount() {
    setDeleting(true);
    setDeleteError("");

    try {
      await deleteAccount();
      clearStoredSession();
      navigate("/login");
    } catch (error) {
      setDeleteError(
        error instanceof Error ? error.message : "Could not delete account.",
      );
      setDeleting(false);
    }
  }

  return (
    <>
      {mobileApp && offline ? (
        <OfflineState
          onRetry={() => void loadProfile()}
        />
      ) : (
      <>
      <div className="flex flex-col gap-7 mb-14 items-start">
        <div className="flex flex-col gap-2 items-start">
          <div className="w-full flex items-center gap-3 text-lg font-medium">

            {/* name */}
            {editing ? (
              <input
                className="border-b border-neutral-400 focus:outline-none"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                autoFocus
              />
            ) : (
              <div>{user?.name}</div>
            )}

            {/* button */}
            {!offline ? (
              editing ? (
                <IconButtonEvent
                  icon={<Check size={14} />}
                  onClick={handleSave}
                />
              ) : (
                <IconButtonEvent
                  icon={<Pencil size={13} />}
                  onClick={()=>setEditing(true)}
                />
              )
            ) : null}
          </div>
          <p className="text-sm pt-1 pb-2">{user?.email}</p>
        </div>

        <div className="flex gap-2">
          <Button onClick={() => setOpenLogoutModal(true)} text={t("Logout")} />
        </div>

        <Button
          onClick={() => {
            setDeleteError("");
            setOpenDeleteModal(true);
          }}
          text={t("Delete account")}
          disabled={deleting}
          red
        />
      </div>

      <ResponsiveModal open={openLogoutModal} onClose={() => setOpenLogoutModal(false)}>
        <div className="flex flex-col gap-7 md:pb-3">
          <h2>{t("Log out?")}</h2>
          <Button
            text={t("Yes")}
            onClick={logout}
            fit
            black
          />
        </div>
      </ResponsiveModal>

      <ResponsiveModal open={openDeleteModal} onClose={() => setOpenDeleteModal(false)}>
        <div className="flex flex-col gap-7 md:pb-3">
          <>
          <h2>{t("Delete account?")}</h2>
            {offline ? (
              <p className="text-sm text-neutral-500">
                {t("You're offline. Check your connection and try again.")}
              </p>
            ) : (
                <>
                  <p className="pr-8 text-sm text-neutral-500">
                    {t("Your account and cloud interests will be deleted. The local library on this device will remain.")}
                  </p>
                  {deleteError && (
                    <p className="text-sm text-red-600">{deleteError}</p>
                  )}
                  <Button
                    text={deleting ? t("Deleting...") : t("Delete")}
                    onClick={handleDeleteAccount}
                    disabled={deleting}
                    fit
                    red
                  />
                </>
            )}
          </>
        </div>
      </ResponsiveModal>
      </>
      )}
    </>
  );
}

export default function Setting() {
  const { locale, t } = useI18n();
  const mobileApp = isCapacitorApp();
  const [notificationPermission, setNotificationPermission] =
    useState<AppNotificationPermissionStatus | null>(null);
  const [openNotificationModal, setOpenNotificationModal] = useState(false);
  const languagePacksRef = useRef<HTMLHeadingElement | null>(null);
  const {
    settings,
    toggleSetting,
    setSettings,
  } = useSettings();
  const pendingLanguageChange = settings.system_language !== locale;
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (!mobileApp) return;

    let cancelled = false;

    const loadPermission = async () => {
      const next = await getAppNotificationPermissionStatus();
      if (!cancelled) {
        setNotificationPermission(next);
      }
    };

    void loadPermission();
    window.addEventListener("focus", loadPermission);

    return () => {
      cancelled = true;
      window.removeEventListener("focus", loadPermission);
    };
  }, [mobileApp]);

  useEffect(() => {
    if (location.state?.scrollTo !== "language-packs") return;

    requestAnimationFrame(() => {
      languagePacksRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
      navigate(location.pathname, { replace: true, state: null });
    });
  }, [location.pathname, location.state, navigate, languagePacksRef]);

  async function handleNowPlayingNotificationsToggle() {
    const nextValue = !settings.now_playing_notifications;

    if (!nextValue) {
      setSettings((prev) => ({
        ...prev,
        now_playing_notifications: false,
      }));
      return;
    }

    setSettings((prev) => ({
      ...prev,
      now_playing_notifications: true,
    }));

    const permission = await getAppNotificationPermissionStatus();
    setNotificationPermission(permission);

    if (!permission.granted) {
      setOpenNotificationModal(true);
    }
  }

  async function handleOpenNotificationSettings() {
    setOpenNotificationModal(false);
    await openAppNotificationSettings();
  }

  function handleSystemLanguageChange(
    event: ChangeEvent<HTMLSelectElement>,
  ) {
    const nextLanguage = event.target.value === "ko" ? "ko" : "en";
    setSettings((prev) => ({
      ...prev,
      system_language: nextLanguage,
    }));
  }

  return (
    <>
      <div className="w-full h-full overflow-y-scroll overflow-x-hidden flex flex-col gap-7 pr-3 z-30 pl-3 md:pl-6 bg-neutral-50 pb-7">
        <h2 className="top-0 pt-12 z-30">{t("Settings")}</h2>

        <AppVersionSection />

        <section className="w-full flex flex-col gap-6 items-start">
          <h3 className="sticky top-0 pt-8 md:pt-12 bg-neutral-50 font-pretendard! z-10 w-full pb-1">{t("Preferences")}</h3>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col items-start text-sm gap-3">
              <div className="flex items-center gap-2">
                <span>{t("Lemma info")}</span>
                <SettingToggle
                  settingKey="lemma_info"
                  value={settings.lemma_info}
                  toggleSetting={toggleSetting}
                />
              </div>

              <div className="flex items-center gap-2">
                <span>{t("Theme")}</span>
                <ThemeToggle />
              </div>

              <div className="flex items-center gap-2">
                <span>{t("System language")}</span>
                <div className="flex gap-3">
                  <select
                    value={settings.system_language}
                    onChange={handleSystemLanguageChange}
                    className="border border-neutral-200 rounded-sm py-0.5 text-sm focus:outline-none hover:bg-neutral-100"
                    >
                    <option value="en">en</option>
                    <option value="ko">ko</option>
                  </select>
                  {pendingLanguageChange ? (
                    <Button
                    text={t("Relaunch")}
                    onClick={() => {
                      void relaunchApp();
                    }}
                    black
                    />
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        </section>

        {mobileApp && (
          <section className="w-full flex flex-col gap-7 items-start">
            <h3 className="sticky top-0 pt-8 md:pt-12 bg-neutral-50 font-pretendard! z-10">{t("Notifications")}</h3>
            <div className="flex items-center gap-2 text-sm">
              <span>{t("now playing alerts")}</span>
              <button
                type="button"
                onClick={handleNowPlayingNotificationsToggle}
                aria-pressed={settings.now_playing_notifications}
                title={t("now playing alerts")}
                className={`
                  relative inline-flex h-5 w-9 items-center rounded-full
                  p-0.5 transition-colors
                  ${
                    settings.now_playing_notifications
                      ? "bg-neutral-700"
                      : "bg-neutral-300"
                  }
                `}
              >
                <div
                  className={`
                    h-4 w-4 rounded-full bg-white shadow-sm
                    transition-transform duration-200
                    ${
                      settings.now_playing_notifications
                        ? "translate-x-4"
                        : "translate-x-0"
                    }
                  `}
                />
              </button>
            </div>
            {settings.now_playing_notifications && notificationPermission && !notificationPermission.granted && (
              <button
                type="button"
                className="text-left text-xs text-neutral-500 underline underline-offset-2 cursor-pointer"
                onClick={() => setOpenNotificationModal(true)}
              >
                {t("Notifications are blocked on this device. Open settings.")}
              </button>
            )}
            <a
              href={ANDROID_PRIVACY_POLICY_URL}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-neutral-500 underline underline-offset-2"
            >
              {t("Android app privacy policy")}
            </a>
          </section>
        )}

        <section className="w-full flex flex-col gap-6">
          <h3 ref={languagePacksRef} className="sticky top-0 pt-8 md:pt-12 bg-neutral-50 font-pretendard! z-10 w-full pb-1">{t("Language packs")}</h3>
          <p className="text-sm">
            {mobileApp
              ? t("Activate only the languages you want to use on this device.")
              : t("To reduce storage, keep a single language version.")}
          </p>
          <PackTable />
        </section>

        <LocalLibrarySection />

        <section className="w-full flex flex-col gap-6 items-start">
          <h3 className="sticky top-0 pt-8 md:pt-12 bg-neutral-50 font-pretendard! z-10 w-full pb-1">{t("Profile")}</h3>
          <UserProfile />
        </section>
      </div>

      <NotificationPermissionModal
        open={openNotificationModal}
        onClose={() => setOpenNotificationModal(false)}
        onOpenSettings={handleOpenNotificationSettings}
      />
    </>
  );
}
