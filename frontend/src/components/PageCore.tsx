import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type {
  CSSProperties,
  HTMLAttributes,
  PointerEventHandler,
  ReactNode,
  RefObject,
} from "react";
import type { Token, TextBlock } from "./pageTypes";
import { useSettings } from "./useSettings";
import { FileInput, Pencil, Plus, Trash2 } from "lucide-react";
import { MiniPopup } from "./util/MiniPopup";
import { useI18n } from "../i18n";

/* =========================================================
 CONFIG
========================================================= */

const HIGHLIGHT_CONFIG = {
  mergeGap: 14,

  blob: {
    padX: 12,
    padY: -4,
    wobbleX: 5,
    wobbleY: 5,
  },

  fill: {
    opacity: 0.34,
    blur: 5.5,
  },

  edge: {
    opacity: 0.08,
    width: 1.3,
    blur: 0.9,
  },

  metaball: {
    opacity: 0.34,
    blur: 6,
    alphaBoost: 29,
    alphaCutoff: -9,
  },
};

type TokenRenderProps = HTMLAttributes<HTMLSpanElement> & {
  className?: string;
  style?: CSSProperties;
};

type HighlightBlob = {
  key: string;
  fill: string;
  edge: string;
  x: number;
  y: number;
  width: number;
  height: number;
  seed: number;
  lineCenter: number;
  right: number;
  blockIndex: number;
  syncOpacity: number;
};

function noise(seed: number, offset: number) {
  const value =
    Math.sin(seed * 12.9898 + offset * 78.233) * 43758.5453;

  return value - Math.floor(value);
}

function wobble(seed: number, offset: number, amplitude: number) {
  return (noise(seed, offset) - 0.5) * amplitude * 2;
}

function buildBlobPath(blob: HighlightBlob) {
  const cfg = HIGHLIGHT_CONFIG.blob;

  const padX = cfg.padX;
  const padY = cfg.padY;

  const left =
    blob.x -
    padX +
    wobble(blob.seed, 1, cfg.wobbleX);

  const right =
    blob.x +
    blob.width +
    padX +
    wobble(blob.seed, 2, cfg.wobbleX);

  const top =
    blob.y -
    padY +
    wobble(blob.seed, 3, cfg.wobbleY);

  const bottom =
    blob.y +
    blob.height +
    padY +
    wobble(blob.seed, 4, cfg.wobbleY);

  const middleX = (left + right) / 2;
  const middleY = (top + bottom) / 2;

  return `
    M ${left + 12},${top}
    Q ${middleX},${top - 3} ${right - 12},${top}
    Q ${right + 3},${middleY} ${right - 10},${bottom}
    Q ${middleX},${bottom + 3} ${left + 10},${bottom}
    Q ${left - 3},${middleY} ${left + 12},${top}
    Z
  `;
}

function mergeHighlights(highlights: HighlightBlob[]) {
  const sorted = [...highlights].sort((a, b) =>
    a.y === b.y ? a.x - b.x : a.y - b.y
  );

  const merged: HighlightBlob[] = [];

  for (const highlight of sorted) {
    const current = merged.at(-1);

    const gap = current
      ? highlight.x - current.right
      : Number.POSITIVE_INFINITY;

    const sameLine =
      current &&
      Math.abs(
        current.lineCenter - highlight.lineCenter
      ) <=
        Math.max(current.height, highlight.height) *
          0.55;

    const sameColor =
      current &&
      current.fill === highlight.fill;

    if (
      current &&
      sameLine &&
      sameColor &&
      gap <= HIGHLIGHT_CONFIG.mergeGap
    ) {
      const nextRight = Math.max(
        current.right,
        highlight.right
      );

      const nextBottom = Math.max(
        current.y + current.height,
        highlight.y + highlight.height
      );

      current.x = Math.min(current.x, highlight.x);
      current.y = Math.min(current.y, highlight.y);

      current.width = nextRight - current.x;
      current.height = nextBottom - current.y;

      current.right = nextRight;

      current.lineCenter =
        current.y + current.height / 2;

      current.key += `-${highlight.key}`;
      current.syncOpacity = Math.min(
        current.syncOpacity,
        highlight.syncOpacity
      );

      continue;
    }

    merged.push({ ...highlight });
  }

  return merged;
}

