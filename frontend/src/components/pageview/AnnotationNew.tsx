import { useEffect, useState } from "react";
import type { SidePanelState } from "./PageView"
import type { Annotation } from "../pageTypes";
import { createAnnotation as createAnnotationRequest } from "../../api";
import TextButton from "../util/Button";
import { useI18n } from "../../i18n";

export function isValidUrl(str: string) {
  try {
    const url = new URL(str);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export default function AnnotationNew({
  panel, setAnnotations, setPanelData
}:{
  panel: SidePanelState;
  setAnnotations: React.Dispatch<React.SetStateAction<Annotation[]>>;
  setPanelData: (p: SidePanelState | null) => void;
}) {
  const { t } = useI18n();
  const [inputValue, setInputValue] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [canSave, setCanSave] = useState(false);
  const annotationPanel =
    panel?.type === "annotation:new" ? panel : null;

  useEffect(() => {
    if (!annotationPanel) return;
    setInputValue(annotationPanel.data.content);
    setCanSave(annotationPanel.data.content.trim().length > 0);
  }, [annotationPanel]);

  useEffect(() => {
    setCanSave(inputValue.trim().length > 0);
  }, [inputValue]);

  if (!annotationPanel) return null;

  const annotationData = annotationPanel.data;

  async function handleCreateAnnotation() {
    const nextValue = inputValue;

    // link validation
    if (annotationData.type === "link") {
      if (!isValidUrl(nextValue)) {
        setMsg(t("Invalid URL"));
        return;
      }
    }

    // content 바꿔치기
    const payload = {
      ...annotationData,
      content: nextValue,
    }

    const newAnnotation = await createAnnotationRequest(payload);

    setAnnotations?.((prev) => [...prev, newAnnotation]);
    setPanelData({ type: "annotation:view", data: newAnnotation });
    setInputValue("");
  }

  return (
    <div className="w-full h-full pt-2 px-3 pb-16">
      {annotationData.type === "memo"
        ? (
          <textarea
            value={inputValue}
            onChange={(event) => setInputValue(event.target.value)}
            className="w-full h-full resize-none bg-transparent leading-7 pb-8 text-base text-inherit caret-black focus:outline-none placeholder-neutral-400 overflow-y-auto"
            spellCheck={false}
            placeholder={t("Add your thoughts...")}
            autoFocus
          />
        ) : (
          <div className="flex flex-col gap-1">
            <input
              value={inputValue}
              onChange={(event) => setInputValue(event.target.value)}
              placeholder="https://..."
              className="mt-7 border-2 border-neutral-300 rounded-md w-full px-3 py-2 focus:outline-none opacity-50 focus:opacity-100"
            />
            {msg && <p className="text-xs text-red-400 font-medium pb-2">{msg}</p>}
          </div>
        )
      }
      <div className="absolute bottom-2 left-0 px-2 w-full flex flex-col">
        <TextButton
          text={annotationData.type === "memo" ? t("Create new memo") : t("Create new link")}
          onClick={handleCreateAnnotation}
          disabled={!canSave}
          fit black
        />
      </div>
    </div>
  )
}
