import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import {
  deleteAccount,
  getLatestVersionInfo,
  getInstalled,
  getLemmaRecap,
  isNewerVersion,
  resetLemmaProfile,
  resetTodayLemmaRecapSession,
  rerollLemmaRecapShowcase,
  type LatestVersionInfo,
  updateName,
  verifyToken,
} from "../../api";
import { Check, Pencil } from "lucide-react";
import { type User } from "../../types";
import Button, { IconButtonEvent } from "../util/Button";
import { useLocation, useNavigate } from "react-router-dom";
import PackTable from "./PackTable";
import { SettingToggle } from "../util/ToggleButton";
import { useSettings } from "../useSettings";
import { themeOptions, type ThemeId } from "../../themes";
import { isCapacitorApp, isElectronApp } from "../../platform";
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
import { clearLocalLibrary, exportLocalLibrary, importLocalLibrary } from "../../localLibrary";
import ThemeLogo from "../ThemeLogo";
import { GRADSHOW_MODE, GRADSHOW_USER } from "../../gradshow/mode";
import type { RecapState } from "../pageTypes";

const APP_VERSION = __APP_VERSION__;

function AppVersionSection() {
  const { t } = useI18n();
  const [latestVersionInfo, setLatestVersionInfo] =
    useState<LatestVersionInfo | null>(null);

  useEffect(() => {
    if (GRADSHOW_MODE) return;
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
    const target = latestVersionInfo?.download_url ?? "https://lema.solmi.wiki/#download";
    window.open(target, "_blank", "noopener,noreferrer");
  }

  return (
    <section className="w-full flex flex-col gap-6 items-start">
      <h3 className="sticky top-0 bg-neutral-50 font-pretendard! w-full pb-1">{t("App version")}</h3>
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

function LocalLibrarySection({ disabled = false }: { disabled?: boolean }) {
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
      <h3 className="sticky top-0 bg-neutral-50 font-pretendard! z-10 w-full pb-1">
        {t("Local library")}
      </h3>
      <div className="max-w-xl text-sm text-neutral-600 flex flex-col gap-4">
        <p >
          {t("Pages, notebooks, and annotations are stored only on this device. Export a backup to move or restore them on another device.")}
        </p>
        <p className="opacity-60">
          {t("Import keeps existing data and merges the selected library. Conflicting copies are preserved separately.")}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          text={busy === "export" ? t("Exporting...") : t("Export library")}
          onClick={() => void handleExport()}
          disabled={disabled || busy !== null}
        />
        <Button
          text={busy === "import" ? t("Importing...") : t("Import and merge")}
          onClick={() => void handleImport()}
          disabled={disabled || busy !== null}
        />
      </div>
      {message ? <p className="text-sm text-neutral-700">{message}</p> : null}
    </section>
  );
}

export function UserProfile() {
  const { t } = useI18n();
  const mobileApp = isCapacitorApp();
  const localLibraryAvailable = mobileApp || isElectronApp();
  const [editing, setEditing] = useState(false);
  const [user, setUser] = useState<User | null>(GRADSHOW_MODE ? GRADSHOW_USER : null);
  const [value, setValue] = useState("");
  const [openLogoutModal, setOpenLogoutModal] = useState(false);
  const [openDeleteModal, setOpenDeleteModal] = useState(false);
  const [openResetVocabularyModal, setOpenResetVocabularyModal] = useState(false);
  const [openResetLibraryModal, setOpenResetLibraryModal] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [resetVocabularyError, setResetVocabularyError] = useState("");
  const [resetLibraryError, setResetLibraryError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [resettingVocabulary, setResettingVocabulary] = useState(false);
  const [resettingLibrary, setResettingLibrary] = useState(false);
  const [offline, setOffline] = useState(
    mobileApp && !GRADSHOW_MODE && typeof navigator !== "undefined" ? !navigator.onLine : false,
  );
  const navigate = useNavigate();

  const loadProfile = useCallback(async () => {
    if (GRADSHOW_MODE) {
      setUser(GRADSHOW_USER);
      setValue(GRADSHOW_USER.name);
      setOffline(false);
      return;
    }
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

    if (!mobileApp || GRADSHOW_MODE) {
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
    if (user) {
      const nextUser = { ...user, name: value };
      await updateStoredUser(nextUser);
      setUser(nextUser);
    }
    setEditing(false);
  }

  async function logout() {
    await clearStoredSession();
    navigate("/login");
  }

  async function handleDeleteAccount() {
    setDeleting(true);
    setDeleteError("");

    try {
      await deleteAccount();
      await clearStoredSession();
      navigate("/login");
    } catch (error) {
      setDeleteError(
        error instanceof Error ? error.message : "Could not delete account.",
      );
      setDeleting(false);
    }
  }

  async function handleResetVocabulary() {
    setResettingVocabulary(true);
    setResetVocabularyError("");

    try {
      await resetLemmaProfile();
      setOpenResetVocabularyModal(false);
    } catch (error) {
      setResetVocabularyError(
        error instanceof Error ? error.message : "Could not reset vocabulary records.",
      );
    } finally {
      setResettingVocabulary(false);
    }
  }

  async function handleResetLocalLibrary() {
    setResettingLibrary(true);
    setResetLibraryError("");

    try {
      await clearLocalLibrary();
      window.dispatchEvent(new Event("lema:library-changed"));
      setOpenResetLibraryModal(false);
    } catch (error) {
      setResetLibraryError(
        error instanceof Error ? error.message : "Could not reset the local library.",
      );
    } finally {
      setResettingLibrary(false);
    }
  }

  return (
    <>
      {mobileApp && offline && !GRADSHOW_MODE ? (
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
            setResetVocabularyError("");
            setOpenResetVocabularyModal(true);
          }}
          text={t("Reset vocabulary records")}
          disabled={resettingVocabulary}
          red
        />

        {localLibraryAvailable && (
          <Button
            onClick={() => {
              setResetLibraryError("");
              setOpenResetLibraryModal(true);
            }}
            text={t("Reset local library")}
            disabled={resettingLibrary}
            red
          />
        )}

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

      <ResponsiveModal
        open={openResetVocabularyModal}
        onClose={() => setOpenResetVocabularyModal(false)}
      >
        <div className="flex flex-col gap-7 md:pb-3">
          <h2>{t("Reset vocabulary records?")}</h2>
          {offline ? (
            <p className="text-sm text-neutral-500">
              {t("You're offline. Check your connection and try again.")}
            </p>
          ) : (
            <>
              <p className="pr-8 text-sm text-neutral-500">
                {t("This deletes all vocabulary records stored for this account: known and interested words, exposure counts, memos, saved personal examples, and milestones. It also clears this device's offline vocabulary cache. Pages, notebooks, annotations, app settings, and downloaded language packs will remain.")}
              </p>
              {resetVocabularyError && (
                <p className="text-sm text-red-600">{resetVocabularyError}</p>
              )}
              <Button
                text={resettingVocabulary ? t("Resetting...") : t("Reset vocabulary records")}
                onClick={handleResetVocabulary}
                disabled={resettingVocabulary}
                fit
                red
              />
            </>
          )}
        </div>
      </ResponsiveModal>

      <ResponsiveModal
        open={openResetLibraryModal}
        onClose={() => setOpenResetLibraryModal(false)}
      >
        <div className="flex flex-col gap-7 md:pb-3">
          <h2>{t("Reset local library?")}</h2>
          <p className="pr-8 text-sm text-neutral-500">
            {t("This deletes every page, analysis result, notebook, annotation, and page metadata stored for this account on this device. Your account, vocabulary records, app settings, downloaded language packs, and local libraries on other devices will remain.")}
          </p>
          {resetLibraryError && (
            <p className="text-sm text-red-600">{resetLibraryError}</p>
          )}
          <Button
            text={resettingLibrary ? t("Resetting...") : t("Reset local library")}
            onClick={handleResetLocalLibrary}
            disabled={resettingLibrary}
            fit
            red
          />
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
  const [recapLanguages, setRecapLanguages] = useState<string[]>([]);
  const [debugRecap, setDebugRecap] = useState<RecapState | null>(null);
  const [rerollingRecap, setRerollingRecap] = useState(false);
  const [resettingRecap, setResettingRecap] = useState(false);
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
    if (GRADSHOW_MODE) return;
    void getInstalled()
      .then((packs: Array<{ lang: string; lemma_installed?: boolean; installed?: boolean }>) => {
        const languages = [...new Set(
          packs
            .filter((pack) => pack.lemma_installed || pack.installed)
            .map((pack) => pack.lang),
        )].sort();
        setRecapLanguages(languages);
        setSettings((previous) => previous.recap_languages.length
          ? previous
          : { ...previous, recap_languages: languages });
      })
      .catch(() => setRecapLanguages([]));
  }, []);

  const loadDebugRecap = useCallback(() => {
    if (GRADSHOW_MODE) return;
    void getLemmaRecap(settings.recap_languages).then(setDebugRecap).catch(() => setDebugRecap(null));
  }, [settings.recap_languages]);

  useEffect(() => {
    loadDebugRecap();
  }, [loadDebugRecap]);

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

  function handleThemeChange(event: ChangeEvent<HTMLSelectElement>) {
    const nextTheme = themeOptions.find(({ id }) => id === event.target.value)?.id;
    if (!nextTheme) return;

    setSettings((prev) => ({ ...prev, theme: nextTheme as ThemeId }));
  }

  function toggleRecapLanguage(language: string) {
    setSettings((previous) => ({
      ...previous,
      recap_languages: previous.recap_languages.includes(language)
        ? previous.recap_languages.filter((value) => value !== language)
        : [...previous.recap_languages, language],
    }));
  }

  async function rerollRecap() {
    setRerollingRecap(true);
    try {
      await rerollLemmaRecapShowcase(settings.recap_languages);
      loadDebugRecap();
    } finally {
      setRerollingRecap(false);
    }
  }

  async function resetTodayRecap() {
    setResettingRecap(true);
    try {
      await resetTodayLemmaRecapSession(settings.recap_languages);
      loadDebugRecap();
    } finally {
      setResettingRecap(false);
    }
  }

  return (
    <>
      <div className="w-full h-full overflow-y-scroll overflow-x-hidden flex flex-col gap-21 pr-3 z-30 pl-3 md:pl-6 bg-neutral-50 pb-7">
        <h2 className="mobile-page-heading top-0 pt-12 z-30">{t("Settings")}</h2>

        <AppVersionSection />

        <section className="w-full flex flex-col gap-6 items-start">
          <h3 className="sticky top-0 bg-neutral-50 font-pretendard! z-10 w-full pb-1">{t("Preferences")}</h3>
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
                <select
                  value={settings.theme}
                  onChange={handleThemeChange}
                  className="border border-neutral-200 rounded-sm py-0.5 text-sm focus:outline-none hover:bg-neutral-100"
                >
                  {themeOptions.map(({ id, label }) => (
                    <option key={id} value={id}>{t(label)}</option>
                  ))}
                </select>
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

              <div className="flex flex-col items-start gap-2">
                <span>Recap languages</span>
                <div className="flex flex-wrap gap-2">
                  {recapLanguages.map((language) => (
                    <label key={language} className="flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={settings.recap_languages.includes(language)}
                        onChange={() => toggleRecapLanguage(language)}
                      />
                      <span>{language}</span>
                    </label>
                  ))}
                </div>
                <p className="text-xs text-neutral-400">Choose the languages included when the next showcase is selected.</p>
              </div>
            </div>
          </div>
        </section>

        {mobileApp && !GRADSHOW_MODE && (
          <section className="w-full flex flex-col gap-7 items-start">
            <h3 className="sticky top-0 bg-neutral-50 font-pretendard! z-10">{t("Notifications")}</h3>
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
                    h-4 w-4 rounded-full bg-neutral-50 shadow-sm
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
          <h3 ref={languagePacksRef} className="sticky top-0 bg-neutral-50 font-pretendard! z-10 w-full pb-1">{t("Language packs")}</h3>
          <p className="text-sm">
            {t("To reduce storage, keep a single language version.")}
          </p>
          <fieldset
            disabled={GRADSHOW_MODE}
            className={GRADSHOW_MODE ? "min-w-0 border-0 p-0 opacity-45 pointer-events-none" : "min-w-0 border-0 p-0"}
          >
            <PackTable />
          </fieldset>
        </section>

        <LocalLibrarySection disabled={GRADSHOW_MODE} />

         <section className="w-full flex flex-col gap-6 items-start">
          <h3 className="sticky top-0 bg-neutral-50 font-pretendard! z-10 w-full">{t("Debug")}</h3>
          <div className="flex flex-col items-start text-sm gap-3">
            <div className="flex items-center gap-2 text-sm">
              <span>{t("Don't show this again")}</span>
              <SettingToggle
                settingKey="hide_lemma_swipe_hint"
                value={settings.hide_lemma_swipe_hint}
                toggleSetting={toggleSetting}
              />
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span>KWIC debug</span>
              <SettingToggle
                settingKey="show_kwic_debug"
                value={settings.show_kwic_debug}
                toggleSetting={toggleSetting}
              />
            </div>
            <div className="flex flex-col gap-2 text-xs text-neutral-500">
              <span>Current recap words</span>
              <span>Test: {debugRecap?.test_items.map((item) => item.lemma_key).join(", ") || "—"}</span>
              <span>Showcase: {debugRecap?.showcase_items.map((item) => item.lemma_key).join(", ") || "—"}</span>
              <Button text={rerollingRecap ? "Rerolling..." : "Reroll showcase"} onClick={() => void rerollRecap()} disabled={rerollingRecap || GRADSHOW_MODE} />
              <Button text={resettingRecap ? t("Resetting...") : t("Reset today's Revival")} onClick={() => void resetTodayRecap()} disabled={resettingRecap || GRADSHOW_MODE} />
            </div>
          </div>
        </section>

        <section className="w-full flex flex-col gap-6 items-start">
          <h3 className="sticky top-0 bg-neutral-50 font-pretendard! z-10 w-full pb-1">{t("Profile")}</h3>
          <fieldset
            disabled={GRADSHOW_MODE}
            className={GRADSHOW_MODE ? "min-w-0 border-0 p-0 opacity-45 pointer-events-none" : "min-w-0 border-0 p-0"}
          >
            <UserProfile />
          </fieldset>
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
