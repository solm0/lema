import { useLayoutEffect, useRef } from "react";
import { ArrowUp, Check } from "lucide-react";

import { useI18n } from "../../i18n";
import type { AnnotationType } from "../pageTypes";

export default function AnnotationInput({
  type,
  value,
  onChange,
  onSubmit,
  disabled = false,
  error,
}: {
  type: Exclude<AnnotationType, "emoji">;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  error?: string | null;
}) {
  const { t } = useI18n();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.style.height = "0px";
    const lineHeight = Number.parseFloat(window.getComputedStyle(textarea).lineHeight) || 24;
    const maxHeight = lineHeight * 10;
    textarea.style.height = `${Math.min(Math.max(textarea.scrollHeight, lineHeight), maxHeight)}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [value]);

  const submitOnEnter = (event: React.KeyboardEvent) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (!disabled) onSubmit();
  };

  return (
    <div className="flex w-full flex-col">
      <div className="flex w-full items-end gap-2 rounded-xl bg-transparent">
        {type === "memo" ? (
          <textarea
            ref={textareaRef}
            rows={1}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={submitOnEnter}
            placeholder={t("Add your thoughts...")}
            className="min-h-[1lh] max-h-[10lh]  leading-6 min-w-0 flex-1 resize-none bg-transparent outline-none placeholder:text-neutral-400"
            spellCheck={false}
            autoFocus
          />
        ) : (
          <input
            value={value}
            maxLength={2048}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={submitOnEnter}
            placeholder="https://..."
            className="h-6 min-w-0 flex-1 mb-1 leading-6 truncate bg-transparent text-sm outline-none placeholder:text-neutral-400"
            autoFocus
          />
        )}

        <button
          type="button"
          onClick={onSubmit}
          disabled={disabled}
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors ${
            disabled
              ? "cursor-default bg-neutral-200 text-neutral-400"
              : "bg-neutral-900 text-neutral-50 hover:bg-neutral-700"
          }`}
          title={t("Done")}
        >
          {type === "link" ? <Check size={17} /> : <ArrowUp size={17} />}
        </button>
      </div>
      {error ? <p className="pb-1 text-xs text-red-500">{error}</p> : null}
    </div>
  );
}