function getLyricLineVisualState(
  blockIndex: number,
  activeLyricBlockIndex: number,
  syncPlaybackActive: boolean
) {
  if (!syncPlaybackActive || activeLyricBlockIndex < 0) {
    return {
      blockOpacity: 1,
      blockMinHeightClass: "",
      blockAlignClass: "",
      blockPaddingClass: "",
      tokenSizeClass: "",
      tokenPaddingClass: "",
      highlightOpacity: 1,
    };
  }

  const isActiveLine = blockIndex === activeLyricBlockIndex;

  if (isActiveLine) {
    return {
      blockOpacity: 1,
      blockMinHeightClass: "",
      blockAlignClass: "",
      blockPaddingClass: "",
      tokenSizeClass: "",
      tokenPaddingClass: "",
      highlightOpacity: 1,
    };
  }

  return {
    blockOpacity: 0.6,
    blockMinHeightClass: "",
    blockAlignClass: "",
    blockPaddingClass: "",
    tokenSizeClass: "",
    tokenPaddingClass: "",
    highlightOpacity: 0.5,
  };
}

function TokenHighlightOverlay({
  pageId,
  containerRef,
  blocks,
  activeLyricBlockIndex,
  syncPlaybackActive,
}: {
  pageId?: string;
  containerRef: RefObject<HTMLDivElement | null>;
  blocks: TextBlock[];
  activeLyricBlockIndex: number;
  syncPlaybackActive: boolean;
}) {
  const [size, setSize] = useState({
    width: 0,
    height: 0,
  });
  const [highlights, setHighlights] = useState<
    HighlightBlob[]
  >([]);

  const filterId = useId();

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let scheduled = false;

    const measureNow = () => {
      const containerRect =
        container.getBoundingClientRect();

      const nextHighlights = mergeHighlights([]);

      setHighlights(nextHighlights);

      setSize({
        width: Math.ceil(containerRect.width),
        height: Math.ceil(container.scrollHeight),
      });
    };

    const scheduleMeasure = () => {
      if (scheduled) return;
      scheduled = true;

      // double rAF
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {  // ← 추가
          scheduled = false;
          measureNow();
        });
      });
    };

    scheduleMeasure();

    const resizeObserver = new ResizeObserver(
      scheduleMeasure
    );

    resizeObserver.observe(container);

    const observedNodes = new Set<Element>();

    const observeTokens = () => {
      const tokenNodes =
        container.querySelectorAll<HTMLSpanElement>(
          "[data-token-highlight='true']"
        );

      tokenNodes.forEach((node) => {
        if (observedNodes.has(node)) return;

        observedNodes.add(node);
        resizeObserver.observe(node);
      });
    };

    const mutationObserver = new MutationObserver(() => {
      observeTokens();
      scheduleMeasure();
    });

    mutationObserver.observe(container, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
    });

    window.addEventListener(
      "resize",
      scheduleMeasure
    );

    if ("fonts" in document) {
      void document.fonts.ready.then(
        scheduleMeasure
      );

      document.fonts.addEventListener(
        "loadingdone",
        scheduleMeasure
      );
    }

    return () => {
      resizeObserver.disconnect();
      mutationObserver.disconnect();

      window.removeEventListener(
        "resize",
        scheduleMeasure
      );

      if ("fonts" in document) {
        document.fonts.removeEventListener(
          "loadingdone",
          scheduleMeasure
        );
      }
    };
  }, [pageId, blocks, containerRef.current, activeLyricBlockIndex, syncPlaybackActive]);

  return (
    <svg
      aria-hidden="true"
      className="shrink-0 pointer-events-none absolute inset-0 z-0 overflow-visible -translate-y-0.5"
      style={{

    overflow: "visible",

    contain: "layout paint size",

  }}
      width={size.width}
      height={size.height}
      viewBox={`0 0 ${size.width} ${size.height}`}
    >
      <defs>
        {/* metaball-ish union */}
        <filter
          id={`${filterId}-goo`}
          x="-40%"
          y="-40%"
          width="180%"
          height="180%"
        >
          <feGaussianBlur
            in="SourceGraphic"
            stdDeviation={
              HIGHLIGHT_CONFIG.metaball.blur
            }
            result="blur"
          />

          <feColorMatrix
            in="blur"
            mode="matrix"
            values={`
              1 0 0 0 0
              0 1 0 0 0
              0 0 1 0 0
              0 0 0 ${HIGHLIGHT_CONFIG.metaball.alphaBoost} ${HIGHLIGHT_CONFIG.metaball.alphaCutoff}
            `}
            result="goo"
          />

          <feBlend
            in="SourceGraphic"
            in2="goo"
          />
        </filter>

        <filter
          id={`${filterId}-edge`}
          x="-30%"
          y="-30%"
          width="160%"
          height="160%"
        >
          <feGaussianBlur
            stdDeviation={
              HIGHLIGHT_CONFIG.edge.blur
            }
          />
        </filter>
      </defs>

      {/* unified fill layer */}
      <g
        filter={`url(#${filterId}-goo)`}
        opacity={HIGHLIGHT_CONFIG.metaball.opacity}
      >
        {highlights.map((highlight) => {
          const d = buildBlobPath(highlight);

          return (
            <path
              key={highlight.key}
              d={d}
              fill={highlight.fill}
              fillOpacity={
                HIGHLIGHT_CONFIG.fill.opacity *
                highlight.syncOpacity
              }
            />
          );
        })}
      </g>

      {/* unified edge layer */}
      <g
        style={{
          mixBlendMode: "screen",
        }}
      >
        {highlights.map((highlight) => {
          const d = buildBlobPath(highlight);

          return (
            <path
              key={`${highlight.key}-edge`}
              d={d}
              fill="none"
              stroke={highlight.edge}
              strokeWidth={
                HIGHLIGHT_CONFIG.edge.width
              }
              strokeOpacity={
                HIGHLIGHT_CONFIG.edge.opacity *
                highlight.syncOpacity
              }
              filter={`url(#${filterId}-edge)`}
              strokeLinejoin="round"
            />
          );
        })}
      </g>
    </svg>
  );
}

