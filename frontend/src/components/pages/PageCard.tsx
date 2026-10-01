import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Ellipsis,
  Folder,
  Pencil,
  Pin,
  Plus,
  Trash2,
} from "lucide-react";

import type { Notebook, Page } from "./PageLayout";
import { MiniPopup } from "../util/MiniPopup";
import { IconButtonEvent } from "../util/Button";
import { useI18n } from "../../i18n";
import { renameLocalItem } from "../../localLibrary";
import { GRADSHOW_MODE, GRADSHOW_PAGE_ID } from "../../gradshow/mode";

const LONG_PRESS_MS = 420;
const MOVE_CANCEL_DISTANCE = 10;

type PageCardItem =
  | { type: "page"; page: Page }
  | { type: "notebook"; notebook: Notebook };

function ActionButton({
  icon,
  label,
  onClick,
  danger = false,
  disabled = false,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      data-no-drag="true"
      onClick={(event) => {
        event.stopPropagation();
        if (disabled) return;
        onClick();
      }}
      disabled={disabled}
      className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors ${
        disabled
          ? "text-neutral-500 opacity-50"
          : danger
          ? "text-red-600 hover:bg-red-50"
          : "text-neutral-700 hover:bg-neutral-100"
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

export default function PageCard({
  item,
  level,
  currentPageId,
  expanded = false,
  reload,
  isMobileLike,
  isPinned = false,
  dragging = false,
  dragActive = false,
  isDragTarget = false,
  dropFlashed = false,
  onToggleNotebook,
  onTogglePinned,
  onMove,
  onDelete,
  onPagePointerDown,
  onOpenPage,
  consumeSuppressedClick,
  registerNotebookTarget,
  openPopupId,
  setOpenPopupId,
  offline,
}: {
  item: PageCardItem;
  level: number;
  currentPageId: string | null;
  expanded?: boolean;
  reload: () => Promise<void>;
  isMobileLike: boolean;
  isPinned?: boolean;
  dragging?: boolean;
  dragActive?: boolean;
  isDragTarget?: boolean;
  dropFlashed?: boolean;
  onToggleNotebook?: () => void;
  onTogglePinned?: () => void;
  onMove?: () => void;
  onDelete: () => void;
  onPagePointerDown?: (event: React.PointerEvent<HTMLDivElement>) => void;
  onOpenPage?: () => void;
  consumeSuppressedClick?: () => boolean;
  registerNotebookTarget?: (element: HTMLDivElement | null) => void;
  openPopupId: string | null;
  setOpenPopupId: React.Dispatch<React.SetStateAction<string | null>>;
  offline: boolean;
}) {
  const navigate = useNavigate();
  const { t } = useI18n();

  const [hovered, setHovered] = useState(false);
  const [editing, setEditing] = useState(false);
  const longPressTimerRef = useRef<number | null>(null);
  const longPressPointerIdRef = useRef<number | null>(null);
  const longPressStartRef = useRef<{ x: number; y: number } | null>(null);
  const suppressNotebookClickRef = useRef(false);
  const [value, setValue] = useState(
    item.type === "page" ? item.page.name : item.notebook.name
  );
  const page = item.type === "page" ? item.page : null;
  const notebook = item.type === "notebook" ? item.notebook : null;
  const menuPopupId = `${item.type}-menu-${item.type === "page" ? item.page.id : item.notebook.id}`;
  const menuOpen = openPopupId === menuPopupId;

  const isActivePage = page?.id === currentPageId;
  const disableServerActions = false;

  const leftPadding = 4 + level * 19;

  const trailingVisible =
    editing || (!isMobileLike && (hovered || menuOpen));
  const showMenuButton = !editing && !isMobileLike;

  const handleRename = async () => {
    const nextName = value.trim();
    if (!nextName) return;

    await renameLocalItem(item.type, item.type === "page" ? item.page.id : item.notebook.id, nextName);

    setEditing(false);
    setOpenPopupId(null);
    await reload();
  };

  const removeNotebookLongPressListeners = () => {
    window.removeEventListener("pointermove", handleNotebookLongPressMove);
    window.removeEventListener("pointerup", handleNotebookLongPressEnd);
    window.removeEventListener("pointercancel", handleNotebookLongPressEnd);
  };

  const clearNotebookLongPress = () => {
    if (longPressTimerRef.current) {
      window.clearTimeout(longPressTimerRef.current);
    }
    longPressTimerRef.current = null;
    longPressPointerIdRef.current = null;
    longPressStartRef.current = null;
  };

  useEffect(
    () => () => {
      clearNotebookLongPress();
      removeNotebookLongPressListeners();
    },
    []
  );

  const handleNotebookLongPressMove = (event: PointerEvent) => {
    if (
      longPressPointerIdRef.current !== event.pointerId ||
      !longPressStartRef.current
    ) {
      return;
    }

    const dx = Math.abs(event.clientX - longPressStartRef.current.x);
    const dy = Math.abs(event.clientY - longPressStartRef.current.y);

    if (dx > MOVE_CANCEL_DISTANCE || dy > MOVE_CANCEL_DISTANCE) {
      clearNotebookLongPress();
      removeNotebookLongPressListeners();
    }
  };

  const handleNotebookLongPressEnd = (event: PointerEvent) => {
    if (longPressPointerIdRef.current !== event.pointerId) return;

    clearNotebookLongPress();
    removeNotebookLongPressListeners();
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (page && onPagePointerDown) {
      onPagePointerDown(event);
      return;
    }

    if (!notebook || !isMobileLike || editing || event.button !== 0) return;
    if (disableServerActions) return;

    const target = event.target as HTMLElement;
    if (target.closest("[data-no-drag='true']")) return;

    longPressPointerIdRef.current = event.pointerId;
    longPressStartRef.current = { x: event.clientX, y: event.clientY };
    longPressTimerRef.current = window.setTimeout(() => {
      suppressNotebookClickRef.current = true;
      setOpenPopupId(menuPopupId);
      clearNotebookLongPress();
      removeNotebookLongPressListeners();
    }, LONG_PRESS_MS);

    window.addEventListener("pointermove", handleNotebookLongPressMove);
    window.addEventListener("pointerup", handleNotebookLongPressEnd);
    window.addEventListener("pointercancel", handleNotebookLongPressEnd);
  };

  const handleClick = () => {
    if (item.type === "page") {
      if (consumeSuppressedClick?.()) {
        return;
      }

      navigate(`/page/${item.page.id}`);
      onOpenPage?.();
      return;
    }

    if (suppressNotebookClickRef.current) {
      suppressNotebookClickRef.current = false;
      return;
    }

    onToggleNotebook?.();
  };

  const menuContent = (
    <>
      {notebook ? (
        <ActionButton
          icon={<Plus size={13} />}
          label={t("Create page")}
          disabled={false}
          onClick={() => {
            navigate("/new?mode=paste", { state: { notebookId: notebook.id } });
            setOpenPopupId(null);
          }}
        />
      ) : null}

      <ActionButton
        icon={<Pencil size={13} />}
        label={t("Rename")}
        disabled={disableServerActions}
        onClick={() => {
          setEditing(true);
          setOpenPopupId(null);
        }}
      />

      {page && onMove ? (
        <ActionButton
          icon={<Folder size={13} />}
          label={t("Move")}
          disabled={false}
          onClick={() => {
            onMove();
            setOpenPopupId(null);
          }}
        />
      ) : null}

      {page && onTogglePinned ? (
        <ActionButton
          icon={<Pin size={13} fill={isPinned ? "currentColor" : "transparent"} />}
          label={isPinned ? t("Unpin") : t("Pin")}
          disabled={offline}
          onClick={() => {
            onTogglePinned();
            setOpenPopupId(null);
          }}
        />
      ) : null}

      <ActionButton
        icon={<Trash2 size={13} />}
        label={t("Delete")}
        danger
        disabled={disableServerActions || (GRADSHOW_MODE && page?.id === GRADSHOW_PAGE_ID)}
        onClick={() => {
          onDelete();
          setOpenPopupId(null);
        }}
      />
    </>
  );

  return (
    <div
      ref={registerNotebookTarget}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        setHovered(false);
      }}
      onPointerDown={handlePointerDown}
      onClick={handleClick}
      className={`group relative min-h-10 md:min-h-8 flex items-center cursor-pointer rounded-md transition-all active:bg-neutral-400/10 ${
        dragging
          ? "bg-neutral-200/90"
          : isDragTarget
            ? "bg-neutral-200/80 ring-1 ring-neutral-300"
            : dropFlashed
              ? "bg-neutral-200/70"
              : isActivePage
                ? "bg-neutral-400/20"
                : hovered && !dragActive
                  ? "bg-neutral-400/10"
                  : "bg-transparent"
      }`}
      style={{
        paddingLeft: leftPadding,
      }}
    >
      <div className="flex w-full min-h-8 items-center gap-1.5 pr-2">
        {notebook &&
          <div className="flex shrink-0 items-center gap-1 text-neutral-500">
            {expanded ? (
              <ChevronDown size={13} className="opacity-65" />
            ) : (
              <ChevronRight size={13} className="opacity-65" />
            )}
          </div>
        }

        <div className="min-w-0 flex-1">
          {editing ? (
            <input
              data-no-drag="true"
              className="w-full rounded-md border border-neutral-300 bg-neutral-50 px-2 py-1 text-sm focus:outline-none"
              value={value}
              onClick={(event) => event.stopPropagation()}
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  void handleRename();
                }
                if (event.key === "Escape") {
                  setEditing(false);
                  setValue(item.type === "page" ? item.page.name : item.notebook.name);
                }
              }}
              autoFocus
            />
          ) : (
            <div className="flex min-w-0 items-center gap-2">
              <p className="truncate text-sm text-neutral-800 select-none">
                {item.type === "page" ? item.page.name : item.notebook.name}
              </p>
              {page ? (
                <span className="shrink-0 text-[11px] text-neutral-400 select-none">
                  {page.language}
                </span>
              ) : null}
            </div>
          )}
        </div>

        <div className={`relative flex shrink-0 items-center gap-1 transition-opacity ml-auto ${trailingVisible ? "opacity-100" : "opacity-0"}`}>
          {editing ? (
            <IconButtonEvent
              icon={<Check size={13} />}
              onClick={(event) => {
                event.stopPropagation();
                void handleRename();
              }}
              title={t("Save")}
            />
          ) : null}

          {showMenuButton ? (
            <div className="relative">
              <IconButtonEvent
                icon={<Ellipsis size={14} />}
                onClick={(event) => {
                  event.stopPropagation();
                  if (disableServerActions) return;
                  setOpenPopupId((current) =>
                    current === menuPopupId ? null : menuPopupId
                  );
                }}
                title={t("more")}
                disabled={disableServerActions}
              />
              <MiniPopup open={menuOpen} onClose={() => setOpenPopupId(null)}>
                {menuContent}
              </MiniPopup>
            </div>
          ) : null}
        </div>

        {isMobileLike && !editing ? (
          <div className="absolute right-2 shrink-0">
            <MiniPopup open={menuOpen} onClose={() => setOpenPopupId(null)}>
              {menuContent}
            </MiniPopup>
          </div>
        ) : null}
      </div>
    </div>
  );
}
