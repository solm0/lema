import { useEffect, useRef, useState } from "react";
import { Check, Circle, Copy, Star } from "lucide-react";
import LemmaKwic from "./LemmaKwic";
import type { LemmaData } from "../pageTypes";
import { useI18n } from "../../i18n";
import { Toast, ToastDescription, ToastProvider, ToastTitle, ToastViewport } from "../ui/toast";

export default function LemmaExpansion({
  data,
  onSelect,
  onToggleInterest,
  language,
  lemmaInfo,
  interestKeys,
  isKnown,
  onToggleKnown,
}: {
  data: LemmaData;
  onSelect: (tokenKey: string) => void;
  onToggleInterest: (key: string, next: boolean) => Promise<void>;
  language: string;
  lemmaInfo?: Record<string, LemmaData>;
  interestKeys?: Set<string>;
  isKnown: boolean;
  onToggleKnown: (next: boolean) => Promise<void>;
}) {
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);
  const [showKnownConfirmation, setShowKnownConfirmation] = useState(false);
  const [copyIconState, setCopyIconState] = useState<"idle" | "copied" | "hidden">("idle");
  const copyIconTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const id = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => () => {
    if (copyIconTimerRef.current !== null) window.clearTimeout(copyIconTimerRef.current);
  }, []);

  const parts = data.key.split("_");
  const pos = parts.pop() ?? "";
  const lemma = parts.join("_");
  const globalKey = data.global_key ?? `${lemma}/${pos}/${language}`;
  const isInterested = interestKeys?.has(globalKey) ?? data.is_interested;

  const handleKnownClick = () => {
    const nextKnown = !isKnown;
    if (nextKnown) setShowKnownConfirmation(true);
    else setShowKnownConfirmation(false);
    void onToggleKnown(nextKnown);
  };

  const copyLemma = async () => {
    try {
      await navigator.clipboard.writeText(lemma);
    } catch {
      const textArea = document.createElement("textarea");
      textArea.value = lemma;
      textArea.style.position = "fixed";
      textArea.style.opacity = "0";
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand("copy");
      textArea.remove();
    }

    if (copyIconTimerRef.current !== null) window.clearTimeout(copyIconTimerRef.current);
    setCopyIconState("copied");
    copyIconTimerRef.current = window.setTimeout(() => {
      setCopyIconState("hidden");
      copyIconTimerRef.current = null;
    }, 1200);
  };

  return (
    <ToastProvider duration={3000} swipeDirection="right">
      <div className={`flex h-full w-full flex-col overflow-hidden transition-opacity duration-300 ${
        visible ? "opacity-100" : "opacity-0"
      }`}>
      <section className="min-h-0 w-full flex-1">
        <LemmaKwic
          data={data.kwic}
          onSelect={onSelect}
          lemma={data.key}
          language={language}
          lemmaInfo={lemmaInfo}
          interestKeys={interestKeys}
        />
      </section>

      <footer className="relative flex h-18 shrink-0 items-center justify-center px-4 pb-2 pt-1">
        <button
          type="button"
          aria-label={isInterested ? "관심 단어에서 제거" : "관심 단어로 추가"}
          className={`absolute bottom-5 left-5 rounded-full p-1 transition-colors ${
            isInterested ? "text-yellow-400" : "text-neutral-400 hover:text-neutral-500"
          }`}
          onClick={() => void onToggleInterest(globalKey, !isInterested)}
        >
          <Star
            size={19}
            fill={isInterested ? "currentColor" : "transparent"}
            stroke="currentColor"
          />
        </button>

        <div className="flex min-w-0 flex-col items-center text-center">
          {language === "ja" && data.furigana && (
            <span className="max-w-32 truncate text-[9px] leading-tight text-neutral-400">
              {data.furigana}
            </span>
          )}
          <div className="flex flex-col items-center">
            <div
              className="group/lemma relative"
              onMouseEnter={() => {
                if (copyIconState === "hidden") setCopyIconState("idle");
              }}
              onMouseLeave={() => setCopyIconState("idle")}
            >
              <button
                type="button"
                aria-label={t("Copy “{lemma}”", { lemma })}
                className="font-body max-w-36 truncate text-sm leading-tight text-neutral-700 md:max-w-40 md:text-xl md:font-semibold"
                data-font-language={language}
                onClick={() => void copyLemma()}
              >
                {lemma}
              </button>
              <span
                aria-hidden="true"
                className={`pointer-events-none absolute left-full top-1/2 ml-1 -translate-y-1/2 p-1 text-neutral-400 transition-opacity md:block ${
                copyIconState === "hidden"
                  ? "opacity-0"
                  : copyIconState === "copied"
                    ? "opacity-100"
                    : "opacity-0 group-hover/lemma:opacity-100"
                } hidden`}
              >
                {copyIconState === "copied" ? <Check size={15} /> : <Copy size={15} />}
              </span>
            </div>
            <span className="text-[9px] leading-4 text-neutral-400">{pos}</span>
          </div>
        </div>

        <button
          type="button"
          aria-label={isKnown ? t("Known word") : t("I know this word")}
          className={`absolute bottom-5 right-5 flex h-7 w-7 items-center justify-center transition-colors ${
            isKnown ? "text-neutral-700" : "text-neutral-300 hover:text-neutral-500"
          }`}
          onClick={handleKnownClick}
        >
          {isKnown ? <Check size={19} strokeWidth={2.5} /> : <Circle size={17} />}
        </button>

        <Toast
          open={showKnownConfirmation}
          onOpenChange={setShowKnownConfirmation}
          duration={3000}
          className="border-green-200 bg-green-100 text-sm text-green-700"
        >
          <ToastTitle className="flex items-center gap-2">
            <Check className="h-4 w-4 shrink-0 text-green-600" />
            <span>{t("You know “{lemma}”.", { lemma })}</span>
          </ToastTitle>
          <ToastDescription className="pl-6 leading-snug">
            {t("sentences containing “{lemma}” will be shown first.", { lemma })}
          </ToastDescription>
        </Toast>
        <ToastViewport className="absolute bottom-full left-1/2 mb-3 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 p-0" />
      </footer>
      </div>
    </ToastProvider>
  );
}
