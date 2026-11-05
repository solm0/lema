import { useEffect, useLayoutEffect, useRef, useState } from "react";
import PageCore from "../PageCore";
import { getNearestTokenIndex, getTextForRange, getTokenRect } from "../pageUtils";
import { IconButton } from "../util/Button";
import { Link, MessageSquareMore, Smile } from "lucide-react";
import type { Annotation, EmojiAnnotation, LemmaData, TextBlock, UserLemmaExampleCapture } from "../pageTypes";
import { Gutter } from "./Gutter";
import type { SidePanelState } from "./PageView";
import EmojiPickerPopover from "./EmojiPickerPopover";
import { useAutoCenterActiveItem } from "../lyric/useAutoCenterActiveItem";
import { useSettings } from "../useSettings";
import { getLookupKey, getLookupKeyForMorph } from "../tokenLookup";
import type { MorphToken, Token } from "../pageTypes";
import { useI18n } from "../../i18n";
import { deleteAnnotation } from "../../api";
import AnnotationOverlay, { type AnnotationAnchor } from "./AnnotationOverlay";
import { ResponsiveModal } from "../util/ResponsiveModal";
import TextButton from "../util/Button";

const LONG_PRESS_MS = 600;
const DRAG_THRESHOLD = 8;

export default function PageContent({
  blocks,
  lemmaInfo,
  interestKeys,
  onVisibleBlockRangeChange,
  panelData,
  language,
  setPanelData,
  annotations,
  activeLyricBlockIndex = -1,
  syncPlaybackActive = false,
  pageName,
  pageSource,
  pageMetadata,
  onAddMetadata,
  onUpdateMetadata,
  onDeleteMetadata,
  pageId,
  scrollRef,
  setAnnotations,
  horizontalAlign = "center",
  textAlign = "justify",
  contentPaddingClass,
  getTokenClassName,
  allowOverflow = false,
}: {
  blocks: TextBlock[];
  lemmaInfo: Record<string, LemmaData>;
  interestKeys?: Set<string>;
  onVisibleBlockRangeChange?: (range: { start: number; end: number }) => void;
  panelData: SidePanelState;
  language: string;
  setPanelData?: (p: SidePanelState | null) => void;
  annotations?: Annotation[];
  activeLyricBlockIndex?: number;
  syncPlaybackActive?: boolean;
  pageName?: string;
  pageSource?: string;
  pageMetadata?: string[];
  onAddMetadata?: (value: string) => Promise<void>;
  onUpdateMetadata?: (index: number, value: string) => Promise<void>;
  onDeleteMetadata?: (index: number) => Promise<void>;
  pageId?: string;
  scrollRef?: (fn: (startIndex: number) => void) => void;
  setAnnotations: React.Dispatch<React.SetStateAction<Annotation[]>>;
  horizontalAlign?: "left" | "right" | "center";
  textAlign?: "left" | "justify";
  contentPaddingClass?: string;
  getTokenClassName?: (args: { token: Token; key: string | null }) => string | undefined;
  allowOverflow?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const { settings } = useSettings();
  const { t } = useI18n();
  
  const [selection, setSelection] = useState<{
    anchor: number;
    focus: number;
  } | null>(null);

  const hasTimedBlocks = blocks.some((block) => block.timestamp_ms != null);

  useAutoCenterActiveItem({
    containerRef: scrollContainerRef,
    activeIndex: activeLyricBlockIndex,
    enabled: syncPlaybackActive && hasTimedBlocks && activeLyricBlockIndex >= 0,
    getElementForIndex: (index, container) =>
      container.querySelector(`[data-block-index="${index}"]`) as HTMLElement | null,
  });
  const [finalSelection, setFinalSelection] = useState<{
    start: number;
    end: number;
  } | null>(null);
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    viewportX: number;
    viewportY: number;
  } | null>(null);
  
  const [hoverRange, setHoverRange] = useState<{
    start: number;
    end: number;
  } | null>(null);
  const [isSelecting, setIsSelecting] = useState(false);
  
  const pointerDownRef = useRef(false);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const didDragRef = useRef(false);
  const longPressTimerRef = useRef<number | null>(null);
  const blockClickRef = useRef(false); // 드래그 후 클릭 차단용
  
  const [emojiPicker, setEmojiPicker] = useState<{
    x: number;
    y: number;
  
    selection?: {
      start: number;
      end: number;
    };
  
    annotation?: EmojiAnnotation;
  } | null>(null);
  const [annotationAnchor, setAnnotationAnchor] = useState<AnnotationAnchor | null>(null);
  const [gutterAnnotation, setGutterAnnotation] = useState<Annotation | null>(null);
  const [emojiDeleteTarget, setEmojiDeleteTarget] = useState<Annotation | null>(null);

  useEffect(() => {
    if (panelData?.type !== "lemma") setGutterAnnotation(null);
  }, [panelData?.type]);

  useLayoutEffect(() => {
    if (panelData?.type !== "annotation:view" || annotationAnchor || !panelData.data.id) return;

    const frame = window.requestAnimationFrame(() => {
      const icon = document.querySelector<HTMLElement>(
        `[data-annotation-id="${CSS.escape(panelData.data.id!)}"]`,
      );
      const rect = icon?.getBoundingClientRect();
      if (rect) {
        setAnnotationAnchor({ kind: "gutter", x: rect.left, y: rect.top, right: rect.right, bottom: rect.bottom });
      }
    });

    return () => window.cancelAnimationFrame(frame);
  }, [annotationAnchor, panelData]);
  // annotations 통해 왔을 경우 해당 토큰으로 스크롤
  function scrollToAnnotation(startIndex: number) {
    const el = containerRef.current?.querySelector(
      `[data-idx="${startIndex}"]`
    ) as HTMLElement | null;
    
    if (!el) return;
    
    el.scrollIntoView({
      behavior: "instant",
      block: "center",
    });
  }

  useEffect(() => {
    if (!scrollRef) return;
    scrollRef(scrollToAnnotation);
  }, []);

  function captureUserExample(blockIndex: number, tokenIndex: number): UserLemmaExampleCapture | undefined {
    const block = blocks[blockIndex];
    if (!block?.tokens?.length) return undefined;
    return {
      text: block.text,
      tokens: block.tokens,
      match_indices: [tokenIndex],
    };
  }

  function openLemmaPanelByKey(
    key: string | null,
    userExampleCapture?: UserLemmaExampleCapture,
  ) {
    if (!key || !setPanelData) return;

    const info = lemmaInfo[key];
    if (!info) return;

    setSelection(null);
    setFinalSelection(null);
    setMenu(null);
    setPanelData({ type: "lemma", data: info, userExampleCapture });
  }

  function renderTokenSurface(token: Token, blockIndex: number, tokenIndex: number) {
    if ((language !== "ko" && language !== "ja") || !token.morphs || token.morphs.length === 0) {
      return token.surface;
    }

    return (
      <>
        {token.morphs.map((morph: MorphToken, morphIndex: number) => {
          const key = getLookupKeyForMorph(morph, language);
          const clickable = key != null && lemmaInfo[key] != null;

          return (
            <span
              key={`${morph.surface}-${morphIndex}`}
              onClick={(event) => {
                if (!clickable || blockClickRef.current) return;
                event.stopPropagation();
                openLemmaPanelByKey(key, captureUserExample(blockIndex, tokenIndex));
              }}
              className={[
                clickable ? "cursor-pointer" : "",
              ].filter(Boolean).join(" ")}
            >
              {morph.surface}
            </span>
          );
        })}
      </>
    );
  }

  function clearPointerState() {
    pointerDownRef.current = false;
    dragStartRef.current = null;
    didDragRef.current = false;
    setIsSelecting(false);

    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("[data-page-header='true']")) {
      return;
    }

    if (!(event.target as HTMLElement).closest("[data-idx]")) {
      setSelection(null);
      setFinalSelection(null);
      setMenu(null);
    }

    const isTouch = event.pointerType === "touch";
    if (isTouch) {
      setIsSelecting(true); // 일단 스크롤 막음
    }

    (event.target as HTMLElement).setPointerCapture(event.pointerId);

    pointerDownRef.current = true;
    dragStartRef.current = { x: event.clientX, y: event.clientY };
    didDragRef.current = false;
    setIsSelecting(false);

    longPressTimerRef.current = window.setTimeout(() => {
      const index = getNearestTokenIndex(event.clientX, event.clientY);
      if (index == null) return;

      didDragRef.current = true;
      setIsSelecting(true);
      setSelection({ anchor: index, focus: index });
    }, LONG_PRESS_MS);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("[data-page-header='true']")) {
      return;
    }

    if (!pointerDownRef.current || !dragStartRef.current) return;

    const dx = Math.abs(event.clientX - dragStartRef.current.x);
    const dy = Math.abs(event.clientY - dragStartRef.current.y);

    const isTouch = event.pointerType === "touch";
    if (!isTouch && !didDragRef.current && (dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD)) {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }

      const index = getNearestTokenIndex(event.clientX, event.clientY);
      if (index == null) return;

      didDragRef.current = true;
      setIsSelecting(true);
      setSelection({ anchor: index, focus: index });
      return;
    }

    if (!didDragRef.current) return;

    event.preventDefault();

    const index = getNearestTokenIndex(event.clientX, event.clientY);
    if (index == null) return;

    setSelection((prev) => (prev ? { ...prev, focus: index } : prev));
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("[data-page-header='true']")) {
      clearPointerState();
      return;
    }

    try {
      (event.target as HTMLElement).releasePointerCapture(event.pointerId);
    } catch {}

    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }

    if (!didDragRef.current) {
      setIsSelecting(false);
    }

    if (!didDragRef.current || !selection) {
      clearPointerState();
      return;
    }

    const start = Math.min(selection.anchor, selection.focus);
    const end = Math.max(selection.anchor, selection.focus);

    setFinalSelection({ start, end });
    setSelection(null);

    const rect = getTokenRect(containerRef.current, end);
    if (!rect || !containerRef.current) {
      clearPointerState();
      return;
    }

    const containerRect = containerRef.current.getBoundingClientRect();

    setMenu({
      x: rect.left - containerRect.left,
      y: rect.bottom - containerRect.top + 6,
      viewportX: rect.left,
      viewportY: rect.bottom + 6,
    });

    if (didDragRef.current) {
      blockClickRef.current = true;
      setTimeout(() => {
        blockClickRef.current = false;
      }, 0);
    }

    clearPointerState();
  };

  const handlePointerCancel = () => {
    clearPointerState();
  };

  const range = selection
    ? [Math.min(selection.anchor, selection.focus), Math.max(selection.anchor, selection.focus)]
    : finalSelection
      ? [finalSelection.start, finalSelection.end]
      : null;
  const selectionRangeKey = range ? `${range[0]}:${range[1]}` : "";
  const hoverRangeKey = hoverRange ? `${hoverRange.start}:${hoverRange.end}` : "";
  const panelRangeKey =
    panelData?.type === "annotation:view" || panelData?.type === "annotation:new"
      ? `${panelData.data.start_index}:${panelData.data.end_index}`
      : "";

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const measureGapWidths = () => {
      const selectedNodes = Array.from(
        container.querySelectorAll<HTMLElement>("[data-gap-fill-active='true']")
      );

      const allTokenNodes = Array.from(
        container.querySelectorAll<HTMLElement>("[data-idx]")
      );

      for (const node of allTokenNodes) {
        node.style.removeProperty("--selection-gap-width");
      }

      for (let i = 0; i < selectedNodes.length - 1; i += 1) {
        const current = selectedNodes[i];
        const next = selectedNodes[i + 1];

        const currentRect = current.getBoundingClientRect();
        const nextRect = next.getBoundingClientRect();

        const sameLine =
          Math.abs(currentRect.top - nextRect.top) <=
          Math.max(currentRect.height, nextRect.height) * 0.45;

        if (!sameLine) continue;

        const gapWidth = nextRect.left - currentRect.right;

        if (gapWidth <= 0) continue;

        current.style.setProperty(
          "--selection-gap-width",
          `${gapWidth}px`
        );
      }
    };

    measureGapWidths();

    const resizeObserver = new ResizeObserver(measureGapWidths);
    resizeObserver.observe(container);

    return () => resizeObserver.disconnect();
  }, [
    blocks,
    hoverRangeKey,
    pageId,
    panelRangeKey,
    selectionRangeKey,
    settings.lemma_info,
  ]);

  useEffect(() => {
    function handleCopy(event: ClipboardEvent) {
      if (!finalSelection) return;

      const selection = window.getSelection();
      const anchorNode = selection?.anchorNode;
      const container = containerRef.current;

      if (!anchorNode || !container || !container.contains(anchorNode)) {
        return;
      }

      const text = getTextForRange(blocks, finalSelection);

      event.preventDefault();
      event.clipboardData?.setData("text/plain", text);
    }

    document.addEventListener("copy", handleCopy);

    return () => document.removeEventListener("copy", handleCopy);
  }, [finalSelection, blocks]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // React 터치 이벤트만으로는 preventDefault가 안정적으로 먹지 않아
    // 길게 눌러 선택이 시작된 뒤에는 네이티브 touchmove에서 스크롤을 막는다.
    const handleTouchMove = (event: TouchEvent) => {
      if (!pointerDownRef.current || !didDragRef.current) return;
      event.preventDefault();
    };

    container.addEventListener("touchmove", handleTouchMove, { passive: false });

    return () => {
      container.removeEventListener("touchmove", handleTouchMove);
    };
  }, []);

  useEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer || !onVisibleBlockRangeChange) return;

    let frameId: number | null = null;
    let lastRangeKey: string | null = null;

    const measureVisibleRange = () => {
      frameId = null;

      const containerRect = scrollContainer.getBoundingClientRect();
      const blockNodes = Array.from(
        scrollContainer.querySelectorAll<HTMLElement>("[data-block-index]")
      );

      let start = Number.POSITIVE_INFINITY;
      let end = Number.NEGATIVE_INFINITY;

      for (const node of blockNodes) {
        const rect = node.getBoundingClientRect();
        const isVisible =
          rect.bottom >= containerRect.top && rect.top <= containerRect.bottom;

        if (!isVisible) continue;

        const blockIndex = Number(node.dataset.blockIndex);
        if (Number.isNaN(blockIndex)) continue;

        start = Math.min(start, blockIndex);
        end = Math.max(end, blockIndex);
      }

      if (!Number.isFinite(start) || !Number.isFinite(end)) return;

      const nextKey = `${start}:${end}`;
      if (nextKey === lastRangeKey) return;

      lastRangeKey = nextKey;
      onVisibleBlockRangeChange({ start, end });
    };

    const scheduleMeasure = () => {
      if (frameId != null) return;
      frameId = window.requestAnimationFrame(measureVisibleRange);
    };

    scheduleMeasure();
    scrollContainer.addEventListener("scroll", scheduleMeasure, { passive: true });
    window.addEventListener("resize", scheduleMeasure);

    return () => {
      if (frameId != null) {
        window.cancelAnimationFrame(frameId);
      }
      scrollContainer.removeEventListener("scroll", scheduleMeasure);
      window.removeEventListener("resize", scheduleMeasure);
    };
  }, [blocks, onVisibleBlockRangeChange]);

  return (
    <PageCore
      pageId={pageId}
      pageName={pageName}
      pageSource={pageSource}
      language={language}
      metadataItems={pageMetadata}
      onAddMetadata={onAddMetadata}
      onUpdateMetadata={onUpdateMetadata}
      onDeleteMetadata={onDeleteMetadata}
      blocks={blocks}
      containerRef={containerRef}
      scrollContainerRef={scrollContainerRef}
      activeLyricBlockIndex={activeLyricBlockIndex}
      syncPlaybackActive={syncPlaybackActive}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      wrapperStyle={{ touchAction: isSelecting ? "none" : "pan-y" }}
      horizontalAlign={horizontalAlign}
      textAlign={textAlign}
      contentPaddingClass={contentPaddingClass}
      allowOverflow={allowOverflow}
      interestKeys={interestKeys}
      getTokenProps={({ token, index, blockIndex, tokenIndex }) => {
        const key = getLookupKey(token, language);
        const info = key ? lemmaInfo[key] : undefined;
        const isInHover =
          hoverRange != null &&
          index >= hoverRange.start &&
          index <= hoverRange.end;
        const isInPanel = 
          (
            panelData?.type === 'annotation:view' ||
            panelData?.type === 'annotation:new'
          ) &&
          index >= panelData?.data.start_index &&
          index <= panelData?.data.end_index;
        const isInPanelLemma =
          panelData?.type === 'lemma' &&
          key === panelData?.data.key;
        const isSelected = range && index >= range[0] && index <= range[1];
        const hasGapFillHighlight = isInHover || isInPanel;

        return {
          onClick: () => {
            if (blockClickRef.current) return;
            
            setSelection(null);
            setFinalSelection(null);
            setMenu(null);

            if (!info || !setPanelData) return;
            setPanelData({
              type: "lemma",
              data: info,
              userExampleCapture: captureUserExample(blockIndex, tokenIndex),
            })
          },
          style: {
            cursor: info ? "pointer" : "default",
          },
          className: `
            font-body px-1 transition-all
            ${language === "ko" || language === "ja" ? "leading-[1.8] text-xl" : "text-[1.4rem] tracking-[-0.02em]"}
            ${language === "ja" ? 'font-[600]' : 'font-[630]'}
            ${isInPanelLemma ? 'font-bold!' : ''}
            ${isInHover
              ? 'bg-pos-highlight after:absolute after:left-full after:top-0 after:h-full after:w-[var(--selection-gap-width,0px)] after:bg-pos-highlight after:content-[\"\"]'
              : hasGapFillHighlight
                ? 'bg-neutral-300 after:absolute after:left-full after:top-0 after:h-full after:w-[var(--selection-gap-width,0px)] after:bg-neutral-300 after:content-[\"\"]'
                : ''}
            ${isSelected && 'bg-neutral-200 after:absolute after:left-full after:top-0 after:h-full after:w-[var(--selection-gap-width,0px)] after:bg-neutral-200 after:content-[\"\"]'}
            ${!info && "text-neutral-400"}
            ${getTokenClassName?.({ token, key }) ?? ""}
            `,
          "data-gap-fill-active":
            isSelected || isInPanel || isInHover ? "true" : undefined,
          "data-font-language": language,
        };
      }}
      renderTokenContent={({ token, blockIndex, tokenIndex }) =>
        renderTokenSurface(token, blockIndex, tokenIndex)}
      contentOverlay={
        <Gutter
          annotations={annotations}
          containerRef={containerRef}
          setHoverRange={setHoverRange}
          annotationId={gutterAnnotation?.id ?? (panelData?.data as Annotation)?.id}
          setEmojiPicker={setEmojiPicker}
          onOpenAnnotation={(annotation, rect) => {
            setAnnotationAnchor({
              kind: "gutter",
              x: rect.left,
              y: rect.top,
              right: rect.right,
              bottom: rect.bottom,
            });
            if (panelData?.type === "lemma") {
              setGutterAnnotation(annotation);
            } else {
              setPanelData?.({ type: "annotation:view", data: annotation });
            }
          }}
          onRequestEmojiDelete={setEmojiDeleteTarget}
        />
      }
      overlay={
        <>
          {menu && (
            <div
              className="absolute flex items-center gap-0.5 bg-neutral-50 w-auto h-8 px-1.5 py-1 border border-neutral-300/50 rounded-lg drop-shadow-xl"
              style={{ left: menu.x, top: menu.y - 6 }}
            >
              <IconButton
                icon={<MessageSquareMore size={15} />}
                onClick={() => {
                  if (!setPanelData || !pageId || !finalSelection) return;
                  
                  setPanelData({
                    type: "annotation:new",
                    data: {
                      page_id: pageId,
                      type: "memo",
                      content: "",
                      start_index: finalSelection.start,
                      end_index: finalSelection.end,
                    }
                  });
                  setAnnotationAnchor({ kind: "selection", x: menu.viewportX, y: menu.viewportY - 6 });
                  setMenu(null);
                }}
                title={t("new memo")}
              />
              <IconButton
                icon={<Link size={15} />}
                onClick={() => {
                  if (!setPanelData || !pageId || !finalSelection) return;

                  setPanelData({
                    type: "annotation:new",
                    data: {
                      page_id: pageId,
                      type: "link",
                      content: "",
                      start_index: finalSelection.start,
                      end_index: finalSelection.end,
                    }
                  });
                  setAnnotationAnchor({ kind: "selection", x: menu.viewportX, y: menu.viewportY - 6 });
                  setMenu(null);
                }}
                title={t("new link")}
              />
              <IconButton
                icon={<Smile size={15} />}
                onClick={() => {

                  if (!pageId || !finalSelection) return;

                  setEmojiPicker({
                    x: menu.viewportX,
                    y: menu.viewportY + 8,
                    selection: {
                      start: finalSelection.start,
                      end: finalSelection.end,
                    }
                  });
                }}
                title={t("new emoji")}
              />

            </div>
          )}

          {emojiPicker && (
            <EmojiPickerPopover
              x={emojiPicker.x}
              y={emojiPicker.y}
              pageId={pageId}
              selection={emojiPicker.selection}
              annotation={emojiPicker.annotation}
              setAnnotations={setAnnotations!}
              close={() => {
                setEmojiPicker(null);
                setMenu(null);
                setFinalSelection(null);
                setSelection(null);
              }}
            />
          )}

          {gutterAnnotation && panelData?.type === "lemma" ? (
            <AnnotationOverlay
              key={`gutter:${gutterAnnotation.id ?? gutterAnnotation.start_index}`}
              annotation={gutterAnnotation}
              mode="view"
              anchor={annotationAnchor}
              onClose={() => {
                setGutterAnnotation(null);
                setAnnotationAnchor(null);
              }}
              onCreated={(created) => {
                setAnnotations((prev) => [...prev, created]);
                setGutterAnnotation(created);
              }}
              onUpdated={(updated) => {
                setAnnotations((prev) => prev.map((item) => item.id === updated.id ? updated : item));
                setGutterAnnotation(updated);
              }}
              onDeleted={(annotationId) => {
                setAnnotations((prev) => prev.filter((item) => item.id !== annotationId));
                setGutterAnnotation(null);
                setAnnotationAnchor(null);
              }}
            />
          ) : null}

          {(panelData?.type === "annotation:new" || panelData?.type === "annotation:view") && panelData.data.type !== "emoji" ? (
            <AnnotationOverlay
              key={`${panelData.type}:${panelData.data.id ?? `${panelData.data.start_index}:${panelData.data.end_index}`}`}
              annotation={panelData.data}
              mode={panelData.type === "annotation:new" ? "new" : "view"}
              anchor={annotationAnchor}
              onClose={() => {
                setPanelData?.(null);
                setAnnotationAnchor(null);
                setFinalSelection(null);
                setSelection(null);
              }}
              onCreated={(created) => {
                setAnnotations((prev) => [...prev, created]);
                setPanelData?.({ type: "annotation:view", data: created });
              }}
              onUpdated={(updated) => {
                setAnnotations((prev) => prev.map((item) => item.id === updated.id ? updated : item));
                setPanelData?.({ type: "annotation:view", data: updated });
              }}
              onDeleted={(annotationId) => {
                setAnnotations((prev) => prev.filter((item) => item.id !== annotationId));
              }}
            />
          ) : null}

          <ResponsiveModal open={emojiDeleteTarget !== null} onClose={() => setEmojiDeleteTarget(null)}>
            <div className="flex flex-col gap-7 md:pb-3">
              <h2>{t("Delete this annotation?")}</h2>
              <TextButton
                text={t("Delete")}
                onClick={() => {
                  if (!emojiDeleteTarget?.id) return;
                  void deleteAnnotation(emojiDeleteTarget.id).then(() => {
                    setAnnotations((prev) => prev.filter((item) => item.id !== emojiDeleteTarget.id));
                    setEmojiDeleteTarget(null);
                  });
                }}
                fit
                red
              />
            </div>
          </ResponsiveModal>
        </>
      }
    />
  );
}
