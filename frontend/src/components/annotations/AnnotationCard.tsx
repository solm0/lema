import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Ellipsis, Pencil, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";

import { deleteAnnotation, updateAnnotation } from "../../api";
import { useI18n } from "../../i18n";
import type { TimelineItem } from "../../types";
import AnnotationInput from "../pageview/AnnotationInput";
import { isValidUrl } from "../pageview/AnnotationNew";
import TextButton, { IconButtonEvent } from "../util/Button";
import { MiniPopup } from "../util/MiniPopup";
import { ResponsiveModal } from "../util/ResponsiveModal";
import { formatRelative } from "../util/time";
import EmojiPickerPopover from "../pageview/EmojiPickerPopover";

export default function AnnotationCard({ item, onUpdate, onDelete, readonlySnapshotActions = false }: {
  item: TimelineItem;
  onUpdate?: (item: TimelineItem) => void;
  onDelete?: (id: string) => void;
  readonlySnapshotActions?: boolean;
}) {
  const { locale, t } = useI18n();
  const [value, setValue] = useState(item.content);
  const [editing, setEditing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emojiPicker, setEmojiPicker] = useState<{ x: number; y: number } | null>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const savingRef = useRef(false);

  const openEmojiPicker = (event: React.MouseEvent<HTMLElement>) => {
    if (readonlySnapshotActions) return;
    const rect = event.currentTarget.getBoundingClientRect();
    setMenuOpen(false);
    setEmojiPicker({ x: rect.right + 8, y: rect.top });
  };

  const save = async () => {
    if (savingRef.current) return;
    const nextValue = value.trim();
    if (!nextValue || !item.type || item.type === "emoji") return;
    if (item.type === "link" && !isValidUrl(nextValue)) {
      setError(t("Invalid URL"));
      return;
    }
    if (nextValue === item.content) {
      setValue(nextValue);
      setEditing(false);
      setError(null);
      return;
    }
    savingRef.current = true;
    setSaving(true);
    try {
      const updated = await updateAnnotation(item.id, nextValue);
      setValue(updated.content);
      onUpdate?.({ ...item, ...updated });
      setEditing(false);
      setError(null);
    } catch {
      setError(t("Save failed"));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  useEffect(() => {
    if (!editing) return;

    const saveWhenClickingOutside = (event: PointerEvent) => {
      if (editorRef.current?.contains(event.target as Node)) return;
      void save();
    };

    document.addEventListener("pointerdown", saveWhenClickingOutside, true);
    return () => document.removeEventListener("pointerdown", saveWhenClickingOutside, true);
  }, [editing, item.content, item.type, value]);

  const remove = async () => {
    await deleteAnnotation(item.id);
    onDelete?.(item.id);
    setDeleteOpen(false);
  };

  return (
    <article className="group relative h-auto w-full flex flex-col gap-4 md:w-96 rounded-xl bg-neutral-200 p-4 text-xl font-body">
        <time className="text-xs text-neutral-400">{formatRelative(item.created_at, locale)}</time>
        <div className="flex min-h-10 flex-col gap-4 font-semibold">
          {editing && item.type && item.type !== "emoji" ? (
            <div ref={editorRef}>
              <AnnotationInput
                type={item.type}
                value={value}
                onChange={(next) => { setValue(next); setError(null); }}
                onSubmit={() => void save()}
                disabled={saving || !value.trim()}
                error={error}
              />
            </div>
          ) : item.type === "link" ? (
            <a href={value} target="_blank" rel="noreferrer" className="truncate underline underline-offset-3 hover:text-neutral-400">{value}</a>
          ) : item.type === "emoji" ? (
            <button type="button" onClick={openEmojiPicker} className="w-fit text-left text-5xl leading-none">
              {value}
            </button>
          ) : (
            <p className="whitespace-pre-wrap">{value}</p>
          )}
        </div>

        {!readonlySnapshotActions && !editing ? (
          <div className={`absolute right-2 top-2 transition-opacity ${menuOpen ? "opacity-100" : "opacity-100 md:opacity-0 md:group-hover:opacity-100"}`}>
            <IconButtonEvent
              icon={<Ellipsis />}
              onClick={(event) => {
                event.stopPropagation();
                setMenuOpen((open) => !open);
              }}
              title={t("more")}
            />
            <MiniPopup open={menuOpen} onClose={() => setMenuOpen(false)}>
              <div className="flex flex-col">
                {item.type !== "emoji" ? (
                  <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-neutral-700 transition-colors hover:bg-neutral-100" onClick={() => { setEditing(true); setMenuOpen(false); }}>
                    <Pencil size={13} />
                    <span>{t("Edit")}</span>
                  </button>
                ) : null}
                <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-red-600 transition-colors hover:bg-red-200/30" onClick={() => { setDeleteOpen(true); setMenuOpen(false); }}>
                  <Trash2 size={13} />
                  <span>{t("Delete")}</span>
                </button>
              </div>
            </MiniPopup>
          </div>
        ) : null}

      <Link to={`/page/${item.page_id}`} state={{ annotationId: item.id }} className="flex min-w-0 items-start group gap-2 text-sm transition-colors rounded-b-lg mt-2">
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium text-neutral-500">{item.page_name}</span>
          <span className="block truncate mt-1 text-neutral-400">{item.source}</span>
        </span>
        <ArrowUpRight size={14} className="mt-0.5 shrink-0 text-neutral-400 group-hover:text-neutral-700" />
      </Link>

      <ResponsiveModal open={deleteOpen} onClose={() => setDeleteOpen(false)}>
        <div className="flex flex-col gap-7 md:pb-3">
          <h2>{t("Delete this annotation?")}</h2>
          <TextButton text={t("Delete")} onClick={() => void remove()} fit red />
        </div>
      </ResponsiveModal>

      {emojiPicker && (
        <EmojiPickerPopover
          x={emojiPicker.x}
          y={emojiPicker.y}
          annotation={{ id: item.id, content: value }}
          onUpdated={(updated) => {
            setValue(updated.content);
            onUpdate?.({ ...item, content: updated.content });
          }}
          close={() => setEmojiPicker(null)}
        />
      )}
    </article>
  );
}
