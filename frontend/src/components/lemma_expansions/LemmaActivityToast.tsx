import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
  type ReactNode,
} from "react";
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

type ActivityToastContextValue = {
  isMobile: boolean;
  register: (id: string, toast: ReactNode) => () => void;
};

const ActivityToastContext = createContext<ActivityToastContextValue | null>(null);

export function LemmaActivityToastProvider({ children }: { children: ReactNode }) {
  const [isMobile, setIsMobile] = useState(
    () => isCapacitorApp() || (typeof window !== "undefined" && window.innerWidth < 768),
  );
  const [toasts, setToasts] = useState<Array<{ id: string; toast: ReactNode }>>([]);

  useEffect(() => {
    const update = () => setIsMobile(isCapacitorApp() || window.innerWidth < 768);
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  const register = useCallback((id: string, toast: ReactNode) => {
    setToasts((current) => [...current.filter((item) => item.id !== id), { id, toast }]);
    return () => setToasts((current) => current.filter((item) => item.id !== id));
  }, []);
  const value = useMemo(() => ({ isMobile, register }), [isMobile, register]);
  const viewport = isMobile && typeof document !== "undefined"
    ? createPortal(
      <div className="pointer-events-none fixed bottom-4 right-4 z-[2147483647] flex w-[min(22rem,calc(100%-2rem))] flex-col-reverse gap-2">
        {toasts.map((item) => <div key={item.id}>{item.toast}</div>)}
      </div>,
      document.body,
    )
    : null;

  return (
    <ActivityToastContext.Provider value={value}>
      {children}
      {viewport}
    </ActivityToastContext.Provider>
  );
}

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
  const activityToastContext = useContext(ActivityToastContext);
  const id = useId();
  const [isMobile, setIsMobile] = useState(
    () => isCapacitorApp() || (typeof window !== "undefined" && window.innerWidth < 768),
  );

  useEffect(() => {
    const update = () => setIsMobile(isCapacitorApp() || window.innerWidth < 768);
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  const percent = progress && progress.total > 0
    ? Math.min(100, Math.max(0, (progress.completed / progress.total) * 100))
    : null;

  const tone = variant === "success"
    ? "border-green-200/70 bg-green-50 text-green-700"
    : "border-neutral-200/50 bg-neutral-50 text-neutral-600";
  const useSharedMobileViewport = activityToastContext?.isMobile ?? false;
  const toast = useMemo(() => (
    <div className={`pointer-events-none w-full overflow-hidden rounded-lg border shadow-md ${tone} ${className}`}>
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
  ), [className, description, icon, percent, title, tone]);

  useEffect(() => {
    if (!open || !useSharedMobileViewport || !activityToastContext) return;
    return activityToastContext.register(id, toast);
  }, [activityToastContext, id, open, toast, useSharedMobileViewport]);

  if (!open) return null;
  if (useSharedMobileViewport) return null;

  const positionedToast = (
    <div className={`${mobileViewport && isMobile ? "fixed z-[2147483647]" : "absolute z-40"} bottom-4 right-4 w-[min(22rem,calc(100%-2rem))] ${className}`}>
      {toast}
    </div>
  );

  if (mobileViewport && isMobile && typeof document !== "undefined") {
    return createPortal(positionedToast, document.body);
  }

  return positionedToast;
}
