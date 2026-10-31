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
import type { Annotation, LemmaData, TextBlock, Token } from "../pageTypes";
import { useLayout } from "../RootLayout";
import { useSettings } from "../useSettings";

type TodayExample = {
  lemma: string;
  language: string;
  block: TextBlock;
  lemmaInfo: Record<string, LemmaData>;
  targetKey: string;
};

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
    const loadTodayExample = async () => {
      try {
        const recap = await getLemmaRecap(settings.recap_languages);
        const candidates = [...recap.showcase_items].sort(() => Math.random() - 0.5);
        for (const item of candidates) {
        try {
        const { lemma, pos, language: exampleLanguage } = keyParts(item.lemma_key);
        const lookup = await lemmaLookupOne({ lemma, pos }, exampleLanguage);
        const saved = await getUserLemmaExamples(item.lemma_key);
        const savedExample = saved[Math.floor(Math.random() * saved.length)];
        const block: TextBlock | null = savedExample
          ? { text: savedExample.text, tokens: savedExample.tokens }
          : (() => {
              const kwic = lookup.kwic[Math.floor(Math.random() * lookup.kwic.length)];
              return kwic
                ? { text: kwic.tokens.map((token: { surface: string }) => token.surface).join(" "), tokens: kwic.tokens }
                : null;
            })();
        if (!block) continue;
        const lookupItems = (block.tokens ?? [])
          .map((token: Token) => getLookupMorph(token, exampleLanguage))
          .filter((candidate): candidate is { lemma: string; pos: string } => candidate !== null)
          .filter((candidate, index, candidates) =>
            candidates.findIndex((other) => other.lemma === candidate.lemma && other.pos === candidate.pos) === index
          );
        const lemmaInfo = await lemmaLookup(lookupItems, exampleLanguage);
        if (savedExample) {
          if (!cancelled) setTodayExample({
            lemma,
            language: exampleLanguage,
            block,
            lemmaInfo,
            targetKey: lookup.key,
          });
          return;
        }
        if (cancelled) return;
        setTodayExample({
          lemma,
          language: exampleLanguage,
          block,
          lemmaInfo,
          targetKey: lookup.key,
        });
        return;
        } catch {
          // Try another showcase lemma when this device lacks its pack or it
          // has no usable user/pack example.
          continue;
        }
        }
      } catch {
        // The home composer remains useful offline or without a matching pack.
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
      <div className="relative flex min-w-0 flex-1 items-end justify-center px-3 pb-4 md:px-6 md:pb-6">
        {todayExample ? (
        <section className="absolute inset-x-6 top-20 text-left flex flex-col gap-4 md:top-24">
          <p className="text-xs text-neutral-400 pl-1">오늘의 예문</p>
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
              contentPaddingClass="p-0"
              allowOverflow
              getTokenClassName={({ key }) =>
                key === todayExample.targetKey
                  ? "relative z-10 before:pointer-events-none before:absolute before:inset-0 before:-mx-2 before:-my-1 before:-z-10 before:rounded-full before:bg-accent/50 before:content-['']"
                  : undefined
              }
            />
          </div>
        </section>
        ) : null}
        <div className="flex w-[min(36rem,100%)] flex-col rounded-2xl bg-neutral-50 p-4 shadow-sm transition-shadow focus-within:shadow-2xl">
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
