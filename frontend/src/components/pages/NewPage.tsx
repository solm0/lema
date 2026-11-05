import { useNavigate } from "react-router-dom";
import { ArrowUp, Music4 } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNowPlaying } from "../lyric/useNowPlaying";
import { useI18n } from "../../i18n";
import LanguageSelect from "../util/LanguageSelect";
import { GRADSHOW_MODE } from "../../gradshow/mode";
import { getLemmaRecap, getUserLemmaExamples, lemmaLookup, lemmaLookupOne, setInterest } from "../../api";
import PageContent from "../pageview/PageContent";
import type { SidePanelState } from "../pageview/PageView";
import Desk from "../lemma_expansions/Desk";
import ResponsiveSideLayout from "../util/ResponsiveSideLayout";
import { getLookupMorph } from "../tokenLookup";
import type { Annotation, KwicData, LemmaData, TextBlock, Token } from "../pageTypes";
import { useLayout } from "../RootLayout";
import { useSettings } from "../useSettings";
import Revival from "../lemmas/Revival";

type TodayExample = {
  lemma: string;
  language: string;
  block: TextBlock;
  lemmaInfo: Record<string, LemmaData>;
};

const TODAY_EXAMPLE_CACHE_KEY = "today-example-cache";
const MAX_TODAY_EXAMPLES = 5;

function todayExampleCacheKey(languages: string[]) {
  const now = new Date();
  return JSON.stringify([now.getFullYear(), now.getMonth(), now.getDate(), [...languages].sort()]);
}

function keyParts(key: string) {
  const [lemma, pos, language] = key.split("/");
  return { lemma, pos, language };
}

