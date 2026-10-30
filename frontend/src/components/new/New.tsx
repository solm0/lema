import { useEffect, useState } from "react";
import PagePreview from "./PagePreview";
import { fetchNotebooks, savePage, type SavePageProgress } from "../../api";
import { useLocation, useNavigate } from "react-router-dom";
import PasteReader from "./PasteReader";
import Button from "../util/Button";
import { ResponsiveModal } from "../util/ResponsiveModal";
import type { TextAnalysisResult } from "../pageTypes";
import { filterTextAnalysisByRanges, type SelectionRange } from "../pageUtils";
import LanguageSelect from "../util/LanguageSelect";
import { useI18n } from "../../i18n";

export type FooterAction = {
  text: string;
  onClick: () => void;
  disabled?: boolean;
};

export default function New() {
  const { t } = useI18n();
  const location = useLocation();
  const initialPasteText = typeof location.state?.pasteText === "string"
    ? location.state.pasteText
    : "";
  const initialLanguage = typeof location.state?.language === "string"
    ? location.state.language
    : null;
  const autoAnalyzeInitialText = location.state?.autoAnalyze === true;
  const [result, setResult] = useState<TextAnalysisResult | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [footerAction, setFooterAction] = useState<FooterAction | null>(null);
  const [selectedRanges, setSelectedRanges] = useState<SelectionRange[]>([]);

  const [openModal, setOpenModal] = useState(false);
  const [saveProgress, setSaveProgress] = useState<SavePageProgress | null>(null);
  const [pageName, setPageName] = useState("");
  const [notebooks, setNotebooks] = useState<any[]>([]);
  const [anyLangInstalled, setAnyLangInstalled] = useState(false);

  const [language, setLanguage] = useState<{
    lang: string;
  } | null>(initialLanguage ? { lang: initialLanguage } : null);

  // /notebook에서 생성한 page일 경우
  const initialNotebookId = location.state?.notebookId ?? null;
  const [selectedNotebook, setSelectedNotebook] = useState<string | null>(initialNotebookId);

  const navigate = useNavigate();

  const hasTokens = result?.blocks?.every(b => b.tokens);
  const isPreviewStep = !!result;

  const showInput = !isPreviewStep;
  const showPreview = isPreviewStep;

  const isReady =
    isPreviewStep &&
    hasTokens &&
    !analyzing;

  const handleNext = () => {
    if (!isReady) return;
    setOpenModal(true);
  };

  useEffect(() => {
    if (!openModal) return;

    fetchNotebooks()
      .then(setNotebooks)
      .catch(() => setNotebooks([]));
  }, [openModal]);

  const handleSave = async () => {
    if (!result || saveProgress) return;

    const resultToSave =
      selectedRanges.length > 0
        ? filterTextAnalysisByRanges(result, selectedRanges)
        : result;

    try {
      if (!language) return;
      
      const pageId = await savePage(
        resultToSave,
        pageName,
        selectedNotebook,
        language.lang,
        {
          source: "user",
          metadata: [],
          onProgress: setSaveProgress,
        },
      );
      navigate(`/page/${pageId}`);
    } catch (e) {
      if (e instanceof Error && e.message === "unauthorized") {
        navigate("/login");
      }
    } finally {
      setSaveProgress(null);
    }
  };

  const statusText = analyzing
    ? t("Analyzing selected text...")
    : null;
  const saveButtonText = saveProgress === "saving"
    ? t("Saving...")
    : t("Save");

  const handleReset = () => {
    setResult(null);
    setAnalyzing(false);
    setFooterAction(null);
    setSelectedRanges([]);
  };

  useEffect(() => {
    setSelectedRanges([]);
  }, [result]);

  return (
    <div className="flex flex-col items-start h-full w-full gap-2 pr-4 pb-18 md:pb-4 md:pr-6 pl-3 md:pl-6 bg-neutral-100">

      {/* SECTION 1: HEADER */}
      <div className="flex flex-col gap-2 pt-12 pb-2">
        <h2 className="flex items-baseline gap-4">
          {t("Paste text")}
        </h2>

      </div>

      {/* LANGUAGE SELECT */}
      <LanguageSelect
        language={language?.lang ?? null}
        setLanguage={(l) => setLanguage(l)}
        handleReset={handleReset}
        setAnyLangInstalled={setAnyLangInstalled}
        background
      />

      {/* SECTION 3 + 4 */}
      <div className="flex-1 w-full max-h-180 overflow-hidden flex flex-col md:flex-row gap-2 h-full">

          {/* INPUT */}
          {language && anyLangInstalled ? (
            <div className={`
              w-full flex-1 md:w-1/2 flex flex-col items-end
              ${showPreview ? "hidden md:flex opacity-50 pointer-events-none" : "opacity-100"}
            `}>
              <PasteReader
                key={language.lang}
                language={language.lang}
                initialText={initialPasteText}
                autoAnalyze={autoAnalyzeInitialText}
                setResult={setResult}
                setAnalyzing={setAnalyzing}
                setFooterAction={setFooterAction}
              />
            </div>
          ): (
            <div className="w-full flex-1 md:w-1/2 flex items-center justify-center">{t("Loading...")}</div>
          )}
          
          {/* PREVIEW */}
          <div className={`
            w-full h-full flex-1 md:w-1/2 flex flex-col gap-2 overflow-hidden
            ${showInput && "hidden md:flex"}
          `}>
            {result ? (
              <>
                <p>{t("Select text to keep. Otherwise, all text will be used.")}</p>
                <div className="w-full flex-1 bg-neutral-100 rounded shrink-0 overflow-y-scroll">
                  <PagePreview
                    blocks={result.blocks}
                    selectedRanges={selectedRanges}
                    onSelectedRangesChange={setSelectedRanges}
                  />
                </div>
              </>
            ): (
              <div className="text-neutral-400 w-full h-full flex items-center justify-center p-2">
                {t("Preview will show here")}
              </div>
            )}
        </div>
      </div>

      {/* SECTION 2: NEXT BUTTON */}
      <div className="shrink-0 sticky bottom-0 flex justify-end w-full gap-2">

        {isPreviewStep && (
          <Button
            text={t("Retry")}
            onClick={handleReset}
            fit
            black
          />
        )}

        {statusText ? (
          <Button
            text={statusText}
            onClick={() => {}}
            disabled
            fit
            black
          />
        ) : footerAction && !isPreviewStep ? (
          <Button
            text={footerAction.text}
            onClick={footerAction.onClick}
            disabled={footerAction.disabled || !language}
            fit
            black
          />
        ) : (
          <Button 
            text={t("Next")}
            onClick={handleNext}
            disabled={!isReady || !language}
            fit
            black
          />
        )}
      </div>

      <ResponsiveModal
        open={openModal}
        onClose={() => {
          if (!saveProgress) setOpenModal(false);
        }}
      >
        <div className="flex flex-col gap-7">
          <h2>{t("Save Page")}</h2>

          {/* page name */}
          <input
            placeholder={t("Page name")}
            value={pageName}
            onChange={(e) => setPageName(e.target.value)}
            className="border-2 border-neutral-300 rounded-sm px-3 py-2 focus:outline-none opacity-50 focus:opacity-100"
          />

          {/* notebook select */}
          <div className="flex flex-col w-full gap-1">
            <p className="text-xs text-neutral-400">{t("Notebook")}</p>
            <select
              value={selectedNotebook ?? ""}
              onChange={(e) =>
                setSelectedNotebook(
                  e.target.value || null
                )
              }
              className="border-2 border-neutral-300 rounded-sm px-3 py-2 focus:outline-none opacity-50 focus:opacity-100"
            >
              <option value="">{t("root")}</option>
              {notebooks.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name}
                </option>
              ))}
            </select>
          </div>

          {/* save */}
          <Button
            text={saveButtonText}
            onClick={handleSave}
            disabled={Boolean(saveProgress)}
            black
            fit
          />
        </div>
      </ResponsiveModal>
    </div>
  );
}
