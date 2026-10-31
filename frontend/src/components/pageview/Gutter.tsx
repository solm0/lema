import { useEffect, useRef, type RefObject } from "react";
import type { Annotation, EmojiAnnotation } from "../pageTypes";
import { getTokenRect } from "../pageUtils";
import { Link, MessageSquareMore } from "lucide-react";

export function Gutter({
  annotations,
  containerRef,
  setHoverRange,
  annotationId,
  setEmojiPicker,
  onOpenAnnotation,
  onRequestEmojiDelete,
}: {
  annotations?: Annotation[];
  containerRef: RefObject<HTMLDivElement | null>;
  setHoverRange: (r: { start: number; end: number } | null) => void;
  annotationId?: string;
  setEmojiPicker?: React.Dispatch<React.SetStateAction<{
    x: number;
    y: number;
    selection?: { start: number; end: number };
    annotation?: EmojiAnnotation;
  } | null>>;
  onOpenAnnotation?: (annotation: Annotation, rect: DOMRect) => void;
  onRequestEmojiDelete?: (annotation: Annotation) => void;
}) {
  const longPressTimerRef = useRef<number | null>(null);
  const suppressClickRef = useRef(false);
  const groups: { top: number; left: number; items: Annotation[] }[] = [];
  const container = containerRef.current;

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as HTMLElement;

      if (target.closest("[data-gutter-annotation]")) {
        return;
      }

      setHoverRange(null);

      if (!target.closest(".EmojiPickerReact")) {
        setEmojiPicker?.(null);
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
    };

  }, [setEmojiPicker, setHoverRange]);

  if (!container) return;
  const containerRect = container.getBoundingClientRect();

  annotations?.forEach((annotation) => {
    const rect = getTokenRect(container, annotation.start_index);
    if (!rect) return;

    const top = rect.top - containerRect.top - 20;
    const left = rect.left - containerRect.left;

    let found = false;

    for (const group of groups) {
      if (Math.abs(group.top - top) < rect.height * 0.6) {
        group.items.push(annotation);
        found = true;
        break;
      }
    }

    if (!found) {
      groups.push({ top, left, items: [annotation] });
    }
  });

  return (
    <div className="pointer-events-none absolute inset-0 z-20">
      {groups.map((group, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            top: group.top,
            left: group.left,
          }}
          className="flex gap-0.5"
        >
          {group.items.map((annotation, j) => {
            const disableEmojiEdit = false;

            return (
              <div
                key={j}
                data-gutter-annotation="true"
                data-annotation-id={annotation.id}
                className={`
                  pointer-events-auto h-6 w-6 rounded transition-[opacity,background-color] flex items-center justify-center
                  ${disableEmojiEdit ? "pointer-events-none cursor-default opacity-50" : "cursor-pointer"}
                  ${annotationId === annotation.id ? 'bg-neutral-100' : 'bg-transparent'}
                  ${annotation.type === "emoji" ? "text-neutral-700" : "text-accent opacity-80 hover:opacity-100"}
                  ${!disableEmojiEdit && 'hover:bg-neutral-100'}
                `}
              onPointerEnter={() =>
                setHoverRange({
                  start: annotation.start_index,
                  end: annotation.end_index,
                })
              }
              onContextMenu={(event) => {
                if (annotation.type !== "emoji") return;
                event.preventDefault();
                onRequestEmojiDelete?.(annotation);
              }}
              onPointerDown={(event) => {
                setHoverRange({
                  start: annotation.start_index,
                  end: annotation.end_index,
                });

                if (annotation.type === "emoji" && event.pointerType === "touch") {
                  suppressClickRef.current = false;
                  longPressTimerRef.current = window.setTimeout(() => {
                    suppressClickRef.current = true;
                    onRequestEmojiDelete?.(annotation);
                  }, 600);
                }
              }}
              onPointerUp={() => {
                if (longPressTimerRef.current !== null) {
                  window.clearTimeout(longPressTimerRef.current);
                  longPressTimerRef.current = null;
                }
              }}
              onPointerLeave={(event) => {
                if (event.pointerType !== "touch") {
                  setHoverRange(null);
                }
              }}
              onPointerCancel={() => {
                if (longPressTimerRef.current !== null) {
                  window.clearTimeout(longPressTimerRef.current);
                  longPressTimerRef.current = null;
                }
                setHoverRange(null);
              }}
              onClick={(e) => {
                if (annotation.type === "emoji") {
                  if (suppressClickRef.current) {
                    suppressClickRef.current = false;
                    return;
                  }
                  const rect = e.currentTarget.getBoundingClientRect();
                  setEmojiPicker?.({
                    x: rect.left,
                    y: rect.bottom + 8,
                    annotation,
                  });
                  return;
                }

                onOpenAnnotation?.(annotation, e.currentTarget.getBoundingClientRect());
              }}
            >
              {annotation.type === "emoji" ? (
                <span className={`leading-none text-xl`}>
                  {annotation.content}
                </span>
              ) : annotation.type === "link" ? (
                <Link size={14} className={`${annotationId === annotation.id && 'text-neutral-700'}`} />
              ) : (
                <MessageSquareMore size={14} className={`${annotationId === annotation.id && 'text-neutral-700'}`} />
              )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
