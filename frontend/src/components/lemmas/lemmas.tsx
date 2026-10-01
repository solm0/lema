import { useEffect, useMemo, useRef, useState } from "react"
import { getInterests, lemmaLookupOne, setInterest } from "../../api"
import { isNetworkError } from "../../network";
import { Star } from "lucide-react"
import ResponsiveSideLayout from "../util/ResponsiveSideLayout";
import Desk, { type DeskHandle } from "../lemma_expansions/Desk";
import KnownWordsMilestoneToast, { type KnownWordsMilestone } from "../lemma_expansions/KnownWordsMilestoneToast";
import type { LemmaData } from "../pageTypes";
import { useLayout } from "../RootLayout";
import { useI18n } from "../../i18n";
import LanguagePackRequiredModal from "../util/LanguagePackRequiredModal";
import OfflineState from "../util/OfflineState";
import { hasLemmaPackInstalled } from "../util/LanguageSelect";
import { isCapacitorApp } from "../../platform";
import { LanguageFilter } from "../pages/PageFilters";
import { GRADSHOW_MODE } from "../../gradshow/mode";

function groupLemmas(interests: Set<string>) {
  const groups: Record<string, string[]> = {}

  for (const key of interests) {
    const lemma = key.split("_")[0]
    const letter = lemma[0].toUpperCase()

    if (!groups[letter]) groups[letter] = []
    groups[letter].push(key)
  }

  // 정렬
  Object.keys(groups).forEach(letter => {
    groups[letter].sort((a, b) => a.localeCompare(b))
  })

  return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b))
}

