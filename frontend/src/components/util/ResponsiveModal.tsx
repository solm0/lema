import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { IconButton } from "./Button";

type Props = {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  big?: boolean;
  dismissible?: boolean;
  closeOnBackdrop?: boolean;
  usePortal?: boolean;
  zIndex?: number;
};

export function ResponsiveModal({
  open,
  onClose,
  children,
  big = false,
  dismissible = true,
  closeOnBackdrop = true,
  usePortal = true,
  zIndex,
}: Props) {
  const [isMobile, setIsMobile] = useState(false);
  const [mounted, setMounted] = useState(open);
  const [translateY, setTranslateY] = useState(0);
  const [entered, setEntered] = useState(false);

  const startY = useRef(0);
  const dragging = useRef(false);

  // 디바이스 판별
  useEffect(() => {
    const check = () => {
      const coarse = window.matchMedia("(pointer: coarse)").matches;
      setIsMobile(coarse || window.innerWidth < 768);
    };
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  useEffect(() => {
    if (open) {
      setEntered(false); // 1단계: 아래 위치

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setEntered(true); // 2단계: 위로 이동 → transition 발생
        });
      });
    }
  }, [open]);

  useEffect(() => {
    if (open) setMounted(true);
    else {
      const t = setTimeout(() => setMounted(false), 200);
      return () => clearTimeout(t);
    }
  }, [open]);

  // ESC
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (dismissible && e.key === "Escape") onClose();
    }
    if (open) {
      document.addEventListener("keydown", onKey);
      setTranslateY(0);
    };
    return () => document.removeEventListener("keydown", onKey);
  }, [dismissible, onClose, open]);

  // body scroll lock
  useEffect(() => {
    if (open) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
  }, [open]);

  if (!mounted) return null;

  // touch handlers
  function onTouchStart(e: React.TouchEvent) {
    if (!dismissible) return;
    dragging.current = true;
    startY.current = e.touches[0].clientY;
  }

  function onTouchMove(e: React.TouchEvent) {
    if (!dragging.current) return;
    const current = e.touches[0].clientY;
    const diff = Math.max(0, current - startY.current);
    setTranslateY(diff);
  }

  function onTouchEnd() {
    dragging.current = false;
    if (translateY > 100) {
      setTranslateY(0);
      onClose();
    } else {
      setTranslateY(0);
    }
  }

  const overlayOpacity = isMobile
    ? Math.max(0, 0.4 - translateY / 400)
    : open
    ? 0.4
    : 0;

  const modalContent = (
    <div
      data-modal-open={open}
      className={`${usePortal ? "fixed" : "absolute"} inset-0 z-60 ${big && !isMobile && usePortal ? 'p-20' : ''}`}
      style={zIndex === undefined ? undefined : { zIndex }}
    >
      {/* overlay */}
      <div
        className="absolute inset-0 bg-neutral-700 transition-opacity duration-200"
        style={{ opacity: overlayOpacity }}
        onClick={dismissible && closeOnBackdrop ? onClose : undefined}
      />

      {/* content */}
      <div
        className={`
          bg-neutral-50 transition-all duration-200
          ${isMobile
            ? "absolute bottom-0 w-full rounded-t-2xl pt-2 pb-7"
            : big
              ? "absolute top-1/2 left-1/2 w-200 h-auto -translate-x-1/2 -translate-y-1/2 rounded-lg pt-7"
              : "absolute top-1/2 left-1/2 w-[400px] -translate-x-1/2 -translate-y-1/2 rounded-lg pt-7"
          }
        `}
        style={
          isMobile
            ? {
                transform: `translateY(${
                  open
                    ? (entered ? translateY : 400) // 핵심
                    : 400
                }px)`,
                transition: dragging.current
                  ? "none"
                  : "transform 200ms ease"
              }
            : {
                opacity: open ? 1 : 0,
              }
        }
        onClick={(e) => e.stopPropagation()}
        onTouchStart={isMobile && dismissible ? onTouchStart : undefined}
        onTouchMove={isMobile && dismissible ? onTouchMove : undefined}
        onTouchEnd={isMobile && dismissible ? onTouchEnd : undefined}
      >
        {/* handle (mobile) */}
        {isMobile && dismissible && (
          <div className="w-10 h-1 bg-neutral-200 rounded-full mx-auto mt-2 mb-7" />
        )}

        {/* header */}
        {dismissible && (
          <div className="absolute top-7 right-4 flex justify-end z-60">
            <IconButton icon={<X size={18} />} onClick={onClose} />
          </div>
        )}

        <div className="p-4 pt-0">{children}</div>
      </div>
    </div>
  );

  if (!usePortal) {
    return modalContent;
  }

  return createPortal(
    modalContent,
    document.body
  );
}
