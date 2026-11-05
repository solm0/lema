import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Ellipsis, Pencil, Trash2 } from "lucide-react";

import { createAnnotation, deleteAnnotation, updateAnnotation } from "../../api";
import { useI18n } from "../../i18n";
import type { Annotation } from "../pageTypes";
import TextButton, { IconButtonEvent } from "../util/Button";
import { MiniPopup } from "../util/MiniPopup";
import { ResponsiveModal } from "../util/ResponsiveModal";
import AnnotationInput from "./AnnotationInput";
import { isValidUrl } from "./AnnotationNew";

export type AnnotationAnchor = {
  kind: "selection" | "gutter";
  x: number;
  y: number;
  right?: number;
  bottom?: number;
};

function isMobileLike() {
  return window.matchMedia("(pointer: coarse)").matches || window.innerWidth < 768;
}

export default function AnnotationOverlay({
  annotation,
  mode,
  anchor,
  onClose,
  onCreated,
  onUpdated,
  onDeleted,
}: {
  annotation: Annotation;
  mode: "new" | "view";
  anchor: AnnotationAnchor | null;
  onClose: () => void;
  onCreated: (annotation: Annotation) => void;
  onUpdated: (annotation: Annotation) => void;
  onDeleted: (id: string) => void;
}) {
  const { t } = useI18n();
  const rootRef = useRef<HTMLDivElement>(null);
  const [mobile, setMobile] = useState(isMobileLike);
  const [currentMode, setCurrentMode] = useState(mode);
  const [editing, setEditing] = useState(mode === "new");
  const [value, setValue] = useState(annotation.content);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  useEffect(() => {
    const check = () => setMobile(isMobileLike());
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  useEffect(() => {
    if (mobile) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (deleteOpen || rootRef.current?.contains(event.target as Node)) return;
      onClose();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [deleteOpen, mobile, onClose]);

  const save = async () => {
    const nextValue = value.trim();
    if (!nextValue || annotation.type === "emoji") return;
    if (annotation.type === "link" && !isValidUrl(nextValue)) {
      setError(t("Invalid URL"));
      return;
    }

    setSaving(true);
    setError(null);
    try {
      if (currentMode === "new") {
        const created = await createAnnotation({ ...annotation, content: nextValue });
        onCreated(created);
        setCurrentMode("view");
        setEditing(false);
        setValue(created.content);
      } else if (annotation.id) {
        const updated = await updateAnnotation(annotation.id, nextValue);
        onUpdated(updated);
        setEditing(false);
        setValue(updated.content);
      }
    } catch {
      setError(t(currentMode === "new" ? "Save failed" : "Save failed"));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!annotation.id) return;
    await deleteAnnotation(annotation.id);
    onDeleted(annotation.id);
    setDeleteOpen(false);
    onClose();
  };

  const width = currentMode === "new" || editing ? 320 : 288;
  const estimatedHeight = currentMode === "new" || editing ? 320 : 220;
  const desktopStyle = anchor
    ? anchor.kind === "gutter"
      ? {
          left: Math.max(12, anchor.x - width - 12),
          top: Math.max(12, Math.min(anchor.y, window.innerHeight - estimatedHeight - 12)),
          width,
        }
      : {
          left: Math.min(Math.max(12, anchor.x), window.innerWidth - width - 12),
          top: Math.max(12, Math.min(anchor.y, window.innerHeight - estimatedHeight - 12)),
          width,
        }
    : { left: `calc(50% - ${width / 2}px)`, top: 60, width };

  const body = (
    <div
      ref={rootRef}
      className={
        mobile
          ? "fixed inset-0 z-70 flex items-end"
          : "group fixed z-70 h-auto rounded-xl border border-neutral-200/60 bg-neutral-50 shadow-xl px-3 py-2"
      }
      style={mobile ? undefined : desktopStyle}
    >
      {mobile ? <button type="button" aria-label={t("Close")} className="absolute inset-0 bg-neutral-700/40" onClick={onClose} /> : null}
      <div className={mobile ? "relative z-10 h-auto min-h-30 max-h-[calc(100vh-5rem)] w-full overflow-y-auto rounded-t-2xl bg-neutral-50 p-5 pb-7 shadow-xl" : "w-full"}>
        {editing && annotation.type !== "emoji" ? (
          <AnnotationInput
            type={annotation.type}
            value={value}
            onChange={(next) => {
              setValue(next);
              setError(null);
            }}
            onSubmit={() => void save()}
            disabled={saving || !value.trim()}
            error={error}
          />
        ) : (
          <div className="relative pr-7 text-sm leading-6">
            {annotation.type === "link" ? (
              <a href={value} target="_blank" rel="noreferrer" className="block truncate underline underline-offset-3 hover:text-neutral-400">
                {value}
              </a>
            ) : (
              <p className="whitespace-pre-wrap break-words">{value}</p>
            )}

            {currentMode === "view" ? (
              <div className={`absolute -right-1 -top-1 transition-opacity ${mobile || menuOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
                <IconButtonEvent
                  icon={<Ellipsis />}
                  onClick={(event) => {
                    event.stopPropagation();
                    setMenuOpen((open) => !open);
                  }}
                  title={t("more")}
                />
                <MiniPopup open={menuOpen} onClose={() => setMenuOpen(false)}>
                  <div className="flex flex-col py-1">
                    {annotation.type !== "emoji" ? (
                      <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-neutral-700 transition-colors hover:bg-neutral-100" onClick={() => { setEditing(true); setMenuOpen(false); }}>
                        <Pencil size={13} />
                        <span>{t("Edit")}</span>
                      </button>
                    ) : null}
                    <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-red-600 transition-colors hover:bg-red-50" onClick={() => { setDeleteOpen(true); setMenuOpen(false); }}>
                      <Trash2 size={13} />
                      <span>{t("Delete")}</span>
                    </button>
                  </div>
                </MiniPopup>
              </div>
            ) : null}
          </div>
        )}
      </div>

      <ResponsiveModal open={deleteOpen} onClose={() => setDeleteOpen(false)}>
        <div className="flex flex-col gap-7 md:pb-3">
          <h2>{t("Delete this annotation?")}</h2>
          <TextButton text={t("Delete")} onClick={() => void remove()} fit red />
        </div>
      </ResponsiveModal>
    </div>
  );

  return createPortal(body, document.body);
}
