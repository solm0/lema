import { useEffect, useState } from "react";
import { getInstalled } from "../../api";
import { Link } from "react-router-dom";
import { useI18n } from "../../i18n";

export type InstalledPack = {
  lang: string;
  version: string;
  installed: boolean;
  lemma_installed: boolean;
  model_installed?: boolean;
};

export type LanguageOption = {
  lang: string;
};

type NormalizedLanguageOption = {
  lang: string;
};

let installedPacksCache: InstalledPack[] | null = null;
let installedPacksPromise: Promise<InstalledPack[]> | null = null;

export function invalidateInstalledLanguagesCache() {
  installedPacksCache = null;
  installedPacksPromise = null;
}

function normalizeOptions(options: LanguageOption[]) {
  return options.map((option) => ({
    lang: option.lang,
  }));
}

function normalizeInstalledPacksResponse(
  res: unknown,
): InstalledPack[] {
  return Array.isArray(res) ? (res as InstalledPack[]) : [];
}

async function loadInstalledPacks() {
  if (installedPacksCache) {
    return installedPacksCache;
  }

  if (!installedPacksPromise) {
    installedPacksPromise = getInstalled()
      .then((res: InstalledPack[]) => {
        const normalized = normalizeInstalledPacksResponse(res);
        installedPacksCache = normalized;
        return normalized;
      })
      .finally(() => {
        installedPacksPromise = null;
      });
  }

  return installedPacksPromise;
}

export async function getInstalledPacksCached() {
  return loadInstalledPacks();
}

export async function hasLemmaPackInstalled(language: string) {
  const packs = await loadInstalledPacks();
  return packs.some(
    (pack) => pack.lang === language && pack.installed,
  );
}

export default function LanguageSelect({
  language,
  setLanguage,
  handleReset,
  setAnyLangInstalled,
  background = false,
  options,
  allowUnselected = false,
  disabled = false,
}: {
  language: string | null;
  setLanguage: (l: { lang: string } | null) => void;
  handleReset?: () => void;
  setAnyLangInstalled?: (i: boolean) => void;
  background?: boolean;
  options?: { lang: string }[];
  allowUnselected?: boolean;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const [languages, setLanguages] = useState<NormalizedLanguageOption[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;

    if (options) {
      setLanguages(normalizeOptions(options));
      setLoading(false);
      return () => {
        active = false;
      };
    }

    if (!installedPacksCache) {
      setLoading(true);
    }

    loadInstalledPacks()
      .then((packs) => {
        if (!active) return;
        setLanguages(
          packs
            .filter((pack) => pack.installed)
            .map((pack) => ({ lang: pack.lang })),
        );
      })
      .catch(() => {
        if (!active) return;
        setLanguages([]);
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [options]);

  useEffect(() => {
    setAnyLangInstalled?.(languages.length !== 0);
  }, [languages, setAnyLangInstalled]);

  useEffect(() => {
    if (allowUnselected) return;

    if (languages.length > 0 && !language) {
      setLanguage(languages[0]);
    }
  }, [allowUnselected, language, languages, setLanguage]);

  function handleLanguageChange(langObj: { lang: string }) {
    setLanguage(langObj);
    if (handleReset) handleReset();
  }

  return (
      <div className="flex flex-col gap-2 items-start">
        <div className={`shrink-0 flex gap-1 w-auto min-w-12 h-10 p-1 rounded-sm items-center ${background ? "bg-neutral-200/80" : "bg-neutral-50/80"}`}>
          {loading && <p className="px-2 text-sm text-neutral-400">{t("Loading...")}</p>}

          {!loading && languages.length === 0 && (
            disabled ? (
              <span className="px-2 text-sm text-neutral-400">
                {t("Install languages to continue.")}
              </span>
            ) : (
              <Link
                to="/setting"
                state={{ scrollTo: "language-packs" }}
                className="px-2 text-sm text-neutral-500 border border-neutral-300 hover:bg-neutral-200 transition-colors"
              >
                {t("Install languages to continue.")}
              </Link>
            )
          )}

          {!loading && languages.map((l) => (
            <button
              key={l.lang}
              onClick={() => handleLanguageChange(l)}
              disabled={disabled}
              className={`
                px-2 h-full rounded text-sm transition-colors
                ${language === l.lang
                  ? "bg-neutral-900 text-neutral-50"
                  : "hover:bg-neutral-300"}
              `}
            >
              {l.lang}
            </button>
          ))}
        </div>

      </div>
  );
}
