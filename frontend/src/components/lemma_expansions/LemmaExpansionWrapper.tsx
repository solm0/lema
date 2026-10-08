import { useEffect, useRef, useState } from "react";
import LemmaExpansion from "./LemmaExpansion";
import type { D3Node } from "./Breadcrumb";
import type { LemmaData } from "../pageTypes";
import { lemmaLookupOne } from "../../api";
import { CircleAlert } from "lucide-react";
import { useI18n } from "../../i18n";
import { hasLemmaPackInstalled } from "../util/LanguageSelect";
import LanguagePackRequiredModal from "../util/LanguagePackRequiredModal";

export default function LemmaExpansionWrapper({
  activeNode,
  lemmaDatas,
  activeKey,
  addLemmaData,
  onLemmaFetchStart,
  onLemmaFetchSuccess,
  onLemmaFetchError,
  onSelect,
  onToggleInterest,
  language,
  lemmaInfo,
  interestKeys,
  isKnown,
  onMarkKnown,
}: {
  activeNode: D3Node | null;
  lemmaDatas: LemmaData[] ;
  activeKey: string | null;
  addLemmaData: (layout: LemmaData, autoActivate?: boolean) => void;
  onLemmaFetchStart?: (lemmaKey: string) => void;
  onLemmaFetchSuccess?: (lemmaKey: string) => void;
  onLemmaFetchError?: (lemmaKey: string) => void;
  onSelect: (tokenKey: string) => void;
  onToggleInterest: (key: string, next:boolean) => Promise<void>;
  language: string;
  lemmaInfo?: Record<string, LemmaData>;
  interestKeys?: Set<string>;
  isKnown: boolean;
  onMarkKnown: () => Promise<void>;
}) {
  const { t } = useI18n();
  const inflightRef = useRef(new Set<string>());
  const statusRef = useRef(new Map<string, "loading" | "success" | "error">());
  const [missingPackLang, setMissingPackLang] = useState<string | null>(null);

  useEffect(() => {
    const lemmaKey = activeNode?.data.lemma;
    const [lemma, pos] = lemmaKey?.split('_') ?? [];

    if (!lemmaKey || !pos ) return;

    if (lemmaDatas.find(l => l.key === lemmaKey)) return;
    if (inflightRef.current.has(lemmaKey)) return;

    inflightRef.current.add(lemmaKey);
    statusRef.current.set(lemmaKey, "loading");
    onLemmaFetchStart?.(lemmaKey);

    (async () => {
      try {
        const data = await lemmaLookupOne({ lemma, pos }, language);

        if (data.found === false) {
          const hasPack = await hasLemmaPackInstalled(language);

          if (!hasPack) {
            statusRef.current.set(lemmaKey, "error");
            onLemmaFetchError?.(lemmaKey);
            setMissingPackLang(language);
            return;
          }
        }

        statusRef.current.set(lemmaKey, "success");
        addLemmaData(data);
        onLemmaFetchSuccess?.(lemmaKey);
      } catch {
        const hasPack = await hasLemmaPackInstalled(language);

        statusRef.current.set(lemmaKey, "error");
        onLemmaFetchError?.(lemmaKey);

        if (!hasPack) {
          setMissingPackLang(language);
        }
      } finally {
        inflightRef.current.delete(lemmaKey);
      }

    })();
  }, [activeNode, lemmaDatas, addLemmaData, onLemmaFetchStart, onLemmaFetchSuccess, onLemmaFetchError, language]);

  const lemmaData = lemmaDatas.find(l => l.key === activeKey)
  const status = activeKey ? statusRef.current.get(activeKey) : undefined;

  if (status === "loading" && !lemmaData) {
    return null;
  }
  if (status === "error" || lemmaData?.found === false) {
    return (
      <>
        <LanguagePackRequiredModal
          language={missingPackLang ?? ""}
          open={missingPackLang !== null}
          onClose={() => setMissingPackLang(null)}
        />
        <div className="w-full h-full flex flex-col items-center justify-center gap-2">
          <CircleAlert size={20} />
          {t("We couldn't find this word.")}
        </div>
      </>
    );
  }
  if (lemmaData) {
    return (
      <LemmaExpansion
        data={lemmaData}
        onSelect={onSelect}
        onToggleInterest={onToggleInterest}
        language={language}
        lemmaInfo={lemmaInfo}
        interestKeys={interestKeys}
        isKnown={isKnown}
        onMarkKnown={onMarkKnown}
      />
    );
  }
  return (
    <LanguagePackRequiredModal
      language={missingPackLang ?? ""}
      open={missingPackLang !== null}
      onClose={() => setMissingPackLang(null)}
    />
  );
}
