import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { isCapacitorApp } from "../../platform";

type Props = {
  open: boolean;
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  progress?: { completed: number; total: number };
  className?: string;
  mobileViewport?: boolean;
  variant?: "default" | "success";
};

export default function LemmaActivityToast({
  open,
  title,
  description,
  icon,
  progress,
  className = "max-w-[25ch]",
  mobileViewport = false,
  variant = "default",
}: Props) {
  const [isMobile, setIsMobile] = useState(
    () => isCapacitorApp() || (typeof window !== "undefined" && window.innerWidth < 768),
  );

  useEffect(() => {
    const update = () => setIsMobile(isCapacitorApp() || window.innerWidth < 768);
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  if (!open) return null;

  const percent = progress && progress.total > 0
    ? Math.min(100, Math.max(0, (progress.completed / progress.total) * 100))
    : null;

  const tone = variant === "success"
    ? "border-green-200/70 bg-green-50 text-green-700"
    : "border-neutral-200/50 bg-neutral-50 text-neutral-600";
  const toast = (
    <div className={`pointer-events-none ${mobileViewport && isMobile ? "fixed z-[2147483647]" : "absolute z-40"} bottom-4 right-4 w-[min(22rem,calc(100%-2rem))] overflow-hidden rounded-lg border shadow-md ${tone} ${className}`}>
      <div className="flex gap-2 p-3 text-xs">
        {icon && <span className="shrink-0">{icon}</span>}
        <div className="min-w-0">
          <div className="font-medium">{title}</div>
          {description && <div className="mt-0.5 text-xs leading-5 text-neutral-400">{description}</div>}
        </div>
      </div>
      {percent !== null && (
        <div className="h-0.75 w-full bg-neutral-200">
          <div
            className="h-full bg-neutral-500 transition-[width] duration-300 ease-out"
            style={{ width: `${percent}%` }}
          />
        </div>
      )}
    </div>
  );

  if (mobileViewport && isMobile && typeof document !== "undefined") {
    return createPortal(toast, document.body);
  }

  return toast;
}
