import { useEffect, useState } from "react";
import type { SidePanelState } from "./PageView";
import type { Annotation } from "../pageTypes";
import { deleteAnnotation, updateAnnotation } from "../../api";
import { isValidUrl } from "./AnnotationNew";
import { ResponsiveModal } from "../util/ResponsiveModal";
import { Pencil, Trash2 } from "lucide-react";
import TextButton, { IconButton } from "../util/Button";
import { useI18n } from "../../i18n";

export default function AnnotationView({
  panel,
  setPanel,
  setAnnotations,
}: {
  panel: SidePanelState;
  setPanel: React.Dispatch<React.SetStateAction<SidePanelState | null>>
  setAnnotations: React.Dispatch<React.SetStateAction<Annotation[]>>;
}) {
  const { t } = useI18n();
  const annotationPanel =
    panel?.type === "annotation:view" ? panel : null;

  if (!annotationPanel || !annotationPanel.data.id) return;
  const canMutate = true;

  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(annotationPanel.data.content);

  const [loading, setLoading] = useState<"edit" | "delete" | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [openModal, setOpenModal] = useState(false);
  const [canSave, setCanSave] = useState(annotationPanel.data.content.trim().length > 0);


  // panel 바뀌면 상태 리셋
  useEffect(() => {
    if (!annotationPanel) return;

    setEditing(false);
    setValue(annotationPanel.data.content);
    setCanSave(annotationPanel.data.content.trim().length > 0);
  }, [annotationPanel]);

  useEffect(() => {
    setCanSave(value.trim().length > 0);
  }, [value]);

  const id = annotationPanel.data.id;

  const handleDelete = async () => {
    setLoading("delete");
    setMsg(null);

    try {
      await deleteAnnotation(id);
      setAnnotations(prev => prev.filter(a => a.id !== id));
      setOpenModal(false);
      setPanel(null);
    } catch {
      setMsg(t("Delete failed"));
    } finally {
      setLoading(null);
    }
  };

  const handleSave = async () => {
    setLoading("edit");
    setMsg(null);
    const nextValue = value;

    // link validation
    if (annotationPanel.data.type === "link") {
      if (!isValidUrl(nextValue)) {
        setMsg(t("Invalid URL"));
        setLoading(null);
        return;
      }
    }

    try {
      const updated = await updateAnnotation(id, nextValue);
      setValue(updated.content);

      // 1. 리스트 업데이트
      setAnnotations(prev =>
        prev.map(a => (a.id === id ? updated : a))
      );

      // 2. panel도 업데이트 (이게 핵심)
      setPanel(prev => prev?.type === "annotation:view"
        ? { ...prev, data: updated }
        : prev
      );

      setEditing(false);
      setMsg(t("Saved"));
      setTimeout(()=>setMsg(null),3000);
    } catch {
      setMsg(t("Save failed"));
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="w-full h-full pt-2 px-2 flex flex-col gap-2 overflow-hidden">

      {/* buttons */}
      {!editing && canMutate &&
        <div className="w-full h-auto flex items-center justify-between">
          <p className="text-xs text-neutral-400">{t("Created:")} {annotationPanel.data.created_at?.slice(0,10)}</p>
          <div className="flex gap-1">
            <IconButton
              icon={<Pencil size={14} />}
              onClick={() => {
                setEditing(true);
                setValue(annotationPanel.data.content)
              }}
            />
            <IconButton
              icon={<Trash2 className="text-red-600" size={14} />}
              onClick={()=>setOpenModal(true)}
              red
            />
          </div>
        </div>
      }

      {/* content */}
      {!editing
        ? annotationPanel.data.type === 'link'
          ? <a href={annotationPanel.data.content} className="underline underline-offset-3 hover:text-neutral-400 transition-colors" target="_blank">{annotationPanel.data.content}</a>
          : <div className="text-lg w-full h-full overflow-y-scroll no-scrollbar whitespace-pre-wrap leading-8 pb-7">
              <p className="max-w-[25rem] xl:max-w-[33rem]">{annotationPanel.data.content}</p>
            </div>
        : (
            annotationPanel.data.type === "memo" ? (
              <textarea
                key={annotationPanel.data.id}
                value={value}
                onChange={(event) => setValue(event.target.value)}
                className="w-full h-full resize-none bg-transparent leading-7 pb-8 text-base text-inherit caret-black focus:outline-none placeholder-neutral-400 overflow-y-auto"
                spellCheck={false}
                placeholder={t("Add your thoughts...")}
                autoFocus
              />
            ) : (
              <input
                value={value}
                onChange={(e) => setValue(e.target.value)}
                className="border-2 border-neutral-300 rounded px-2 py-1 focus:outline-none"
              />
            )
          )
      }

      <div className="absolute bottom-2 left-0 px-2 w-full flex flex-col gap-2">
        {msg && <p className={`text-sm ${msg !== t("Saved") ? "text-red-600" : ""}`}>{msg}</p>}
        {editing &&
          <div className="self-end flex gap-2 w-full">
            <TextButton
              text={t("Revert changes")}
              onClick={()=>{
                setEditing(false);
                setMsg(null);
              }}
              black fit
            />
            <TextButton
              text={loading === "edit" ? t("Saving...") : t("Save changes")}
              onClick={handleSave}
              disabled={loading === "edit" || !canSave}
              black fit
            />
          </div>
        }
      </div>


     
      

      {/* delete modal */}
      <ResponsiveModal open={openModal && canMutate} onClose={() => setOpenModal(false)}>
        <div className="flex flex-col gap-7">
          <h2 className="pr-6">{t("Delete this annotation?")}</h2>
          <TextButton text={t("Delete")} onClick={handleDelete} fit red/>
        </div>
      </ResponsiveModal>
    </div>
  );
}
