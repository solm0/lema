import { useNavigate } from "react-router-dom";
import { ArrowUp, Music4 } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { useNowPlaying } from "../lyric/useNowPlaying";
import { useI18n } from "../../i18n";
import LanguageSelect from "../util/LanguageSelect";
import { GRADSHOW_MODE } from "../../gradshow/mode";

export function NewPage() {
  const navigate = useNavigate();
  const { hasTrack } = useNowPlaying({ enabled: !GRADSHOW_MODE });
  const { t } = useI18n();
  const [pasteText, setPasteText] = useState("");
  const [language, setLanguage] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const canAnalyze = Boolean(pasteText.trim() && language);

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
    <div className="relative flex h-full w-full items-center justify-center bg-neutral-transparent">
      <button
        type="button"
        onClick={() => navigate("/lyric")}
        disabled={GRADSHOW_MODE}
        className="fixed right-4 bottom-20 md:right-6 md:bottom-6 z-20 isolate flex h-10 w-10 items-center justify-center rounded-full bg-neutral-100 hover:opacity-70 transition-opacity disabled:cursor-not-allowed disabled:opacity-35"
        title={t("Lyrics")}
      >
        {hasTrack ? (
          <span
            aria-hidden="true"
            className="absolute inset-0 -z-10 rounded-full bg-neutral-50 animate-ping motion-reduce:animate-none"
            style={{ animationDuration: "2.4s" }}
          />
        ) : null}
        <Music4 size={18} />
      </button>

      <div className="flex w-[min(36rem,calc(100%-3rem))] flex-col rounded-2xl bg-neutral-50 p-4 shadow-sm transition-shadow focus-within:shadow-2xl">
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

        <div className="mt-3 flex items-end justify-between gap-3">
          <LanguageSelect
            language={language}
            setLanguage={(nextLanguage) => setLanguage(nextLanguage?.lang ?? null)}
            disabled={GRADSHOW_MODE}
          />
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
  )
}
