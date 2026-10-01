import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Outlet, useLocation, useNavigate, useParams } from "react-router-dom";
import { Search, X } from "lucide-react";
import { Preferences } from "@capacitor/preferences";

import MoveModal from "./MoveModal";
import { useI18n } from "../../i18n";
import PageCard from "./PageCard";
import { PageFilters, type PageInputSource } from "./PageFilters";
import { Toolbar } from "./Toolbar";

import Button from "../util/Button";
import OfflineState from "../util/OfflineState";
import { GRADSHOW_MODE } from "../../gradshow/mode";
import { ResponsiveModal } from "../util/ResponsiveModal";
import { useLayout } from "../RootLayout";
import { isNetworkError } from "../../network";

import {
  fetchNotebooks,
  fetchPages,
  getPacks,
} from "../../api";
import { deleteLocalItem, moveLocalPages } from "../../localLibrary";
import { isCapacitorApp } from "../../platform";
import { readPackCatalogSnapshot } from "../../packCatalogSnapshot";

const PINNED_STORAGE_KEY = "pages.sidebar.pinned";
const LONG_PRESS_MS = 420;
const DRAG_CANCEL_DISTANCE = 10;
const ROOT_DROP_ID = "__root__";
const DRAG_SCROLL_EDGE_PX = 56;
const DRAG_SCROLL_MAX_STEP = 18;
const PAGE_BACK_SWIPE_START_PX = 28;
const PAGE_BACK_SWIPE_DISTANCE_PX = 80;
const MOBILE_PAGE_TRANSITION_MS = 280;

export type Page = {
  id: string;
  name: string;
  created_at: string;
  notebook_id?: string | null;
  language: string;
  source?: string;
  metadata?: string[];
};

export type Notebook = {
  id: string;
  name: string;
  created_at: string;
};

export type SelectedItem = {
  type: "page" | "notebook";
  id: string;
};

type DeleteTarget =
  | { type: "page"; item: Page }
  | { type: "notebook"; item: Notebook };

type DragGesture = {
  page: Page;
  pointerId: number;
  pointerType: string;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
  timerId: number;
};

type DragState = {
  page: Page;
  x: number;
  y: number;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
};

function sortByCreatedDesc<T extends { created_at: string }>(items: T[]) {
  return [...items].sort(
    (a, b) =>
      new Date(b.created_at).getTime() -
      new Date(a.created_at).getTime()
  );
}

function detectMobileLike() {
  if (typeof window === "undefined") return false;

  return window.matchMedia("(pointer: coarse)").matches || window.innerWidth < 768;
}

function parsePinnedIds(raw: string | null) {
  try {
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return Array.from(
      new Set(
        parsed.flatMap((value): string[] => {
          if (typeof value === "string" && value.length > 0) return [value];
          if (typeof value === "number" && Number.isFinite(value)) return [String(value)];
          return [];
        })
      )
    );
  } catch {
    return [];
  }
}

async function loadPinnedIds(mobileApp: boolean) {
  if (typeof window === "undefined") return [];

  if (mobileApp) {
    const { value } = await Preferences.get({ key: PINNED_STORAGE_KEY });
    if (value) return parsePinnedIds(value);
  }

  return parsePinnedIds(window.localStorage.getItem(PINNED_STORAGE_KEY));
}

async function savePinnedIds(pageIds: string[], mobileApp: boolean) {
  const value = JSON.stringify(pageIds);

  if (mobileApp) {
    await Preferences.set({ key: PINNED_STORAGE_KEY, value });
    return;
  }

  window.localStorage.setItem(PINNED_STORAGE_KEY, value);
}

