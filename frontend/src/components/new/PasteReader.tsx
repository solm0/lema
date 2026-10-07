import { useCallback, useEffect, useRef, useState } from "react";
import type { FooterAction } from "./New";
import type { TextAnalysisResult } from "../pageTypes";
import { analyzeBlocks } from "../../api";
import { useI18n } from "../../i18n";
import { useNavigate } from "react-router-dom";

export default function PasteReader({
  language,
  setAnalyzing,
  setResult,
  setFooterAction,
  initialText = "",
  autoAnalyze = false,
}: {
  language: string
  setResult: (r: TextAnalysisResult | null) => void;
  setAnalyzing: (a: boolean) => void;
  setFooterAction: (action: FooterAction | null) => void;
  initialText?: string;
  autoAnalyze?: boolean;
}) {
  const [pasteText, setPasteText] = useState(initialText);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const autoAnalyzeStartedRef = useRef(false);
  const { t } = useI18n();
  const navigate = useNavigate();

  function textToBlocks(text: string) {
    return text.split("\n").map(line => ({
      text: line,
    }));
  }

  const handlePasteAnalyze = useCallback(async () => {
    setAnalyzing(true);
    setAnalysisError(null);

    try {
      const blocks = textToBlocks(pasteText);
      const data = await analyzeBlocks(blocks, language);

      setResult({
        text: pasteText,
        blocks: data.blocks
      });
    } catch (error) {
      if (error instanceof Error && error.message === "unauthorized") {
        navigate("/login");
        return;
      }

      const message = error instanceof Error && (
        error.message === "analysis_busy" || error.message === "analysis_queue_full"
      )
        ? t("The analysis server is busy. Try again shortly.")
        : error instanceof Error && error.message === "analysis_rate_limited"
          ? t("Too many analysis requests. Try again later.")
          : t("Analysis failed. Try again.");
      setAnalysisError(message);
    } finally {
      setAnalyzing(false);
    }
  }, [language, navigate, pasteText, setAnalyzing, setResult, t]);

  useEffect(() => {
    setFooterAction({
      text: t("Done"),
      onClick: handlePasteAnalyze,
      disabled: !pasteText.trim(),
    });

    return () => setFooterAction(null);
  }, [handlePasteAnalyze, pasteText, setFooterAction, t]);

  useEffect(() => {
    if (!autoAnalyze || autoAnalyzeStartedRef.current || !pasteText.trim()) return;

    autoAnalyzeStartedRef.current = true;
    void handlePasteAnalyze();
  }, [autoAnalyze, handlePasteAnalyze, pasteText]);


  return (
    <div className="flex h-full w-full flex-col gap-2">
      <textarea
        value={pasteText}
        onChange={(e) => setPasteText(e.target.value)}
        className="w-full h-full resize-none rounded-sm focus:outline-none bg-neutral-50/80 p-2"
        placeholder={t("Paste text here\n\nTip !!!\n\nAccuracy improves when punctuation and line breaks are used properly in sentences.")}
        spellCheck={false}
      />
      {analysisError ? (
        <p className="shrink-0 text-sm text-red-600">{analysisError}</p>
      ) : null}
    </div>
  );
}
