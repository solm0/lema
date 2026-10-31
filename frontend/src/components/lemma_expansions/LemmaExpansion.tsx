import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, Check, GraduationCap, Star } from "lucide-react";
import LemmaKwic from "./LemmaKwic";
import type { LemmaData } from "../pageTypes";
import { useI18n } from "../../i18n";
import LemmaActivityToast from "./LemmaActivityToast";
import { isCapacitorApp } from "../../platform";

const MAX_MEMO_LENGTH = 20;

export default function LemmaExpansion({
  data,
  onSelect,
  onToggleInterest,
  language,
  lemmaInfo,
  interestKeys,
  isKnown,
  onToggleKnown,
  memo,
  onSaveMemo,
  onMemoEditingChange,
}: {
  data: LemmaData;
  onSelect: (tokenKey: string) => void;
  onToggleInterest: (key: string, next: boolean) => Promise<void>;
  language: string;
  lemmaInfo?: Record<string, LemmaData>;
  interestKeys?: Set<string>;
  isKnown: boolean;
  onToggleKnown: (next: boolean) => Promise<void>;
  memo: string;
  onSaveMemo: (memo: string) => Promise<void>;
  onMemoEditingChange: (editing: boolean) => void;
}) {
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);
  const [showKnownConfirmation, setShowKnownConfirmation] = useState(false);
  const [showCopyConfirmation, setShowCopyConfirmation] = useState(false);
  const [memoValue, setMemoValue] = useState(memo);
  const [memoRevealed, setMemoRevealed] = useState(false);
  const [editingMemo, setEditingMemo] = useState(false);
  const [isMobile, setIsMobile] = useState(
    () => isCapacitorApp() || (typeof window !== "undefined" && window.innerWidth < 768),
  );
  const memoInputRef = useRef<HTMLTextAreaElement>(null);
  const savingMemoRef = useRef(false);

  useEffect(() => {
    const id = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    if (!showKnownConfirmation) return;
    const timer = window.setTimeout(() => setShowKnownConfirmation(false), 3000);
    return () => window.clearTimeout(timer);
  }, [showKnownConfirmation]);

  useEffect(() => {
    if (!showCopyConfirmation) return;
    const timer = window.setTimeout(() => setShowCopyConfirmation(false), 3000);
    return () => window.clearTimeout(timer);
  }, [showCopyConfirmation]);

  useEffect(() => {
    setMemoValue(memo);
    setMemoRevealed(false);
    setEditingMemo(false);
  }, [data.key, memo]);

  useEffect(() => {
    const update = () => setIsMobile(isCapacitorApp() || window.innerWidth < 768);
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  useEffect(() => {
    if (!editingMemo) return;
    requestAnimationFrame(() => memoInputRef.current?.focus());
  }, [editingMemo]);

  useEffect(() => {
    onMemoEditingChange(isMobile && editingMemo);
    return () => onMemoEditingChange(false);
  }, [editingMemo, isMobile, onMemoEditingChange]);

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

    setShowCopyConfirmation(true);
  };

  const saveMemo = useCallback(async () => {
    if (savingMemoRef.current) return;
    savingMemoRef.current = true;
    const nextMemo = memoValue.slice(0, MAX_MEMO_LENGTH);
    setMemoValue(nextMemo);
    setEditingMemo(false);
    setMemoRevealed(Boolean(nextMemo));
    try {
      await onSaveMemo(nextMemo);
    } finally {
      savingMemoRef.current = false;
    }
  }, [memoValue, onSaveMemo]);

  const startMemo = () => {
    if (isMobile || !memoValue || memoRevealed) {
      setMemoRevealed(true);
      setEditingMemo(true);
      return;
    }
    setMemoRevealed(true);
  };

  const setLimitedMemo = (value: string) => {
    setMemoValue(value.slice(0, MAX_MEMO_LENGTH));
  };

  const onMemoKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void saveMemo();
  };

  if (isMobile && editingMemo) {
    return (
      <div className="relative h-full w-full">
        <div className="pointer-events-none absolute left-4 top-4 z-10 flex items-center gap-3">
          <span
            className="font-body max-w-36 truncate text-2xl font-semibold leading-none text-neutral-700"
            data-font-language={language}
          >
            {lemma}
          </span>
          <span className="translate-y-0.5 font-mono text-xs font-semibold uppercase text-neutral-400">
            {pos}
          </span>
        </div>
        <textarea
          ref={memoInputRef}
          value={memoValue}
          maxLength={MAX_MEMO_LENGTH}
          onChange={(event) => setLimitedMemo(event.target.value)}
          onBlur={() => void saveMemo()}
          onKeyDown={onMemoKeyDown}
          placeholder={t("Add your thoughts...")}
          spellCheck={false}
          className="h-full w-full resize-none bg-transparent px-4 pb-4 pt-14 pr-14 text-sm leading-6 text-neutral-600 outline-none placeholder:text-neutral-400"
        />
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => void saveMemo()}
          className="absolute bottom-4 right-4 flex h-8 w-8 items-center justify-center rounded-full bg-neutral-900 text-neutral-50 transition-colors hover:bg-neutral-700"
          title={t("Done")}
        >
          <ArrowUp size={17} />
        </button>
        <p className={`absolute bottom-4 left-4 text-xs ${memoValue.length >= MAX_MEMO_LENGTH ? "text-[var(--app-red-500)]" : "text-neutral-400"}`}>
          {memoValue.length}/{MAX_MEMO_LENGTH}
        </p>
      </div>
    );
  }

  return (
    <div className={`relative flex h-full w-full flex-col overflow-hidden transition-opacity duration-300 ${
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

      <footer className="relative flex flex-col h-26 md:h-28 shrink-0 gap-4 px-4 pb-4 pt-0">
        <div className="flex items-start justify-between w-full">

          <div className="flex flex-col min-w-0">
            {language === "ja" && data.furigana && (
              <span className="max-w-32 pl-0.5 truncate text-xs font-medium leading-tight text-neutral-400">
                {data.furigana}
              </span>
            )}
            <div className="flex gap-3 items-center">
              <button
                type="button"
                aria-label={t("Copy “{lemma}”", { lemma })}
                className="font-body leading-none overflow-visible h-full max-w-36 truncate text-neutral-700 transition-opacity hover:opacity-80 md:max-w-40 text-2xl font-semibold"
                data-font-language={language}
                onClick={() => void copyLemma()}
              >
                {lemma}
              </button>
              <div className="translate-y-0.5 text-xs uppercase font-mono font-semibold text-neutral-400">{pos}</div>
              <button
                type="button"
                aria-label={isInterested ? "관심 단어에서 제거" : "관심 단어로 추가"}
                className={`p-1 transition-colors ${
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
            </div>
          </div>

          <button
            type="button"
            aria-label={isKnown ? t("Known word") : t("I know this word")}
            className={`p-1 transition-colors ${
              isKnown ? "text-[var(--app-green-500)]" : "text-neutral-400 hover:text-neutral-500"
            }`}
            onClick={handleKnownClick}
          >
          <GraduationCap size={19} fill="transparent" stroke="currentColor" />
          </button>
        </div>

        <div className="w-full">
          {editingMemo ? (
            <textarea
              ref={memoInputRef}
              rows={1}
              value={memoValue}
              maxLength={MAX_MEMO_LENGTH}
              onChange={(event) => setLimitedMemo(event.target.value)}
              onBlur={() => void saveMemo()}
              onKeyDown={onMemoKeyDown}
              placeholder="Memo..."
              spellCheck={false}
              className="block w-full resize-none bg-transparent text-sm leading-5 text-neutral-600 outline-none placeholder:text-neutral-400"
            />
          ) : (
            <button
              type="button"
              onMouseEnter={() => memoValue && setMemoRevealed(true)}
              onFocus={() => memoValue && setMemoRevealed(true)}
              onClick={startMemo}
              className={`block max-w-full truncate rounded-sm text-left text-sm leading-5 transition-colors ${
                memoValue
                  ? memoRevealed
                    ? "text-neutral-600"
                    : "bg-neutral-200 text-transparent"
                  : "text-neutral-400 hover:text-accent"
              }`}
            >
              {memoValue || "Memo..."}
            </button>
          )}
          <p className={`pt-2 h-4 text-xs ${editingMemo && memoValue.length >= MAX_MEMO_LENGTH ? "text-[var(--app-red-500)]" : "text-neutral-400"} ${editingMemo ? "opacity-100" : "opacity-0"}`}>
            {memoValue.length}/{MAX_MEMO_LENGTH}
          </p>
        </div>

      </footer>
      <LemmaActivityToast
        open={showKnownConfirmation}
        icon={<Check className="h-4 w-4 text-green-600" />}
        title={t("You know “{lemma}”.", { lemma })}
        description={t("sentences containing “{lemma}” will be shown first.", { lemma })}
        className="bottom-28"
        variant="success"
      />
      <LemmaActivityToast
        open={showCopyConfirmation}
        icon={<Check className="h-4 w-4 text-accent" />}
        title={t("Copied “{lemma}” to clipboard.", { lemma })}
      />
    </div>
  );
}
