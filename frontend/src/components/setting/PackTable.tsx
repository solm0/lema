import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDownIcon, ChevronUpIcon, Trash2 } from "lucide-react";
import { getInstalled, getPacks, uninstallPack } from "../../api";
import { isNetworkError } from "../../network";
import { readPackCatalogSnapshot } from "../../packCatalogSnapshot";
import PackModal from "./PackModal";
import type { InstalledPack } from "../util/LanguageSelect";
import { invalidateInstalledLanguagesCache } from "../util/LanguageSelect";
import { useI18n } from "../../i18n";

export const HIDDEN_PACK_VERSIONS = new Set(["1.0.0"]);

export type Pack = {
  lang: string;
  version: string;
  lemma_filename: string;
  lemma_download_url: string;
  tag: string;
  corpus: {
    "Data source"?: string;
    "Corpora used"?: string;
  }[];
};

type SelectedInstall = {
  lang: string;
  version: string;
  filename: string;
  downloadUrl: string;
};

export const LANG_MAP: Record<string, string> = {
  ru: "Russian",
  de: "German",
  en: "English",
  ko: "Korean",
  ja: "Japanese",
  zh: "Chinese",
  fr: "French",
  es: "Spanish",
};

export function normalizePacksForTargetRelease(packs: Pack[]): Pack[] {
  return packs
    .sort((a, b) => {
      const langOrder = a.lang.localeCompare(b.lang, undefined, {
        sensitivity: "base",
      });

      if (langOrder !== 0) {
        return langOrder;
      }

      return b.version.localeCompare(a.version, undefined, {
        numeric: true,
        sensitivity: "base",
      });
    });
}

