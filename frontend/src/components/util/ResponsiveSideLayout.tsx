import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { isCapacitorApp } from "../../platform";
import { useLayout } from "../RootLayout";
import { useSettings } from "../useSettings";
import { MobileSwipeHint, MobileSwipeHintCard } from "./MobileSwipeHint";
import { getMobileSwipeHintMotionStyle } from "./mobileSwipeHintMotion";

type Props = {
  open: boolean;
  onClose: () => void;
  onSwipeRight?: () => void | Promise<void>;
  children: React.ReactNode;
};

const MIN_DESKTOP_WIDTH = 160;
const DEFAULT_DESKTOP_WIDTH = 400;
const LEFT_NAV_WIDTH = 36;
const DESKTOP_REMAINDER = 160;
const STORAGE_KEY = "lemma-side-layout-width";
const SWIPE_DURATION_MS = 220;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function isInteractive(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest([
    "button", "a", "input", "textarea", "select", "label",
    "[role='button']", "[contenteditable='true']",
    "[data-side-layout-no-swipe='true']",
  ].join(",")));
}

export default function ResponsiveSideLayout({
  open,
  onClose,
  onSwipeRight,
  children,
}: Props) {
  const {
    pageSidebarOpen,
    pageSidebarWidth,
    setLemmaPanelLeft,
    setLemmaPanelWidth,
  } = useLayout();
  const { settings, setSettings } = useSettings();
  const [isMobile, setIsMobile] = useState(
    () => isCapacitorApp() || (typeof window !== "undefined" && window.innerWidth < 768),
  );
  const [desktopWidth, setDesktopWidth] = useState(() => {
    if (typeof window === "undefined") return DEFAULT_DESKTOP_WIDTH;
    const saved = Number(window.localStorage.getItem(STORAGE_KEY));
    return Number.isFinite(saved) ? saved : DEFAULT_DESKTOP_WIDTH;
  });
  const [viewportWidth, setViewportWidth] = useState(
    () => typeof window === "undefined" ? 1280 : window.innerWidth,
  );
  const desktopPanelRef = useRef<HTMLElement | null>(null);
  const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const resizeCloseArmedRef = useRef(false);
  const [resizeCloseArmed, setResizeCloseArmed] = useState(false);

  const [mobileMounted, setMobileMounted] = useState(false);
  const [mobileVisible, setMobileVisible] = useState(false);
  const [dragX, setDragX] = useState(0);
  const [dismissing, setDismissing] = useState(false);
  const [showSwipeHint, setShowSwipeHint] = useState(false);
  const [hideSwipeHintPermanently, setHideSwipeHintPermanently] = useState(false);
  const gestureRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startedAt: number;
    horizontal: boolean | null;
  } | null>(null);

  const maxDesktopWidth = Math.max(
    MIN_DESKTOP_WIDTH,
    Math.min(
      viewportWidth * 0.8,
      viewportWidth - LEFT_NAV_WIDTH
        - (pageSidebarOpen ? Math.min(pageSidebarWidth, viewportWidth / 2) : 0)
        - DESKTOP_REMAINDER,
    ),
  );
  const constrainedDesktopWidth = clamp(
    desktopWidth,
    MIN_DESKTOP_WIDTH,
    maxDesktopWidth,
  );

  useEffect(() => {
    const updateViewport = () => {
      setViewportWidth(window.innerWidth);
      setIsMobile(isCapacitorApp() || window.innerWidth < 768);
    };
    updateViewport();
    window.addEventListener("resize", updateViewport);
    return () => window.removeEventListener("resize", updateViewport);
  }, []);

  useEffect(() => {
    if (isMobile || !open) {
      setLemmaPanelLeft(null);
      setLemmaPanelWidth(null);
      return;
    }

    const panel = desktopPanelRef.current;
    if (!panel) return;

    const updatePanelWidth = () => {
      const { left, width } = panel.getBoundingClientRect();
      setLemmaPanelLeft(left);
      setLemmaPanelWidth(width);
    };

    updatePanelWidth();
    const observer = new ResizeObserver(updatePanelWidth);
    observer.observe(panel);
    return () => observer.disconnect();
  }, [constrainedDesktopWidth, isMobile, open, setLemmaPanelLeft, setLemmaPanelWidth]);

  useEffect(() => () => {
    setLemmaPanelLeft(null);
    setLemmaPanelWidth(null);
  }, [setLemmaPanelLeft, setLemmaPanelWidth]);

  useEffect(() => {
    if (!isMobile || !open) {
      setMobileVisible(false);
      setShowSwipeHint(false);
      setHideSwipeHintPermanently(false);
      if (!open) setMobileMounted(false);
      return;
    }
    setMobileMounted(true);
    setDismissing(false);
    setDragX(0);
    setHideSwipeHintPermanently(false);
    setShowSwipeHint(!settings.hide_lemma_swipe_hint);
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => setMobileVisible(true));
    });
    return () => cancelAnimationFrame(id);
  }, [isMobile, open, settings.hide_lemma_swipe_hint]);

  const finishMobileClose = useCallback((direction: -1 | 0 | 1) => {
    if (dismissing) return;
    if (showSwipeHint && hideSwipeHintPermanently) {
      setSettings((prev) => ({ ...prev, hide_lemma_swipe_hint: true }));
    }
    setDismissing(true);
    setMobileVisible(false);
    setDragX(direction * window.innerWidth * 1.15);
    if (direction > 0) void onSwipeRight?.();
    window.setTimeout(() => {
      setMobileMounted(false);
      setDismissing(false);
      setDragX(0);
      onClose();
    }, SWIPE_DURATION_MS);
  }, [dismissing, hideSwipeHintPermanently, onClose, onSwipeRight, setSettings, showSwipeHint]);

  const dismissSwipeHint = useCallback(() => {
    if (hideSwipeHintPermanently) {
      setSettings((prev) => ({ ...prev, hide_lemma_swipe_hint: true }));
    }
    setShowSwipeHint(false);
  }, [hideSwipeHintPermanently, setSettings]);

  const onMobilePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (showSwipeHint || dismissing || isInteractive(event.target)) return;
    gestureRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startedAt: performance.now(),
      horizontal: null,
    };
  };

  const onMobilePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const dx = event.clientX - gesture.startX;
    const dy = event.clientY - gesture.startY;
    if (gesture.horizontal === null && Math.max(Math.abs(dx), Math.abs(dy)) > 7) {
      gesture.horizontal = Math.abs(dx) > Math.abs(dy);
      if (gesture.horizontal) event.currentTarget.setPointerCapture(event.pointerId);
    }
    if (!gesture.horizontal) return;
    event.preventDefault();
    setDragX(dx);
  };

  const onMobilePointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    gestureRef.current = null;
    if (!gesture.horizontal) {
      setDragX(0);
      return;
    }
    const elapsed = Math.max(performance.now() - gesture.startedAt, 1);
    const velocity = dragX / elapsed;
    const threshold = event.currentTarget.clientWidth * 0.25;
    if (Math.abs(dragX) >= threshold || Math.abs(velocity) >= 0.55) {
      finishMobileClose(dragX >= 0 ? 1 : -1);
    } else {
      setDragX(0);
    }
  };

  const onResizePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    resizeRef.current = { startX: event.clientX, startWidth: constrainedDesktopWidth };
    resizeCloseArmedRef.current = false;
    setResizeCloseArmed(false);
  };

  const onResizePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const resize = resizeRef.current;
    if (!resize) return;
    const nextWidth = resize.startWidth + resize.startX - event.clientX;
    const shouldClose = nextWidth < MIN_DESKTOP_WIDTH;

    resizeCloseArmedRef.current = shouldClose;
    setResizeCloseArmed(shouldClose);

    setDesktopWidth(clamp(
      nextWidth,
      MIN_DESKTOP_WIDTH,
      maxDesktopWidth,
    ));
  };

  const onResizePointerEnd = () => {
    if (!resizeRef.current) return;
    resizeRef.current = null;
    const shouldClose = resizeCloseArmedRef.current;
    resizeCloseArmedRef.current = false;
    setResizeCloseArmed(false);

    if (shouldClose) {
      onClose();
      return;
    }

    window.localStorage.setItem(STORAGE_KEY, String(constrainedDesktopWidth));
  };

  const onResizePointerCancel = () => {
    resizeRef.current = null;
    resizeCloseArmedRef.current = false;
    setResizeCloseArmed(false);
  };

  if (!isMobile) {
    if (!open) return null;
    return (
      <aside
        ref={desktopPanelRef}
        className="relative z-20 h-full min-h-0 min-w-0 shrink-0 overflow-hidden bg-neutral-50"
        style={{
          width: constrainedDesktopWidth,
          minWidth: constrainedDesktopWidth,
          maxWidth: constrainedDesktopWidth,
          flexBasis: constrainedDesktopWidth,
        }}
      >
        <div
          aria-hidden="true"
          className={`pointer-events-none absolute inset-0 z-40 bg-neutral-300/50 transition-opacity duration-150 ${
            resizeCloseArmed ? "opacity-100" : "opacity-0"
          }`}
        />
        <div
          aria-label="Resize lemma sidebar"
          className="group absolute inset-y-0 left-0 z-50 w-3 -translate-x-1/2 cursor-col-resize touch-none"
          onPointerDown={onResizePointerDown}
          onPointerMove={onResizePointerMove}
          onPointerUp={onResizePointerEnd}
          onPointerCancel={onResizePointerCancel}
        >
          <div className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-neutral-200 transition-[width,background-color] group-hover:w-1 group-hover:bg-neutral-400" />
        </div>
        <div className="h-full min-h-0 min-w-0 w-full overflow-hidden">
          {children}
        </div>
      </aside>
    );
  }

  if (!mobileMounted || typeof document === "undefined") return null;
  const progress = Math.min(Math.abs(dragX) / Math.max(viewportWidth * 0.65, 1), 1);
  const entryY = mobileVisible ? 0 : Math.max(window.innerHeight * 0.6, 360);
  const translateY = dismissing ? 0 : entryY;
  const rotation = clamp(dragX / 28, -12, 12);
  const scale = 1 - progress * 0.08;
  const cardOpacity = 1 - progress * 0.62;
  const rightSwipeTintOpacity = dragX > 0 ? progress * 0.82 : 0;
  const swipeHintStyle = getMobileSwipeHintMotionStyle(viewportWidth);
  const cardTop = Math.round(window.innerHeight * 0.44);

  return createPortal(
    <div data-mobile-lemma-panel className="fixed inset-0 z-[1000] overflow-hidden" style={swipeHintStyle}>
      {showSwipeHint ? (
        <MobileSwipeHint
          checked={hideSwipeHintPermanently}
          visible={mobileVisible}
          onCheckedChange={setHideSwipeHintPermanently}
          onClose={dismissSwipeHint}
        />
      ) : (
        <button
          aria-label="Close lemma"
          className="absolute inset-0 h-full w-full bg-neutral-900 transition-opacity duration-200"
          style={{ opacity: (mobileVisible ? 0.28 : 0) * (1 - progress) }}
          onClick={() => finishMobileClose(0)}
        />
      )}

      <div
        className={`absolute left-1/2 top-auto w-[calc(100%-2rem)] max-w-lg touch-pan-y select-none transition-[transform,opacity] ${
          showSwipeHint ? "cursor-default" : ""
        } ${
          gestureRef.current?.horizontal ? "duration-0" : "duration-[220ms] ease-out"
        }`}
        style={{
          top: cardTop,
          opacity: cardOpacity,
          transform: `translate(-50%, -50%) translate(${dragX}px, ${translateY}px) rotate(${rotation}deg) scale(${scale})`,
        }}
        onPointerDown={onMobilePointerDown}
        onPointerMove={onMobilePointerMove}
        onPointerUp={onMobilePointerEnd}
        onPointerCancel={onMobilePointerEnd}
      >
        <MobileSwipeHintCard active={showSwipeHint} tintOpacity={rightSwipeTintOpacity}>
          {children}
        </MobileSwipeHintCard>
      </div>
    </div>,
    document.body,
  );
}
