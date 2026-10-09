import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { PartyPopper } from "lucide-react";
import { isCapacitorApp } from "../../platform";
import { useI18n } from "../../i18n";
import { Toast, ToastProvider, ToastTitle, ToastViewport } from "../ui/toast";
import "./KnownWordsMilestoneToast.css";

export type KnownWordsMilestone = {
  count: number;
  language: string;
};

const LANGUAGE_NAMES: Record<string, string> = {
  ru: "Russian",
  de: "German",
  en: "English",
  ko: "Korean",
  ja: "Japanese",
  zh: "Chinese",
  fr: "French",
  es: "Spanish",
};

export default function KnownWordsMilestoneToast({
  milestone,
  onClose,
}: {
  milestone: KnownWordsMilestone | null;
  onClose: () => void;
}) {
  const { locale, t } = useI18n();
  const [isMobile, setIsMobile] = useState(
    () => isCapacitorApp() || (typeof window !== "undefined" && window.innerWidth < 768),
  );

  useEffect(() => {
    const update = () => setIsMobile(isCapacitorApp() || window.innerWidth < 768);
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  const viewport = (
    <ToastViewport className={isMobile
      ? "fixed inset-x-0 top-[calc(env(safe-area-inset-top)+0.75rem)] z-[2147483647] w-full p-3"
      : "absolute inset-x-0 top-0 z-[2147483647] mx-auto w-full max-w-md p-3"
    } />
  );

  if (!milestone) return null;

  return (
    <ToastProvider duration={4000} swipeDirection="up">
      <Toast
        open
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
        duration={4000}
        className="milestone-toast-root border-neutral-200 bg-white/95 text-neutral-800 backdrop-blur-md"
      >
        <ToastTitle className="flex items-center gap-2 text-sm">
          <PartyPopper className="h-5 w-5 shrink-0 text-fuchsia-500" />
          <span>
            {t("You marked {count} {language} words as known!", {
              count: new Intl.NumberFormat(locale).format(milestone.count),
              language: t(LANGUAGE_NAMES[milestone.language] ?? milestone.language),
            })}
          </span>
        </ToastTitle>
      </Toast>
      {isMobile && typeof document !== "undefined" ? createPortal(viewport, document.body) : viewport}
    </ToastProvider>
  );
}