export default function PackTable() {
  const { t } = useI18n();
  const [packs, setPacks] = useState<Pack[]>([]);
  const [installed, setInstalled] = useState<InstalledPack[]>([]);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [selectedInstall, setSelectedInstall] = useState<SelectedInstall | null>(null);
  const [errorMap, setErrorMap] = useState<Record<string, string>>({});
  const expandedPointerDownRef = useRef<{
    x: number;
    y: number;
    shouldIgnoreClick: boolean;
  } | null>(null);

  function buildOfflinePacks(installedPacks: InstalledPack[]) {
    const cached = readPackCatalogSnapshot() as Pack[];
    const installedKeys = new Set(
      installedPacks
        .filter((pack) => pack.lemma_installed || pack.model_installed || pack.installed)
        .map((pack) => `${pack.lang}:${pack.version}`),
    );

    const cachedInstalled = cached.filter((pack) =>
      installedKeys.has(`${pack.lang}:${pack.version}`),
    );

    const missingInstalled = installedPacks
      .filter((pack) => pack.lemma_installed || pack.model_installed || pack.installed)
      .filter(
        (pack) =>
          !cachedInstalled.some(
            (cachedPack) =>
              cachedPack.lang === pack.lang && cachedPack.version === pack.version,
          ),
      )
      .map((pack) => ({
        lang: pack.lang,
        version: pack.version,
        lemma_filename: "",
        lemma_download_url: "",
        tag: "",
        corpus: [{}, {}],
      }));

    return normalizePacksForTargetRelease([...cachedInstalled, ...missingInstalled]);
  }

  async function reload() {
    try {
      const installedData = await getInstalled();
      invalidateInstalledLanguagesCache();
      setInstalled(installedData);

      try {
        const packsData = await getPacks();
        setPacks(normalizePacksForTargetRelease(packsData));
        setOffline(false);
      } catch (error) {
        setPacks(buildOfflinePacks(installedData));
        setOffline(isNetworkError(error));
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  function getInstallState(pack: Pack) {
    return (
      installed.find(
        (item) => item.lang === pack.lang && item.version === pack.version,
      ) ?? {
        lang: pack.lang,
        version: pack.version,
        installed: false,
        lemma_installed: false,
        model_installed: false,
      }
    );
  }

  function renderDesktopStatus(state: InstalledPack) {
    return state.installed ? (
      <div className="text-xs px-1.5 rounded-full bg-green-100 text-green-800/60">
        {t("Installed")}
      </div>
    ) : null;
  }

  function renderHeaderStatus(state: InstalledPack) {
    return renderDesktopStatus(state);
  }

  async function handleUninstall(pack: Pack) {
    const key = `${pack.lang}-${pack.version}`;

    try {
      setErrorMap((prev) => ({
        ...prev,
        [key]: "",
      }));

      await uninstallPack({
        lang: pack.lang,
        version: pack.version,
      });

      await reload();
    } catch {
      setErrorMap((prev) => ({
        ...prev,
        [key]: "Failed to uninstall pack.",
      }));
    }
  }

  const grouped = useMemo(() => {
    const map: Record<string, Pack[]> = {};

    for (const pack of packs) {
      if (!map[pack.lang]) {
        map[pack.lang] = [];
      }

      map[pack.lang].push(pack);
    }

    Object.keys(map).forEach((lang) => {
      map[lang].sort((a, b) =>
        b.version.localeCompare(a.version, undefined, {
          numeric: true,
          sensitivity: "base",
        }),
      );
    });

    return map;
  }, [packs]);

  const groupsToRender = useMemo(() => Object.entries(grouped), [grouped]);

  function openInstall(pack: Pack) {
    setSelectedInstall({
      lang: pack.lang,
      version: pack.version,
      filename: pack.lemma_filename,
      downloadUrl: pack.lemma_download_url,
    });
  }

  function collapseLanguage(lang: string) {
    setExpanded((prev) => ({
      ...prev,
      [lang]: false,
    }));
  }

  function handleExpandedPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    expandedPointerDownRef.current = {
      x: event.clientX,
      y: event.clientY,
      shouldIgnoreClick: false,
    };
  }

  function handleExpandedPointerUp(event: React.PointerEvent<HTMLDivElement>) {
    const pointerDown = expandedPointerDownRef.current;

    if (!pointerDown) {
      return;
    }

    const movedX = Math.abs(event.clientX - pointerDown.x);
    const movedY = Math.abs(event.clientY - pointerDown.y);

    if (movedX > 5 || movedY > 5) {
      pointerDown.shouldIgnoreClick = true;
    }
  }

  function handleExpandedClick(lang: string) {
    const pointerDown = expandedPointerDownRef.current;

    if (pointerDown?.shouldIgnoreClick || window.getSelection()?.toString()) {
      expandedPointerDownRef.current = null;
      return;
    }

    expandedPointerDownRef.current = null;
    collapseLanguage(lang);
  }

  return (
    <>
      <div className="flex flex-col">
        {loading ? (
          <div className="px-4 py-3 text-sm text-neutral-400">{t("Loading...")}</div>
        ) : null}

        {!loading && groupsToRender.map(([lang, langPacks]) => {
          const open = expanded[lang];
          const label = t(LANG_MAP[lang] || lang);
          const currentPack = langPacks[0];
          const currentState = currentPack ? getInstallState(currentPack) : null;

          return (
            <div
              key={lang}
              className="overflow-hidden border-t border-neutral-200 hover:bg-neutral-100 transition-colors"
            >
              <button
                onClick={() =>
                  setExpanded((prev) => ({
                    ...prev,
                    [lang]: !prev[lang],
                  }))
                }
                className="w-full flex items-center py-3 px-4 transition gap-3"
              >
                <span className="font-medium">{label}</span>
                {currentState ? renderHeaderStatus(currentState) : null}
                <div className="ml-auto">
                  {open ? (
                    <ChevronUpIcon size={18} />
                  ) : (
                    <ChevronDownIcon size={18} />
                  )}
                </div>
              </button>

              {open && (
                <div
                  onPointerDown={handleExpandedPointerDown}
                  onPointerUp={handleExpandedPointerUp}
                  onClick={() => handleExpandedClick(lang)}
                >
                  {langPacks.map((pack) => {
                    const state = getInstallState(pack);
                    const key = `${pack.lang}-${pack.version}`;
                    const isHiddenVersion = HIDDEN_PACK_VERSIONS.has(pack.version);
                    const shouldDisableRemove =
                      isHiddenVersion
                      || !(state.lemma_installed || state.model_installed || state.installed);

                    return (
                      <div
                        key={key}
                        className={`flex flex-col px-4 py-3 transition-opacity ${
                          isHiddenVersion ? "opacity-30" : ""
                        }`}
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="text-sm flex-1">
                            {pack.lang} v{pack.version}
                          </div>

                          <div className="text-sm flex-[2] flex flex-col">
                            <p>{pack.corpus[0]["Data source"]}</p>
                            <p>{pack.corpus[1]["Corpora used"]}</p>
                          </div>

                          <div className="flex-1">
                            <div
                              className="flex items-start justify-end gap-2"
                              onClick={(event) => event.stopPropagation()}
                            >
                              <div className="flex flex-col gap-2">
                                <button
                                  type="button"
                                  onClick={() => openInstall(pack)}
                                  disabled={offline || isHiddenVersion || state.installed}
                                  className={`rounded-sm px-3 py-2 text-xs transition-colors ${
                                    state.installed
                                      ? "bg-green-100 text-green-700/50"
                                      : "border border-neutral-300 bg-neutral-100 text-neutral-800 hover:bg-neutral-300 disabled:opacity-40 disabled:pointer-events-none"
                                  }`}
                                >
                                  {state.installed ? t("Installed") : t("Install")}
                                </button>
                              </div>

                              <button
                                type="button"
                                onClick={() => handleUninstall(pack)}
                                disabled={shouldDisableRemove}
                                className="rounded-sm p-2 text-neutral-600 transition-colors hover:bg-neutral-200 disabled:opacity-30 disabled:pointer-events-none disabled:hover:bg-transparent disabled:hover:text-neutral-600"
                                title={t("Remove language pack")}
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </div>
                        </div>

                        {errorMap[key] ? (
                          <div className="text-red-500 text-xs mt-2">
                            {t(errorMap[key])}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        {!loading && offline ? (
          <div className="px-4 py-3 text-sm text-neutral-400">
            {t("Connect to the internet to see installable languages.")}
          </div>
        ) : null}
      </div>

      {selectedInstall ? (
        <PackModal
          lang={selectedInstall.lang}
          version={selectedInstall.version}
          filename={selectedInstall.filename}
          downloadUrl={selectedInstall.downloadUrl}
          onClose={() => setSelectedInstall(null)}
          onInstalled={async () => {
            await reload();
          }}
        />
      ) : null}
    </>
  );
}
