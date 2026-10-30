import EmojiPicker, { EmojiStyle, Theme } from "emoji-picker-react";
import type { Annotation } from "../pageTypes";
import { createAnnotation, updateAnnotation } from "../../api";
import { useTheme } from "../useTheme";

export default function EmojiPickerPopover({
  x,
  y,
  pageId,
  selection,
  annotation,
  setAnnotations,
  onUpdated,
  close,
}: {
  x: number;
  y: number;

  pageId?: string;

  selection?: {
    start: number;
    end: number;
  };

  annotation?: Pick<Annotation, "id" | "content">;

  setAnnotations?: React.Dispatch<React.SetStateAction<Annotation[]>>;
  onUpdated?: (annotation: { id: string; content: string }) => void;

  close: () => void;
}) {
  const { isDark } = useTheme();
  const PICKER_WIDTH = 320;
  const PICKER_HEIGHT = 420;
  const mobile = window.matchMedia("(pointer: coarse)").matches || window.innerWidth < 768;

  const left = mobile
    ? Math.max(12, (window.innerWidth - 300) / 2)
    : Math.min(Math.max(12, x), window.innerWidth - PICKER_WIDTH - 12);

  const top = mobile
    ? Math.max(12, (window.innerHeight - 400) / 2)
    : Math.min(Math.max(12, y), window.innerHeight - PICKER_HEIGHT - 12);

  async function createEmoji(emoji: string) {
    if (!selection || !pageId) return;

    const created = await createAnnotation({
      page_id: pageId,
      type: "emoji",
      content: emoji,
      start_index: selection.start,
      end_index: selection.end,
    });

    setAnnotations?.((prev) => [...prev, created]);
  }

  async function updateEmoji(emoji: string) {
    if (!annotation?.id) return;
    const prevEmoji = annotation.content;

    setAnnotations?.((prev) => prev.map((a) =>
      a.id === annotation.id ? { ...a, content: emoji } : a
    ));

    try {
      await updateAnnotation(annotation.id, emoji);
      onUpdated?.({ id: annotation.id, content: emoji });
    } catch {
      setAnnotations?.((prev) => prev.map((a) =>
        a.id === annotation.id ? { ...a, content: prevEmoji } : a
      ));
    }
  }

  return (
    <div
      className="fixed z-999 shadow-lg rounded-lg overflow-hidden"
      style={{ left, top }}
    >
      <EmojiPicker
        emojiStyle={EmojiStyle.NATIVE}
        theme={
          isDark
            ? Theme.DARK
            : Theme.LIGHT
        }
        searchDisabled
        skinTonesDisabled
        previewConfig={{ showPreview: false }}
        lazyLoadEmojis
        width={300}
        height={400}
        reactionsDefaultOpen={false}
        onEmojiClick={(e) => {
          const action = annotation
            ? updateEmoji(e.emoji)
            : createEmoji(e.emoji);
          void action.catch(() => null).finally(close);
        }}
      />
    </div>
  );
}