/* =========================================================
 PAGE
========================================================= */

export default function PageCore({
  pageId,
  pageName,
  pageSource,
  language,
  metadataItems,
  onAddMetadata,
  onUpdateMetadata,
  onDeleteMetadata,
  blocks,
  containerRef,
  scrollContainerRef,
  activeLyricBlockIndex = -1,
  syncPlaybackActive = false,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  getTokenProps,
  renderTokenContent,
  rightAside,
  contentOverlay,
  overlay,
  interestKeys,
  wrapperStyle,
  horizontalAlign = "center",
}: {
  pageId?: string;
  pageName?: string;
  pageSource?: string;
  language?: string;
  metadataItems?: string[];
  onAddMetadata?: (value: string) => Promise<void>;
  onUpdateMetadata?: (index: number, value: string) => Promise<void>;
  onDeleteMetadata?: (index: number) => Promise<void>;
  blocks: TextBlock[];
  containerRef: RefObject<HTMLDivElement | null>;
  scrollContainerRef?: RefObject<HTMLDivElement | null>;
  activeLyricBlockIndex?: number;
  syncPlaybackActive?: boolean;
  onPointerDown?: PointerEventHandler<HTMLDivElement>;
  onPointerMove?: PointerEventHandler<HTMLDivElement>;
  onPointerUp?: PointerEventHandler<HTMLDivElement>;
  onPointerCancel?: PointerEventHandler<HTMLDivElement>;
  interestKeys?: Set<string>;
  getTokenProps?: (args: {
    token: Token;
    index: number;
    blockIndex: number;
    tokenIndex: number;
  }) => TokenRenderProps;
  renderTokenContent?: (args: {
    token: Token;
    index: number;
    blockIndex: number;
    tokenIndex: number;
  }) => ReactNode;
  rightAside?: ReactNode;
  contentOverlay?: ReactNode;
  overlay?: ReactNode;
  wrapperStyle?: CSSProperties;
  horizontalAlign?: "left" | "right" | "center";
}) {
  let globalIndex = 0;

  const { settings } = useSettings();
  const { t } = useI18n();
  const [openMetadataMenuId, setOpenMetadataMenuId] = useState<string | null>(null);
  const [draftMetadata, setDraftMetadata] = useState("");
  const [editingMetadataIndex, setEditingMetadataIndex] = useState<number | null>(null);
  const [savingMetadata, setSavingMetadata] = useState(false);
  const [isCoarsePointer, setIsCoarsePointer] = useState(false);
  const [pressedMetadataIndex, setPressedMetadataIndex] = useState<number | null>(null);
  const longPressGestureRef = useRef<{
    index: number;
    startX: number;
    startY: number;
    timerId: number;
  } | null>(null);
  const suppressMetadataClickRef = useRef<number | null>(null);
  const isLyricPage = pageSource === "lrclib";
  const containerAlignClass =
    horizontalAlign === "left"
      ? "items-start"
      : horizontalAlign === "right"
        ? "items-end"
        : "items-center";

  const safeMetadataItems = metadataItems ?? [];
  const canManageMetadata = Boolean(pageId && onAddMetadata && onUpdateMetadata && onDeleteMetadata);

  useEffect(() => {
    setDraftMetadata("");
    setEditingMetadataIndex(null);
    setOpenMetadataMenuId(null);
    setSavingMetadata(false);
  }, [pageId, JSON.stringify(safeMetadataItems)]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const media = window.matchMedia("(pointer: coarse)");
    const update = () => setIsCoarsePointer(media.matches);

    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  function clearMetadataLongPress() {
    if (longPressGestureRef.current) {
      window.clearTimeout(longPressGestureRef.current.timerId);
      longPressGestureRef.current = null;
    }

    setPressedMetadataIndex(null);
  }

  function startEditingMetadata(index: number, value: string) {
    clearMetadataLongPress();
    setEditingMetadataIndex(index);
    setDraftMetadata(value);
    setOpenMetadataMenuId(null);
  }

  async function handleSaveMetadata() {
    if (!canManageMetadata || !pageId) return;

    const nextValue = draftMetadata.trim();
    if (!nextValue) {
      if (editingMetadataIndex != null) {
        setDraftMetadata("");
        setEditingMetadataIndex(null);
        setOpenMetadataMenuId(null);
      }
      return;
    }

    setSavingMetadata(true);

    try {
      if (editingMetadataIndex == null || editingMetadataIndex < 0) {
        await onAddMetadata?.(nextValue);
      } else {
        await onUpdateMetadata?.(editingMetadataIndex, nextValue);
      }

      setDraftMetadata("");
      setEditingMetadataIndex(null);
      setOpenMetadataMenuId(null);
    } finally {
      setSavingMetadata(false);
    }
  }

  return (
    <div
      ref={scrollContainerRef}
      className="relative flex h-full min-h-0 flex-1 justify-center overflow-y-auto overflow-x-hidden no-scrollbar"
      style={wrapperStyle}
    >
      
      <div
        ref={containerRef}
        className={`relative flex min-h-full w-full flex-col isolate ${containerAlignClass} ${
          pageId ? "px-4 md:px-6 pt-24" : 'p-3'
        } ${settings.lemma_info ? `${syncPlaybackActive ? 'gap-y-28':'gap-y-5'}` : `${syncPlaybackActive ? 'gap-y-5':''}`}`}
        style={{
          userSelect: "none",
          overflowAnchor: "none",
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      >
        <div className={`flex w-full flex-col ${containerAlignClass} ${pageId ? "pb-[5rem]" : ""}`}>
        {pageId ? (
          <div
            data-page-header="true"
            className={`
              flex w-full max-w-[48em] flex-col gap-14 pb-14 select-text font-pretendard
              items-start text-left
            `}
            style={{ userSelect: "text", WebkitUserSelect: "text" }}
          >

            <h1
              className="font-body w-full text-3xl select-text leading-[1.2em] font-bold tracking-tight"
              data-font-language={language}
            >
              {pageName?.trim() || "Untitled page"}
            </h1>

            {/* metadata */}
            <div className="flex flex-col items-start gap-1 -translate-x-1 text-left text-sm font-medium">
              {pageSource && pageSource !== 'user' ? (
                <div className="flex gap-1.5 items-center font-pretendard text-neutral-400 py-1 px-1">
                  <FileInput size={13}/>
                  <span>{pageSource}</span>
                </div>
              ) : null}

              {safeMetadataItems.map((item, index) => {
                const popupId = `metadata-${index}`;
                const isEditing = editingMetadataIndex === index;
                const menuOpen = openMetadataMenuId === popupId;
                const interactionHighlighted =
                  menuOpen || pressedMetadataIndex === index;

                return (
                  <div
                    key={`${item}-${index}`}
                    className={`
                      group relative flex flex-col gap-1 rounded px-1 py-1 transition-colors
                      ${!isEditing && !isCoarsePointer ? 'hover:bg-neutral-200/50' : ''}
                      ${interactionHighlighted ? 'bg-neutral-200/50' : ''}
                      ${menuOpen ? 'z-90' : 'z-0'}
                    `}
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      if (!canManageMetadata || !isCoarsePointer || isEditing) return;

                      clearMetadataLongPress();
                      suppressMetadataClickRef.current = null;
                      setPressedMetadataIndex(index);
                      const timerId = window.setTimeout(() => {
                        suppressMetadataClickRef.current = index;
                        setOpenMetadataMenuId(popupId);
                        longPressGestureRef.current = null;
                      }, 400);
                      longPressGestureRef.current = {
                        index,
                        startX: event.clientX,
                        startY: event.clientY,
                        timerId,
                      };
                    }}
                    onPointerMove={(event) => {
                      const gesture = longPressGestureRef.current;
                      if (!gesture || gesture.index !== index) return;

                      if (
                        Math.hypot(
                          event.clientX - gesture.startX,
                          event.clientY - gesture.startY
                        ) > 8
                      ) {
                        clearMetadataLongPress();
                      }
                    }}
                    onPointerUp={() => clearMetadataLongPress()}
                    onPointerLeave={() => clearMetadataLongPress()}
                    onPointerCancel={() => clearMetadataLongPress()}
                    onDoubleClick={(event) => {
                      if (!canManageMetadata || isCoarsePointer || isEditing) return;
                      event.preventDefault();
                      event.stopPropagation();
                      startEditingMetadata(index, item);
                    }}
                    onContextMenu={(event) => {
                      if (!canManageMetadata || isCoarsePointer || isEditing) return;
                      event.preventDefault();
                      event.stopPropagation();
                      setOpenMetadataMenuId(popupId);
                    }}
                    style={
                      isCoarsePointer
                        ? { userSelect: "none", WebkitUserSelect: "none" }
                        : undefined
                    }
                  >
                    {isEditing ? (
                      <input
                        type="text"
                        className="field-sizing-content min-w-[2ch] max-w-[min(78vw,42rem)] border-0 bg-transparent p-0 text-left outline-none"
                        value={draftMetadata}
                        onChange={(event) => setDraftMetadata(event.target.value)}
                        onBlur={() => void handleSaveMetadata()}
                        onKeyDown={(event) => {
                          if (event.nativeEvent.isComposing) return;
                          if (event.key === "Enter" || event.key === "Escape") {
                            event.preventDefault();
                            event.currentTarget.blur();
                          }
                        }}
                        disabled={savingMetadata}
                        autoFocus
                      />
                    ) : (
                      <div
                        className={`flex flex-col items-start text-left ${isCoarsePointer ? 'select-none' : 'select-text'}`}
                      >
                        {item.startsWith('https://')
                          ? (
                            <a
                              href={item}
                              className="max-w-78 truncate underline underline-offset-3 transition-colors hover:text-neutral-400"
                              target="_blank"
                              onClick={(event) => {
                                if (suppressMetadataClickRef.current === index) {
                                  event.preventDefault();
                                  suppressMetadataClickRef.current = null;
                                }
                              }}
                            >
                              {item}
                            </a>
                          ) : (
                            <span>
                              {item}
                            </span>
                          )
                        }
                      </div>
                    )}

                    {canManageMetadata && !isEditing ? (
                      <MiniPopup
                        open={menuOpen}
                        onClose={() => setOpenMetadataMenuId(null)}
                        left
                      >
                        <button
                          type="button"
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-neutral-700 transition-colors hover:bg-neutral-100"
                          onClick={() => startEditingMetadata(index, item)}
                        >
                          <Pencil size={13} />
                          <span>{t("Edit")}</span>
                        </button>
                        <button
                          type="button"
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-red-600 transition-colors hover:bg-red-50"
                          onClick={() => {
                            setOpenMetadataMenuId(null);
                            void onDeleteMetadata?.(index);
                          }}
                        >
                          <Trash2 size={13} />
                          <span>{t("Delete")}</span>
                        </button>
                      </MiniPopup>
                    ) : null}
                  </div>
                );
              })}

              {canManageMetadata &&
              safeMetadataItems.length < 5 &&
              editingMetadataIndex == null ? (
                <button
                  type="button"
                  onClick={() => {
                    setDraftMetadata("");
                    setEditingMetadataIndex(-1);
                  }}
                  className={`flex items-center gap-2 rounded px-1 py-1 text-neutral-400 transition-colors truncate ${
                    !isCoarsePointer ? "hover:bg-neutral-200/50" : ""
                  }`}
                >
                  <Plus size={14} />
                  <span className="font-pretendard">{t("Add metadata")}</span>
                </button>
              ) : null}

              {canManageMetadata && editingMetadataIndex === -1 ? (
                <input
                  type="text"
                  className="field-sizing-content min-w-[2ch] max-w-[min(78vw,42rem)] border-0 bg-transparent px-1 py-1 text-left outline-none placeholder:text-neutral-400"
                  placeholder={t("Add metadata")}
                  value={draftMetadata}
                  onChange={(event) => setDraftMetadata(event.target.value)}
                  onBlur={() => void handleSaveMetadata()}
                  onKeyDown={(event) => {
                    if (event.nativeEvent.isComposing) return;
                    if (event.key === "Enter" || event.key === "Escape") {
                      event.preventDefault();
                      event.currentTarget.blur();
                    }
                  }}
                  disabled={savingMetadata}
                  autoFocus
                />
              ) : null}
            </div>
            
          </div>
        ) : null}

        <div
          className={
            isLyricPage
              ? `flex w-full flex-col translate-x-[-0.15em] ${containerAlignClass} gap-y-[1.5em]`
              : "contents"
          }
        >
        {blocks.map((block, blockIndex) => (
          (() => {
            const visualState = getLyricLineVisualState(
              blockIndex,
              activeLyricBlockIndex,
              syncPlaybackActive
            );
            const previousBlock = blockIndex > 0
              ? blocks[blockIndex - 1]
              : null;
            const previousBlockHasTokens =
              (previousBlock?.tokens?.length ?? 0) > 0;
            const shouldIndentFirstLine =
              pageSource !== "lrclib" &&
              blockIndex > 0 &&
              previousBlockHasTokens;
            const isActiveLine =
              blockIndex === activeLyricBlockIndex;

            return (
              <div
                key={blockIndex}
                data-block-index={blockIndex}
                data-lyric-line={block.timestamp_ms != null ? "true" : "false"}
                className={`
                  relative z-1 flex w-full max-w-[48em] flex-wrap content-start
                  ${isLyricPage ? "justify-start" : "justify-between"}
                  after:basis-0 after:flex-auto after:content-['']
                  transition-all duration-300 origin-left
                  ${language === "ko" || language === "ja" ? "leading-10" : ""}
                  ${block.tokens?.length === 0 && 'h-[1.7em] shrink-0'}
                  ${visualState.blockMinHeightClass}
                  ${visualState.blockAlignClass}
                  ${visualState.blockPaddingClass}
                `}
                style={{
                  opacity: visualState.blockOpacity,
                }}
              >
                {block.tokens?.map((token, tokenPosition) => {
                  const tokenIndex = globalIndex++;

                  const tokenProps =
                    getTokenProps?.({
                      token,
                      index: tokenIndex,
                      blockIndex,
                      tokenIndex: tokenPosition,
                    }) ?? {};

                  const {
                    className,
                    style,
                    ...restTokenProps
                  } = tokenProps;

                  const highlightPalette = null;
                  const isInterested = Boolean(
                    language &&
                    interestKeys &&
                    [
                      ...(token.lemma && token.pos
                        ? [{ lemma: token.lemma, pos: token.pos }]
                        : []),
                      ...(token.morphs ?? []),
                    ].some((unit) =>
                      Boolean(
                        unit.lemma &&
                        unit.pos &&
                        interestKeys.has(`${unit.lemma}/${unit.pos}/${language}`)
                      )
                    )
                  );

                  return (
                    <span
                      key={tokenIndex}
                      data-idx={tokenIndex}
                      data-token-highlight={
                        highlightPalette
                          ? "true"
                          : "false"
                      }
                      className={[
                        "relative z-10 flex flex-col",
                        language === "ja" ? 'px-0!' : 'px-[0.15em]',
                        settings.lemma_info && pageId
                          ? isActiveLine
                            ? "min-h-[4em] h-auto gap-2"
                            : "min-h-[4em] h-auto gap-1"
                          : isLyricPage
                            ? "h-auto min-h-[1.3em] gap-0 justify-center"
                          : pageId
                            ? "min-h-[1.5em] h-auto gap-0"
                            : "",
                        pageId ? "transition-all" : "",
                        
                        visualState.tokenSizeClass,
                        visualState.tokenPaddingClass,
                        className,
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      style={{
                        ...(shouldIndentFirstLine && tokenPosition === 0
                          ? { marginInlineStart: "2em" }
                          : {}),
                        ...style,
                      }}
                      {...restTokenProps}
                    >
                      <span className="grid">
                        <span
                          aria-hidden="true"
                          className="invisible col-start-1 row-start-1"
                        >
                          {token.surface}
                        </span>
                        <span
                          className={`relative isolate col-start-1 row-start-1 ${
                            isInterested ? "bg-yellow-200/50" : ""
                          }`}
                        >
                          {isInterested && (
                            <span
                              aria-hidden="true"
                              className="pointer-events-none absolute inset-x-0 bottom-0 z-0 h-1 bg-yellow-400/30"
                            />
                          )}
                          <span className="relative z-10">
                            {renderTokenContent
                              ? renderTokenContent({
                                token,
                                index: tokenIndex,
                                blockIndex,
                                tokenIndex: tokenPosition,
                              })
                              : token.surface}
                          </span>
                        </span>
                      </span>
                      <div
                        className={`
                          flex-col text-xs font-normal font-pretendard
                          ${settings.lemma_info
                            ? "flex w-max opacity-80 transition-opacity duration-700"
                            : "max-h-0 w-0 opacity-0 transition-opacity duration-700"}
                          ${token.pos === "X" ? "opacity-0" : ""}
                          ${!pageId ? "hidden" : ""}
                        `}
                      >
                        <span>{token.lemma}</span>
                        <span>{token.pos}</span>
                      </div>
                    </span>
                  );
                })}
              </div>
            );
          })()
        ))}
        </div>
        </div>

        <TokenHighlightOverlay
          key={pageId}
          pageId={pageId}
          containerRef={containerRef}
          blocks={blocks}
          activeLyricBlockIndex={activeLyricBlockIndex}
          syncPlaybackActive={syncPlaybackActive}
        />
        {contentOverlay}
      </div>

      {rightAside}
      {overlay}
    </div>
  );
}