export function NewPage() {
  const navigate = useNavigate();
  const { setBreadcrumbOpen, setPanelOpen } = useLayout();
  const { settings } = useSettings();
  const { hasTrack } = useNowPlaying({ enabled: !GRADSHOW_MODE });
  const { t } = useI18n();
  const [pasteText, setPasteText] = useState("");
  const [language, setLanguage] = useState<string | null>(null);
  const [todayExample, setTodayExample] = useState<TodayExample | null>(null);
  const [todayExampleLoading, setTodayExampleLoading] = useState(true);
  const [panel, setPanel] = useState<SidePanelState>(null);
  const [todayAnnotations, setTodayAnnotations] = useState<Annotation[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const canAnalyze = Boolean(pasteText.trim() && language);

  useEffect(() => {
    const lemmaPanelOpen = panel?.type === "lemma";
    setPanelOpen(lemmaPanelOpen);
    if (lemmaPanelOpen) setBreadcrumbOpen(true);
    return () => setPanelOpen(false);
  }, [panel?.type, setBreadcrumbOpen, setPanelOpen]);

  useEffect(() => {
    if (GRADSHOW_MODE) return;
    let cancelled = false;
    const cacheKey = todayExampleCacheKey(settings.recap_languages);
    try {
      const cached = JSON.parse(localStorage.getItem(TODAY_EXAMPLE_CACHE_KEY) ?? "null");
      if (cached?.key === cacheKey && Array.isArray(cached.examples) && cached.examples.length > 0 &&
          cached.examples.every((example: TodayExample) => example?.block && example?.lemmaInfo)) {
        const examples = cached.examples as TodayExample[];
        const lastIndex = Number.isInteger(cached.lastIndex) ? cached.lastIndex : -1;
        let index = Math.floor(Math.random() * examples.length);
        if (examples.length > 1 && index === lastIndex) index = (index + 1) % examples.length;
        setTodayExample(examples[index]);
        setTodayExampleLoading(false);
        try {
          localStorage.setItem(TODAY_EXAMPLE_CACHE_KEY, JSON.stringify({ key: cacheKey, examples, lastIndex: index }));
        } catch {
          // Continue showing the cached example if storage is unavailable.
        }
        return;
      }
    } catch {
      // Ignore unavailable or invalid cached data and fetch fresh examples.
    }
    setTodayExampleLoading(true);
    setTodayExample(null);
    const loadTodayExample = async () => {
      const examples: TodayExample[] = [];
      const seen = new Set<string>();
      try {
        const recap = await getLemmaRecap(settings.recap_languages);
        const candidates = [...recap.showcase_items].sort(() => Math.random() - 0.5);
        for (const item of candidates) {
          if (cancelled || examples.length >= MAX_TODAY_EXAMPLES) break;
          try {
            const { lemma, pos, language: exampleLanguage } = keyParts(item.lemma_key);
            const [lookup, saved] = await Promise.all([
              lemmaLookupOne({ lemma, pos }, exampleLanguage),
              getUserLemmaExamples(item.lemma_key),
            ]);
            const blocks: TextBlock[] = [
              ...saved.map((example) => ({ text: example.text, tokens: example.tokens })),
              ...lookup.kwic.map((kwic: KwicData) => ({
                text: kwic.tokens.map((token) => token.surface).join(" "),
                tokens: kwic.tokens,
              })),
            ].sort(() => Math.random() - 0.5);
            for (const block of blocks) {
              if (cancelled || examples.length >= MAX_TODAY_EXAMPLES) break;
              const identity = `${exampleLanguage}:${block.text.trim()}`;
              if (!block.text.trim() || seen.has(identity)) continue;
              seen.add(identity);
              try {
                const lookupItems = (block.tokens ?? [])
                  .map((token: Token) => getLookupMorph(token, exampleLanguage))
                  .filter((candidate): candidate is { lemma: string; pos: string } => candidate !== null)
                  .filter((candidate, index, all) =>
                    all.findIndex((other) => other.lemma === candidate.lemma && other.pos === candidate.pos) === index
                  );
                const lemmaInfo = await lemmaLookup(lookupItems, exampleLanguage);
                if (cancelled) return;
                const example = { lemma, language: exampleLanguage, block, lemmaInfo };
                examples.push(example);
                if (examples.length === 1) {
                  setTodayExample(example);
                  setTodayExampleLoading(false);
                }
              } catch {
                // Continue with another example if its word lookup fails.
              }
            }
          } catch {
            // Try another lemma if its examples or language pack are unavailable.
          }
        }
        if (!cancelled && examples.length > 0) {
          try {
            localStorage.setItem(TODAY_EXAMPLE_CACHE_KEY, JSON.stringify({ key: cacheKey, examples, lastIndex: 0 }));
          } catch {
            // The displayed example remains available if storage is unavailable.
          }
        }
      } catch {
        // The home composer remains useful offline or without a matching pack.
      } finally {
        if (!cancelled) setTodayExampleLoading(false);
      }
    };
    void loadTodayExample();
    return () => { cancelled = true; };
  }, [settings.recap_languages]);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.style.height = "0px";

    const lineHeight = Number.parseFloat(
      window.getComputedStyle(textarea).lineHeight,
    ) || 24;
    const maxHeight = lineHeight * 10;
    const contentHeight = textarea.scrollHeight;

    textarea.style.height = `${Math.min(Math.max(contentHeight, lineHeight), maxHeight)}px`;
    textarea.style.overflowY = contentHeight > maxHeight ? "auto" : "hidden";
  }, [pasteText]);

  const handleAnalyze = () => {
    if (!canAnalyze || !language) return;

    navigate("/new", {
      state: {
        pasteText,
        language,
        autoAnalyze: true,
      },
    });
  };

  return (
    <div className="flex h-full w-full min-w-0 bg-neutral-100">
      <div className="relative flex min-w-0 flex-1 justify-center p-4 pb-8 md:px-4 md:pb-6">
        {!GRADSHOW_MODE && (
          <section className="overflow-y-auto mt-21 flex flex-col gap-3 max-w-200 flex w-[min(48rem,100%)]">

            <div className={`relative isolate overflow-hidden min-h-32 bg-neutral-200 rounded-3xl px-4 py-5 ${todayExampleLoading ? "today-example-loading" : ""}`} aria-busy={todayExampleLoading}>
              <p className="text-sm font-medium text-neutral-400 pb-3 pl-1">{t("Today's example")}</p>
              {todayExample && (
                <div className="h-auto overflow-visible">
                  <PageContent
                    blocks={[todayExample.block]}
                    lemmaInfo={todayExample.lemmaInfo}
                    panelData={panel}
                    setPanelData={setPanel}
                    language={todayExample.language}
                    annotations={todayAnnotations}
                    setAnnotations={setTodayAnnotations}
                    horizontalAlign="left"
                    textAlign="left"
                    contentPaddingClass="p-0"
                    allowOverflow
                  />
                </div>
              )}
            </div>
            <Revival />
          </section>
        )}
        <div className="absolute bottom-4 md:bottom-6 flex w-[min(48rem,100%-2rem)] flex-col rounded-3xl bg-neutral-50 p-4 shadow-none transition-shadow focus-within:shadow-lg">
          <textarea
            ref={textareaRef}
            rows={1}
            value={pasteText}
            onChange={(event) => setPasteText(event.target.value)}
            placeholder={t("Paste text")}
            className="min-h-[1lh] max-h-[10lh] w-full resize-none bg-transparent px-1 text-base leading-6 outline-none placeholder:text-neutral-400"
            spellCheck={false}
            disabled={GRADSHOW_MODE}
          />

          <div className="mt-3 flex items-end gap-3">
            <LanguageSelect
              language={language}
              setLanguage={(nextLanguage) => setLanguage(nextLanguage?.lang ?? null)}
              disabled={GRADSHOW_MODE}
            />
            <button
              type="button"
              onClick={() => navigate("/lyric")}
              disabled={GRADSHOW_MODE}
              className={`relative isolate ml-auto flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${
                hasTrack
                  ? "bg-accent/15 text-accent"
                  : "bg-transparent hover:bg-neutral-100"
              }`}
              title={t("Get lyrics")}
            >
              {hasTrack ? (
                <span
                  aria-hidden="true"
                  className="absolute -inset-2 z-0 rounded-full bg-accent/10 animate-ping motion-reduce:animate-none"
                  style={{ animationDuration: "2.4s" }}
                />
              ) : null}
              <Music4 size={18} className="relative z-10" />
            </button>
            <button
              type="button"
              onClick={handleAnalyze}
              disabled={GRADSHOW_MODE || !canAnalyze}
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors ${
                canAnalyze
                  ? "bg-neutral-900 text-neutral-50 hover:bg-neutral-700"
                  : "cursor-default bg-neutral-200 text-neutral-400"
              }`}
              title={t("Done")}
            >
              <ArrowUp size={18} />
            </button>
          </div>
        </div>
      </div>
      <ResponsiveSideLayout open={panel?.type === "lemma"} onClose={() => setPanel(null)}>
        {panel?.type === "lemma" && todayExample ? (
          <Desk
            initialLemma={panel.data}
            language={todayExample.language}
            lemmaInfo={todayExample.lemmaInfo}
            userExampleCapture={panel.userExampleCapture}
            saveUserExample={false}
            onToggleInterest={setInterest}
          />
        ) : null}
      </ResponsiveSideLayout>
    </div>
  )
}