export default function PageLayout() {
  const { t } = useI18n();
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const currentPageId = id ?? null;
  const mobileApp = isCapacitorApp();

  const { pageSidebarOpen, setPageSidebarOpen } = useLayout();

  const [pages, setPages] = useState<Page[]>([]);
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [expandedNotebookIds, setExpandedNotebookIds] = useState<Set<string>>(
    () => new Set()
  );
  const [pinnedPageIds, setPinnedPageIds] = useState<string[]>([]);
  const [pinnedStorageReady, setPinnedStorageReady] = useState(false);
  const [movePageIds, setMovePageIds] = useState<string[]>([]);
  const [movePageLabel, setMovePageLabel] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [dragTargetNotebookId, setDragTargetNotebookId] = useState<string | null>(
    null
  );
  const [dropFlashNotebookId, setDropFlashNotebookId] = useState<string | null>(
    null
  );
  const [openPopupId, setOpenPopupId] = useState<string | null>(null);
  const [isMobileLike, setIsMobileLike] = useState(detectMobileLike);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterLanguages, setFilterLanguages] = useState<string[]>([]);
  const [selectedLanguage, setSelectedLanguage] = useState<string | null>(null);
  const [selectedSource, setSelectedSource] = useState<PageInputSource | null>(null);
  const [mobilePageDragX, setMobilePageDragX] = useState(0);
  const [mobilePageDragging, setMobilePageDragging] = useState(false);
  const [mobilePageExiting, setMobilePageExiting] = useState(false);

  const initializedExpansionRef = useRef(false);
  const knownNotebookIdsRef = useRef<Set<string>>(new Set());
  const dragGestureRef = useRef<DragGesture | null>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const dragTargetNotebookIdRef = useRef<string | null>(null);
  const suppressClickPageIdRef = useRef<string | null>(null);
  const notebookTargetRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const rootDropRef = useRef<HTMLDivElement | null>(null);
  const sidebarScrollRef = useRef<HTMLDivElement | null>(null);
  const flashTimeoutRef = useRef<number | null>(null);
  const pageBackSwipeRef = useRef<{ startX: number; startY: number } | null>(null);
  const mobilePageBackTimerRef = useRef<number | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const hasLoadedOnceRef = useRef(false);
  const autoScrollFrameRef = useRef<number | null>(null);
  const autoScrollVelocityRef = useRef(0);

  const reload = async () => {
    if (!hasLoadedOnceRef.current) {
      setLoading(true);
    }

    try {
      setOffline(false);
      const [pagesData, notebooksData] = await Promise.all([
        fetchPages(),
        fetchNotebooks(),
      ]);

      setPages(pagesData);
      setNotebooks(notebooksData);
      setOffline(false);
      hasLoadedOnceRef.current = true;
    } catch (error) {
      setOffline(isNetworkError(error));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
  }, []);

  useEffect(() => {
    const handleLibraryChanged = () => {
      void reload();
      void loadPinnedIds(mobileApp).then(setPinnedPageIds);
    };
    window.addEventListener("lema:library-changed", handleLibraryChanged);
    return () => window.removeEventListener("lema:library-changed", handleLibraryChanged);
  }, [mobileApp]);

  useEffect(() => {
    let cancelled = false;

    const loadFilterLanguages = async () => {
      let packs: Array<{ lang?: string }>;

      try {
        packs = await getPacks();
      } catch {
        packs = readPackCatalogSnapshot() as Array<{ lang?: string }>;
      }

      if (cancelled) return;

      setFilterLanguages(
        Array.from(
          new Set(
            packs
              .map((pack) => pack.lang?.trim().toLowerCase())
              .filter((lang): lang is string => Boolean(lang))
          )
        ).sort((a, b) => a.localeCompare(b))
      );
    };

    void loadFilterLanguages();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const updateMobileState = () => {
      setIsMobileLike(detectMobileLike());
    };

    updateMobileState();
    window.addEventListener("resize", updateMobileState);
    return () => window.removeEventListener("resize", updateMobileState);
  }, []);

  useEffect(() => {
    if (!id) {
      setPageSidebarOpen(true);
    }
  }, [id, setPageSidebarOpen]);

  useEffect(() => {
    let cancelled = false;

    const hydratePinnedPages = async () => {
      try {
        const storedPageIds = await loadPinnedIds(mobileApp);
        if (!cancelled) setPinnedPageIds(storedPageIds);
      } catch (error) {
        console.warn("Could not load pinned pages from device storage.", error);
      } finally {
        if (!cancelled) setPinnedStorageReady(true);
      }
    };

    void hydratePinnedPages();
    return () => {
      cancelled = true;
    };
  }, [mobileApp]);

  useEffect(() => {
    if (!pinnedStorageReady) return;

    void savePinnedIds(pinnedPageIds, mobileApp).catch((error) => {
      console.warn("Could not save pinned pages to device storage.", error);
    });
  }, [mobileApp, pinnedPageIds, pinnedStorageReady]);

  useEffect(() => {
    setOpenPopupId(null);
  }, [pageSidebarOpen, currentPageId]);

  const pagesByNotebookId = useMemo(() => {
    const map = new Map<string | null, Page[]>();

    for (const page of pages) {
      const key = page.notebook_id ?? null;
      const list = map.get(key) ?? [];
      list.push(page);
      map.set(key, list);
    }

    for (const [key, list] of map.entries()) {
      map.set(key, sortByCreatedDesc(list));
    }

    return map;
  }, [pages]);

  const currentPage = useMemo(
    () => pages.find((page) => page.id === currentPageId) ?? null,
    [pages, currentPageId]
  );

  useEffect(() => {
    if (notebooks.length === 0) return;

    setExpandedNotebookIds((prev) => {
      const next = new Set(prev);

      if (!initializedExpansionRef.current) {
        for (const notebook of notebooks) {
          next.add(notebook.id);
          knownNotebookIdsRef.current.add(notebook.id);
        }
        initializedExpansionRef.current = true;
      } else {
        for (const notebook of notebooks) {
          if (!knownNotebookIdsRef.current.has(notebook.id)) {
            next.add(notebook.id);
            knownNotebookIdsRef.current.add(notebook.id);
          }
        }
      }

      if (currentPage?.notebook_id) next.add(currentPage.notebook_id);

      return next;
    });
  }, [currentPage, notebooks]);

  useEffect(() => {
    if (!hasLoadedOnceRef.current || !pinnedStorageReady) return;

    const validIds = new Set(pages.map((page) => page.id));
    setPinnedPageIds((prev) => prev.filter((pageId) => validIds.has(pageId)));
  }, [pages, pinnedStorageReady]);

  useEffect(() => {
    return () => {
      if (flashTimeoutRef.current) {
        window.clearTimeout(flashTimeoutRef.current);
      }
      if (autoScrollFrameRef.current) {
        window.cancelAnimationFrame(autoScrollFrameRef.current);
      }
      if (mobilePageBackTimerRef.current) {
        window.clearTimeout(mobilePageBackTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    dragStateRef.current = dragState;
  }, [dragState]);

  useEffect(() => {
    dragTargetNotebookIdRef.current = dragTargetNotebookId;
  }, [dragTargetNotebookId]);

  useEffect(() => {
    if (!isMobileLike || !dragState) return;

    const preventTouchScroll = (event: TouchEvent) => {
      event.preventDefault();
    };

    document.addEventListener("touchmove", preventTouchScroll, {
      passive: false,
    });

    return () => {
      document.removeEventListener("touchmove", preventTouchScroll);
    };
  }, [dragState, isMobileLike]);

  useEffect(() => {
    return () => {
      removeGlobalPointerListeners();
    };
  }, []);

  const pinnedPages = useMemo(() => {
    const pinned = pages.filter((page) => pinnedPageIds.includes(page.id));
    return sortByCreatedDesc(pinned);
  }, [pages, pinnedPageIds]);

  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const isSearching = normalizedSearchQuery.length > 0;
  const isFiltering = Boolean(selectedLanguage || selectedSource);
  const showFilteredResults = isSearching || isFiltering;

  const filteredItems = useMemo(() => {
    if (!showFilteredResults) return [];

    const matchingNotebooks = isFiltering
      ? []
      : notebooks
      .filter((notebook) =>
        notebook.name.toLowerCase().includes(normalizedSearchQuery)
      )
      .map((notebook) => ({
        key: `search-notebook-${notebook.id}`,
        item: { type: "notebook" as const, notebook },
      }));

    const matchingPages = pages
      .filter(
        (page) =>
          (!isSearching ||
            page.name.toLowerCase().includes(normalizedSearchQuery)) &&
          (!selectedLanguage ||
            page.language.toLowerCase() === selectedLanguage) &&
          (!selectedSource ||
            (page.source ?? "user").toLowerCase() === selectedSource)
      )
      .map((page) => ({
        key: `search-page-${page.id}`,
        item: { type: "page" as const, page },
      }));

    return [...matchingNotebooks, ...matchingPages].sort((a, b) => {
      const aDate =
        a.item.type === "page"
          ? a.item.page.created_at
          : a.item.notebook.created_at;
      const bDate =
        b.item.type === "page"
          ? b.item.page.created_at
          : b.item.notebook.created_at;

      return new Date(bDate).getTime() - new Date(aDate).getTime();
    });
  }, [
    isFiltering,
    isSearching,
    normalizedSearchQuery,
    notebooks,
    pages,
    selectedLanguage,
    selectedSource,
    showFilteredResults,
  ]);

  const rootPages = useMemo(
    () =>
      (pagesByNotebookId.get(null) ?? []).filter(
        (page) => !pinnedPageIds.includes(page.id)
      ),
    [pagesByNotebookId, pinnedPageIds]
  );

  const toggleNotebook = (notebookId: string) => {
    setExpandedNotebookIds((prev) => {
      const next = new Set(prev);
      if (next.has(notebookId)) {
        next.delete(notebookId);
      } else {
        next.add(notebookId);
      }
      return next;
    });
  };

  const consumeSuppressedClick = (pageId: string) => {
    if (suppressClickPageIdRef.current !== pageId) return false;

    suppressClickPageIdRef.current = null;
    return true;
  };

  const removeGlobalPointerListeners = () => {
    window.removeEventListener("pointermove", handleGlobalPointerMove);
    window.removeEventListener("pointerup", handleGlobalPointerUp);
    window.removeEventListener("pointercancel", handleGlobalPointerUp);
  };

  const clearDragGesture = () => {
    const gesture = dragGestureRef.current;

    if (gesture) {
      window.clearTimeout(gesture.timerId);
    }

    dragGestureRef.current = null;
  };

  const stopDragAutoScroll = () => {
    autoScrollVelocityRef.current = 0;
    if (autoScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(autoScrollFrameRef.current);
      autoScrollFrameRef.current = null;
    }
  };

  const runDragAutoScroll = () => {
    const container = sidebarScrollRef.current;
    const gesture = dragGestureRef.current;
    const velocity = autoScrollVelocityRef.current;

    if (!container || !gesture || velocity === 0) {
      autoScrollFrameRef.current = null;
      return;
    }

    const previousScrollTop = container.scrollTop;
    const maxScrollTop = container.scrollHeight - container.clientHeight;
    const nextScrollTop = Math.max(
      0,
      Math.min(maxScrollTop, previousScrollTop + velocity)
    );

    if (nextScrollTop !== previousScrollTop) {
      container.scrollTop = nextScrollTop;
      setDragTargetNotebookId(
        findNotebookDropTarget(gesture.lastX, gesture.lastY)
      );
    }

    if (
      nextScrollTop === previousScrollTop &&
      (nextScrollTop === 0 || nextScrollTop === maxScrollTop)
    ) {
      stopDragAutoScroll();
      autoScrollFrameRef.current = null;
      return;
    }

    autoScrollFrameRef.current = window.requestAnimationFrame(runDragAutoScroll);
  };

  const updateDragAutoScroll = (x: number, y: number) => {
    if (isMobileLike || !dragStateRef.current) {
      stopDragAutoScroll();
      return;
    }

    const container = sidebarScrollRef.current;
    if (!container) {
      stopDragAutoScroll();
      return;
    }

    const rect = container.getBoundingClientRect();
    const withinHorizontalBounds = x >= rect.left && x <= rect.right;
    const withinVerticalBounds = y >= rect.top && y <= rect.bottom;

    if (!withinHorizontalBounds || !withinVerticalBounds) {
      stopDragAutoScroll();
      return;
    }

    let velocity = 0;

    if (y <= rect.top + DRAG_SCROLL_EDGE_PX) {
      const intensity = 1 - (y - rect.top) / DRAG_SCROLL_EDGE_PX;
      velocity = -Math.max(1, Math.round(DRAG_SCROLL_MAX_STEP * intensity));
    } else if (y >= rect.bottom - DRAG_SCROLL_EDGE_PX) {
      const intensity = 1 - (rect.bottom - y) / DRAG_SCROLL_EDGE_PX;
      velocity = Math.max(1, Math.round(DRAG_SCROLL_MAX_STEP * intensity));
    }

    if (velocity === 0) {
      stopDragAutoScroll();
      return;
    }

    autoScrollVelocityRef.current = velocity;

    if (autoScrollFrameRef.current === null) {
      autoScrollFrameRef.current = window.requestAnimationFrame(runDragAutoScroll);
    }
  };

  const clearDrag = () => {
    clearDragGesture();
    stopDragAutoScroll();
    dragStateRef.current = null;
    dragTargetNotebookIdRef.current = null;
    setOpenPopupId(null);
    setDragState(null);
    setDragTargetNotebookId(null);
  };

  const flashNotebookDrop = (notebookId: string) => {
    setDropFlashNotebookId(notebookId);
    if (flashTimeoutRef.current) {
      window.clearTimeout(flashTimeoutRef.current);
    }
    flashTimeoutRef.current = window.setTimeout(() => {
      setDropFlashNotebookId(null);
    }, 360);
  };

  const movePagesToNotebook = async (
    pageIds: string[],
    notebookId: string | null
  ) => {
    await moveLocalPages(pageIds, notebookId);
    await reload();
  };

  const findNotebookDropTarget = (x: number, y: number) => {
    for (const [notebookId, element] of notebookTargetRefs.current.entries()) {
      const rect = element.getBoundingClientRect();
      if (
        x >= rect.left &&
        x <= rect.right &&
        y >= rect.top &&
        y <= rect.bottom
      ) {
        return notebookId;
      }
    }

    const rootElement = rootDropRef.current;
    if (rootElement) {
      const rect = rootElement.getBoundingClientRect();
      if (
        x >= rect.left &&
        x <= rect.right &&
        y >= rect.top &&
        y <= rect.bottom
      ) {
        return ROOT_DROP_ID;
      }
    }

    return null;
  };

  const startDragging = (gesture: DragGesture) => {
    window.clearTimeout(gesture.timerId);
    setDragState({
      page: gesture.page,
      x: gesture.lastX,
      y: gesture.lastY,
      offsetX: gesture.offsetX,
      offsetY: gesture.offsetY,
      width: gesture.width,
      height: gesture.height,
    });
    setDragTargetNotebookId(findNotebookDropTarget(gesture.lastX, gesture.lastY));
    updateDragAutoScroll(gesture.lastX, gesture.lastY);
  };

  const handleGlobalPointerMove = (event: PointerEvent) => {
    const gesture = dragGestureRef.current;
    if (!gesture || event.pointerId !== gesture.pointerId) return;

    gesture.lastX = event.clientX;
    gesture.lastY = event.clientY;

    const dx = Math.abs(event.clientX - gesture.startX);
    const dy = Math.abs(event.clientY - gesture.startY);
    const movedEnough = dx > DRAG_CANCEL_DISTANCE || dy > DRAG_CANCEL_DISTANCE;

    if (isMobileLike && gesture.pointerType === "touch") {
      if (movedEnough) {
        clearDragGesture();
        setDragTargetNotebookId(null);
        removeGlobalPointerListeners();
      }
      return;
    }

    if (!dragStateRef.current) {
      if (movedEnough) {
        startDragging(gesture);
      }
      return;
    }

    event.preventDefault();
    setDragState((prev) =>
      prev
        ? {
            ...prev,
            x: event.clientX,
            y: event.clientY,
          }
        : prev
    );
    setDragTargetNotebookId(findNotebookDropTarget(event.clientX, event.clientY));
    updateDragAutoScroll(event.clientX, event.clientY);
  };

  const handleGlobalPointerUp = async (event: PointerEvent) => {
    const gesture = dragGestureRef.current;
    if (!gesture || event.pointerId !== gesture.pointerId) return;

    removeGlobalPointerListeners();

    const pageId = gesture.page.id;
    const targetNotebookId = dragTargetNotebookIdRef.current;
    const sourceNotebookId = gesture.page.notebook_id ?? null;
    const wasDragging = Boolean(dragStateRef.current);

    clearDrag();

    if (!wasDragging) return;

    suppressClickPageIdRef.current = pageId;
    window.setTimeout(() => {
      if (suppressClickPageIdRef.current === pageId) {
        suppressClickPageIdRef.current = null;
      }
    }, 0);

    if (
      targetNotebookId === null ||
      (targetNotebookId === ROOT_DROP_ID && sourceNotebookId === null) ||
      (targetNotebookId !== ROOT_DROP_ID && targetNotebookId === sourceNotebookId)
    ) {
      return;
    }

    const nextNotebookId =
      targetNotebookId === ROOT_DROP_ID ? null : targetNotebookId;

    await movePagesToNotebook([pageId], nextNotebookId);

    if (nextNotebookId !== null) {
      setExpandedNotebookIds((prev) => {
        const next = new Set(prev);
        next.add(nextNotebookId);
        return next;
      });
      flashNotebookDrop(nextNotebookId);
    }
  };

  const handlePagePointerDown = (
    page: Page,
    event: React.PointerEvent<HTMLDivElement>
  ) => {
    if (event.button !== 0) return;

    const target = event.target as HTMLElement;
    if (target.closest("[data-no-drag='true']")) return;

    const rect = event.currentTarget.getBoundingClientRect();

    const timerId = window.setTimeout(() => {
      const gesture = dragGestureRef.current;
      if (!gesture) return;

      if (isMobileLike && gesture.pointerType === "touch") {
        suppressClickPageIdRef.current = page.id;
        window.setTimeout(() => {
          if (suppressClickPageIdRef.current === page.id) {
            suppressClickPageIdRef.current = null;
          }
        }, 280);
        removeGlobalPointerListeners();
        setOpenPopupId(`page-menu-${page.id}`);
        clearDragGesture();
        return;
      }

      startDragging(gesture);
    }, LONG_PRESS_MS);

    dragGestureRef.current = {
      page,
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      width: rect.width,
      height: rect.height,
      timerId,
    };

    window.addEventListener("pointermove", handleGlobalPointerMove, {
      passive: false,
    });
    window.addEventListener("pointerup", handleGlobalPointerUp);
    window.addEventListener("pointercancel", handleGlobalPointerUp);
  };

  const openMoveForPage = (page: Page) => {
    setOpenPopupId(null);
    setMovePageIds([page.id]);
    setMovePageLabel(page.name);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;

    await deleteLocalItem(deleteTarget.type, deleteTarget.item.id);

    setOpenPopupId(null);
    setDeleteTarget(null);
    await reload();
  };

  const togglePinnedPage = (page: Page) => {
    setPinnedPageIds((prev) =>
      prev.includes(page.id)
        ? prev.filter((idValue) => idValue !== page.id)
        : [page.id, ...prev]
    );
  };

  const registerNotebookTarget = (
    notebookId: string,
    element: HTMLDivElement | null
  ) => {
    if (!element) {
      notebookTargetRefs.current.delete(notebookId);
      return;
    }

    notebookTargetRefs.current.set(notebookId, element);
  };

  const handleOpenPage = () => {
    setOpenPopupId(null);
    if (isMobileLike) {
      setPageSidebarOpen(false);
    }
  };

  const startMobilePageExit = useCallback(() => {
    if (GRADSHOW_MODE) return;
    if (!isMobileLike || currentPageId === null || mobilePageExiting) return;

    setMobilePageDragging(false);
    setMobilePageDragX(0);
    setMobilePageExiting(true);

    if (mobilePageBackTimerRef.current) {
      window.clearTimeout(mobilePageBackTimerRef.current);
    }

    mobilePageBackTimerRef.current = window.setTimeout(() => {
      mobilePageBackTimerRef.current = null;
      navigate("/");
    }, MOBILE_PAGE_TRANSITION_MS);
  }, [currentPageId, isMobileLike, mobilePageExiting, navigate]);

  useEffect(() => {
    if (!isMobileLike || currentPageId === null) return;

    const handleMobilePageBack = () => startMobilePageExit();
    window.addEventListener("lema:mobile-page-back", handleMobilePageBack);

    return () => {
      window.removeEventListener("lema:mobile-page-back", handleMobilePageBack);
    };
  }, [currentPageId, isMobileLike, startMobilePageExit]);

  useEffect(() => {
    if (currentPageId !== null) return;

    setMobilePageDragX(0);
    setMobilePageDragging(false);
    setMobilePageExiting(false);
  }, [currentPageId]);

  const onPageTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    if (GRADSHOW_MODE) return;
    if (!isMobileLike || currentPageId === null || mobilePageExiting) return;

    const touch = event.touches[0];
    pageBackSwipeRef.current = touch.clientX <= PAGE_BACK_SWIPE_START_PX
      ? { startX: touch.clientX, startY: touch.clientY }
      : null;
  };

  const onPageTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
    const start = pageBackSwipeRef.current;
    if (!start) return;

    const touch = event.touches[0];
    const deltaX = Math.max(0, touch.clientX - start.startX);
    const deltaY = Math.abs(touch.clientY - start.startY);

    if (deltaX <= deltaY) return;

    setMobilePageDragging(true);
    setMobilePageDragX(deltaX);
  };

  const onPageTouchEnd = (event: React.TouchEvent<HTMLDivElement>) => {
    const start = pageBackSwipeRef.current;
    pageBackSwipeRef.current = null;
    if (!start) return;

    const touch = event.changedTouches[0];
    const deltaX = touch.clientX - start.startX;
    const deltaY = Math.abs(touch.clientY - start.startY);

    if (deltaX >= PAGE_BACK_SWIPE_DISTANCE_PX && deltaX > deltaY) {
      startMobilePageExit();
      return;
    }

    setMobilePageDragging(false);
    setMobilePageDragX(0);
  };

  const closeSearch = () => {
    setSearchQuery("");
    setSearchOpen(false);
  };

  useEffect(() => {
    if (searchOpen) {
      searchInputRef.current?.focus();
    }
  }, [searchOpen]);

  const searchControl = (
    <div className="flex min-w-0 flex-1 items-center gap-1">
      <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md bg-neutral-400/15 px-1.5 py-1.5 text-neutral-400">
        <Search size={14} className="shrink-0" aria-hidden="true" />
        <input
          ref={searchInputRef}
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder={t("Find...")}
          className="min-w-0 flex-1 bg-transparent text-xs text-neutral-700 placeholder:text-neutral-400 focus:outline-none"
          onKeyDown={(event) => {
            if (event.key === "Escape") closeSearch();
          }}
        />
      </div>
      <button
        type="button"
        onClick={closeSearch}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-neutral-500 transition-colors hover:bg-neutral-400/20 hover:text-neutral-800"
        title={t("Close")}
      >
        <X size={16} />
      </button>
    </div>
  );

  const sidebarListContent = loading && !hasLoadedOnceRef.current ? (
    <div className="flex flex-col gap-0.5 px-2 pt-2">
      <SkeletonItem />
      <SkeletonItem level={1} showActions={false} />
      <SkeletonItem level={1} />
      <SkeletonItem />
      <SkeletonItem level={1} showActions={false} />
      <SkeletonItem />
    </div>
  ) : offline && !hasLoadedOnceRef.current ? (
    <OfflineState onRetry={() => void reload()} />
  ) : (
    <div className="flex flex-col px-2 md:px-1 pb-14 pt-0">
      {showFilteredResults ? (
        filteredItems.length > 0 ? (
          filteredItems.map(({ key, item }) => (
            <PageCard
              key={key}
              item={item}
              level={0}
              currentPageId={currentPageId}
              expanded={item.type === "notebook" ? expandedNotebookIds.has(item.notebook.id) : false}
              reload={reload}
              isMobileLike={isMobileLike}
              isPinned={item.type === "page" && pinnedPageIds.includes(item.page.id)}
              dragActive={Boolean(dragState)}
              onToggleNotebook={
                item.type === "notebook"
                  ? () => toggleNotebook(item.notebook.id)
                  : undefined
              }
              onTogglePinned={
                item.type === "page"
                  ? () => togglePinnedPage(item.page)
                  : undefined
              }
              onMove={
                item.type === "page"
                  ? () => openMoveForPage(item.page)
                  : undefined
              }
              onDelete={() =>
                setDeleteTarget(
                  item.type === "page"
                    ? { type: "page", item: item.page }
                    : { type: "notebook", item: item.notebook }
                )
              }
              onPagePointerDown={
                item.type === "page"
                  ? (event) => handlePagePointerDown(item.page, event)
                  : undefined
              }
              onOpenPage={item.type === "page" ? handleOpenPage : undefined}
              consumeSuppressedClick={
                item.type === "page"
                  ? () => consumeSuppressedClick(item.page.id)
                  : undefined
              }
              dragging={item.type === "page" && dragState?.page.id === item.page.id}
              offline={offline}
              openPopupId={openPopupId}
              setOpenPopupId={setOpenPopupId}
            />
          ))
        ) : (
          <div className="px-2 py-3 text-sm opacity-60">
            {t("No matches found.")}
          </div>
        )
      ) : (
        <>
          {renderNotebooks()}

          {rootPages.map((page) => (
            <PageCard
              key={`root-page-${page.id}`}
              item={{ type: "page", page }}
              level={0}
              currentPageId={currentPageId}
              reload={reload}
              isMobileLike={isMobileLike}
              isPinned={pinnedPageIds.includes(page.id)}
              dragActive={Boolean(dragState)}
              onTogglePinned={() => togglePinnedPage(page)}
              onMove={() => openMoveForPage(page)}
              onDelete={() => setDeleteTarget({ type: "page", item: page })}
              onPagePointerDown={(event) => handlePagePointerDown(page, event)}
              onOpenPage={handleOpenPage}
              consumeSuppressedClick={() => consumeSuppressedClick(page.id)}
              dragging={dragState?.page.id === page.id}
              offline={offline}
              openPopupId={openPopupId}
              setOpenPopupId={setOpenPopupId}
            />
          ))}
        </>
      )}
    </div>
  );

  const sidebarContent = (
    <div className="flex h-full flex-col">
      {!isMobileLike || location.pathname === "/" ? <div className="w-full justify-between flex z-30 py-1 items-center h-8 pr-2 pl-1 md:pl-0">
        {searchOpen ? (
          searchControl
        ) : (
          <>
            <PageFilters
              languages={filterLanguages}
              selectedLanguage={selectedLanguage}
              selectedSource={selectedSource}
              mobileApp={mobileApp}
              onLanguageChange={setSelectedLanguage}
              onSourceChange={setSelectedSource}
            />
            <Toolbar
              reload={reload}
              onSearch={() => {
                setSelectedLanguage(null);
                setSelectedSource(null);
                setSearchOpen(true);
              }}
              disabled={mobileApp && offline}
            />
          </>
        )}
      </div> : null}

      {mobileApp && offline && hasLoadedOnceRef.current ? (
        <p className="px-2 pb-2 text-xs text-neutral-400">
          {t("You're offline. Check your connection and try again.")}
        </p>
      ) : null}

      {!showFilteredResults && pinnedPages.length > 0 ? (
        <div className="px-2 md:px-1 pt-2 pb-1 border-b border-neutral-400/70">
          <div className="flex flex-col">
            {pinnedPages.map((page) => (
              <PageCard
                key={`pinned-${page.id}`}
                item={{ type: "page", page }}
                level={0}
                currentPageId={currentPageId}
                reload={reload}
                isMobileLike={isMobileLike}
                isPinned
                dragActive={Boolean(dragState)}
                onTogglePinned={() => togglePinnedPage(page)}
                onMove={() => openMoveForPage(page)}
                onDelete={() => setDeleteTarget({ type: "page", item: page })}
                onPagePointerDown={(event) => handlePagePointerDown(page, event)}
                onOpenPage={handleOpenPage}
                consumeSuppressedClick={() => consumeSuppressedClick(page.id)}
                dragging={dragState?.page.id === page.id}
                offline={offline}
                openPopupId={openPopupId}
                setOpenPopupId={setOpenPopupId}
              />
            ))}
          </div>
        </div>
      ) : null}

      <div ref={sidebarScrollRef} className="min-h-0 flex-1 overflow-y-auto pt-2">
        {sidebarListContent}
      </div>
    </div>
  );

  function SkeletonItem({
    level = 0,
    showActions = true,
  }: {
    level?: number;
    showActions?: boolean;
  }) {
    return (
      <div
        className="flex min-h-9 items-center gap-2 rounded-md px-2 pr-2 animate-pulse opacity-30"
        style={{ paddingLeft: 8 + level * 14 }}
      >
        <div className="flex shrink-0 items-center gap-1 text-neutral-400">
          <div className="h-3 w-3 rounded bg-neutral-400" />
          <div className="h-3 w-3 rounded bg-neutral-400" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="h-3 w-28 rounded bg-neutral-400" />
        </div>
        {showActions ? (
          <div className="flex shrink-0 items-center gap-1">
            <div className="h-6 w-6 rounded bg-neutral-300" />
            <div className="h-6 w-6 rounded bg-neutral-300" />
          </div>
        ) : null}
      </div>
    );
  }

  function renderNotebooks(): React.ReactNode[] {
    const nodes: React.ReactNode[] = [];
    const sortedNotebooks = sortByCreatedDesc(notebooks);

    for (const notebook of sortedNotebooks) {
      const isExpanded = expandedNotebookIds.has(notebook.id);
      const childPages = (pagesByNotebookId.get(notebook.id) ?? []).filter(
        (page) => !pinnedPageIds.includes(page.id)
      );
      nodes.push(
        <div
          key={`notebook-tree-${notebook.id}`}
          ref={(element) => registerNotebookTarget(notebook.id, element)}
          className={`rounded-md transition-colors ${
            dragTargetNotebookId === notebook.id
              ? "bg-neutral-200/80 ring-1 ring-neutral-300"
              : dropFlashNotebookId === notebook.id
                ? "bg-neutral-200/70"
                : "bg-transparent"
          }`}
        >
          <PageCard
            item={{ type: "notebook", notebook }}
            level={0}
            currentPageId={currentPageId}
            expanded={isExpanded}
            reload={reload}
            isMobileLike={isMobileLike}
            dragActive={Boolean(dragState)}
            onToggleNotebook={() => toggleNotebook(notebook.id)}
            onDelete={() => setDeleteTarget({ type: "notebook", item: notebook })}
            isDragTarget={false}
            dropFlashed={false}
            offline={false}
            openPopupId={openPopupId}
            setOpenPopupId={setOpenPopupId}
          />

          {isExpanded ? (
            <>
              {childPages.map((page) => (
                <PageCard
                  key={`page-${page.id}`}
                  item={{ type: "page", page }}
                  level={1}
                  currentPageId={currentPageId}
                  reload={reload}
                  isMobileLike={isMobileLike}
                  isPinned={pinnedPageIds.includes(page.id)}
                  dragActive={Boolean(dragState)}
                  onTogglePinned={() => togglePinnedPage(page)}
                  onMove={() => openMoveForPage(page)}
                  onDelete={() => setDeleteTarget({ type: "page", item: page })}
                  onPagePointerDown={(event) => handlePagePointerDown(page, event)}
                  onOpenPage={handleOpenPage}
                  consumeSuppressedClick={() => consumeSuppressedClick(page.id)}
                  dragging={dragState?.page.id === page.id}
                  offline={false}
                  openPopupId={openPopupId}
                  setOpenPopupId={setOpenPopupId}
                />
              ))}
            </>
          ) : null}
        </div>
      );
    }

    return nodes;
  }

  return (
    <>
      <div className="relative flex w-full h-full overflow-hidden">
        {isMobileLike ? (
          <div
            ref={rootDropRef}
            className={`relative h-full w-full overflow-hidden pt-11 pb-14 transition-colors ${
              currentPageId !== null ? "pointer-events-none" : ""
            } ${
              dragTargetNotebookId === ROOT_DROP_ID
                ? "bg-neutral-200/55"
                : "bg-neutral-transparent"
            }`}
          >
            {sidebarContent}
          </div>
        ) : (
          <div
            ref={rootDropRef}
            className={`relative shrink-0 flex flex-col pt-11 transition-[width,color] duration-200 ${
              currentPageId === null || pageSidebarOpen
                ? "w-64 overflow-y-auto"
                : "w-0 overflow-hidden"
            } ${
              dragTargetNotebookId === ROOT_DROP_ID
                ? "bg-neutral-200/55"
                : "bg-neutral-transparent"
            }`}
          >
            {sidebarContent}
          </div>
        )}

        {!isMobileLike || currentPageId !== null ? (
          <div
            className={`${
              isMobileLike
                ? "absolute inset-0 z-10 h-full w-full"
                : "relative flex-1 h-full shrink-0"
            } bg-neutral-50 ${
              location.pathname === "/" && "bg-transparent"
            }`}
            style={isMobileLike ? {
              transform: mobilePageExiting
                ? "translateX(100%)"
                : `translateX(${mobilePageDragX}px)`,
              transition: mobilePageDragging
                ? "none"
                : `transform ${MOBILE_PAGE_TRANSITION_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`,
              boxShadow: mobilePageDragX > 0 || mobilePageExiting
                ? "-12px 0 28px rgb(0 0 0 / 0.12)"
                : "none",
            } : undefined}
            onTouchStart={onPageTouchStart}
            onTouchMove={onPageTouchMove}
            onTouchEnd={onPageTouchEnd}
            onTouchCancel={() => {
              pageBackSwipeRef.current = null;
              setMobilePageDragging(false);
              setMobilePageDragX(0);
            }}
          >
            <Outlet />
          </div>
        ) : null}
      </div>

      {dragState ? (
        <div
          className="pointer-events-none fixed z-[120] overflow-hidden rounded-md border border-neutral-300 bg-neutral-50/95 shadow-xl backdrop-blur-sm"
          style={{
            width: dragState.width,
            left: dragState.x - dragState.offsetX,
            top: dragState.y - dragState.offsetY,
          }}
        >
          <div className="flex h-9 items-center gap-2 px-3 text-sm text-neutral-700">
            <div className="h-2.5 w-2.5 rounded-full bg-neutral-300" />
            <span className="truncate">{dragState.page.name}</span>
            <span className="ml-auto text-xs text-neutral-400">
              {dragState.page.language}
            </span>
          </div>
        </div>
      ) : null}

      <MoveModal
        open={movePageIds.length > 0}
        onClose={() => {
          setMovePageIds([]);
          setMovePageLabel("");
        }}
        pageIds={movePageIds}
        pageLabel={movePageLabel}
        notebooks={notebooks}
        reload={reload}
      />

      <ResponsiveModal
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
      >
        <div className="flex flex-col gap-7">
          <h2>
            {t("Delete")}{" "}
            {deleteTarget?.type === "page" ? t("page") : t("notebook")}
            {deleteTarget ? ` "${deleteTarget.item.name}"` : ""}?
          </h2>

          {deleteTarget?.type === "notebook" ? (
            <p>{t("Deleting a notebook will also delete the pages inside it.")}</p>
          ) : null}

          <Button text={t("Delete")} onClick={handleDelete} fit red />
        </div>
      </ResponsiveModal>
    </>
  );
}