export default function Lemmas(){
  const { t } = useI18n();
  const [interests, setInterests] = useState<Set<string>>(new Set());
  const [lemmaData, setLemmaData] = useState<LemmaData | null>(null);
  const [currentLang, setCurrentLang] = useState<string | null>(null);
  const [missingPackLang, setMissingPackLang] = useState<string | null>(null);
  const [pendingLemma, setPendingLemma] = useState<{
    lemma: string;
    pos: string;
    language: string;
  } | null>(null);
  const [offline, setOffline] = useState(false);
  const [selectedLanguage, setSelectedLanguage] = useState<string | null>(null);
  const [knownWordsMilestone, setKnownWordsMilestone] = useState<KnownWordsMilestone | null>(null);
  const mobileApp = isCapacitorApp();
  const { setTitlebarAction, setPanelOpen } = useLayout()
  const lastLemmaRef =
  useRef<LemmaData | null>(null)
  const deskRef = useRef<DeskHandle>(null);

  useEffect(() => {
    if (lemmaData) {
      lastLemmaRef.current = lemmaData
    }

    setPanelOpen(lemmaData !== null)
  }, [lemmaData])

  useEffect(() => {
    setTitlebarAction(() => {
      setLemmaData(prev => {
        if (prev) {
          return null
        }

        return lastLemmaRef.current
      })
    })

    return () => {
      setTitlebarAction(null)
    }
  }, [])

  // interest lemmas 가져오기
  useEffect(() => {
    const loadInterests = () => getInterests()
      .then((res) => {
        setOffline(GRADSHOW_MODE ? false : typeof navigator !== "undefined" ? !navigator.onLine : false);
        setInterests(new Set(res))
      })
      .catch((error) => {
        setOffline(isNetworkError(error));
      });

    void loadInterests();

    if (!mobileApp || GRADSHOW_MODE) return;

    const handleOffline = () => setOffline(true);
    const handleOnline = () => void loadInterests();
    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, [mobileApp])

  const languages = useMemo(
    () => Array.from(new Set(Array.from(interests, (key) => key.split("/").at(-1) ?? "")))
      .filter(Boolean)
      .sort(),
    [interests],
  );
  const filteredInterests = useMemo(
    () => selectedLanguage
      ? new Set(Array.from(interests).filter((key) => key.split("/").at(-1) === selectedLanguage))
      : interests,
    [interests, selectedLanguage],
  );
  const grouped = useMemo(() => groupLemmas(filteredInterests), [filteredInterests]);
  
  // 클릭
  const onInterestClick = async (key: string, next:boolean) => {
    await setInterest(key, next);

    const res = await getInterests();
    setInterests(new Set(res));
  };

  const onLemmaClick = async (lemma:string, pos:string, language:string) => {
    setCurrentLang(language);
    setPendingLemma({ lemma, pos, language });
    const hasPack = await hasLemmaPackInstalled(language);

    if (!hasPack) {
      setMissingPackLang(language);
      return;
    }

    const data = await lemmaLookupOne({ lemma, pos }, language);

    if (data.found === false) {
      const hasPackAfterLookup = await hasLemmaPackInstalled(language);

      if (!hasPackAfterLookup) {
        setMissingPackLang(language);
        return;
      }
    }

    setLemmaData(data);
    setPendingLemma(null);
  }

  return (
    <div className="relative w-full h-full flex pl-3 md:pl-6 bg-neutral-50">
      <LanguagePackRequiredModal
        language={missingPackLang ?? ""}
        open={missingPackLang !== null}
        onClose={() => {
          setMissingPackLang(null);
          setPendingLemma(null);
        }}
        onActivated={() => {
          if (pendingLemma) {
            void onLemmaClick(
              pendingLemma.lemma,
              pendingLemma.pos,
              pendingLemma.language,
            );
          }
        }}
      />

      <div className="flex-1 relative flex flex-col overflow-hidden gap-7">

        <div className="top-0 z-30 flex items-center gap-5 pt-12">
          <h2>{t("My Lemmas")}</h2>
          <LanguageFilter
            languages={languages}
            selectedLanguage={selectedLanguage}
            onLanguageChange={setSelectedLanguage}
          />
        </div>

        {offline && grouped.length > 0 ? (
          <p className="text-xs text-neutral-400">
            {t("You're offline. Check your connection and try again.")}
          </p>
        ) : null}

        {offline && grouped.length === 0 ? (
          <OfflineState
            onRetry={() => {
              void getInterests()
                .then((res) => {
                  setOffline(typeof navigator !== "undefined" ? !navigator.onLine : false);
                  setInterests(new Set(res));
                })
                .catch((error) => {
                  setOffline(isNetworkError(error));
                });
            }}
          />
        ) : null}
        
        <div className="overflow-y-scroll flex flex-wrap content-start gap-x-1 gap-y-7 pb-18 pt-7">
          {grouped.map(([letter, items]) => (
            <div key={letter} className="min-w-46 flex-1 basis-46 pr-3 md:pr-6">
              <div className="mb-2 pb-1 pl-1 text-sm text-neutral-400 flex border-b border-neutral-300">{letter}</div>
              <div className="flex flex-col">
                {items.map(key => {
                  const [lemma, pos, lang] = key.split("/")
                  const isInterested = interests.has(key)

                  return (
                    <div
                      key={key}
                      className="group flex items-center gap-2 min-w-46 px-1"
                    >
                      <p
                        onClick={() => onLemmaClick(lemma,pos,lang)}
                        className="truncate cursor-pointer flex gap-2 items-baseline"
                      >
                        {lemma}
                        <span className="text-xs text-neutral-400">{lang}</span>
                        <span className="text-xs text-neutral-400">{pos}</span>
                      </p>

                      <Star
                        size={17}
                        className="cursor-pointer opacity-0 group-hover:opacity-100 transition text-neutral-400 hover:text-neutral-500"
                        fill={isInterested ? "currentColor" : "transparent"}
                        onClick={() => {
                          void onInterestClick(key, !isInterested);
                        }}
                      />
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {lemmaData &&
        <ResponsiveSideLayout
          open={!!lemmaData}
          onClose={()=>setLemmaData(null)}
          onSwipeRight={() => deskRef.current?.markActiveKnown()}
        >
          <Desk
            ref={deskRef}
            key={lemmaData.key}
            initialLemma={lemmaData}
            onToggleInterest={onInterestClick}
            language={currentLang!}
            interestKeys={interests}
            onKnownWordsMilestone={setKnownWordsMilestone}
          />
        </ResponsiveSideLayout>
      }
      <KnownWordsMilestoneToast
        milestone={knownWordsMilestone}
        onClose={() => setKnownWordsMilestone(null)}
      />
    </div>
  )
}
