import { useEffect, useRef, useState } from "react";
import { getProgress, installPack } from "../../api";
import { ResponsiveModal } from "../util/ResponsiveModal";
import Button from "../util/Button";
import { useI18n } from "../../i18n";

const LANG_MAP: Record<string, string> = {
  ru: "Russian",
  de: "German",
  en: "English",
  ko: "Korean",
  ja: "Japanese",
  zh: "Chinese",
  fr: "French",
  es: "Spanish",
};

type Props = {
  lang: string;
  version: string;
  filename: string;
  downloadUrl: string;
  onClose: () => void;
  onInstalled: () => Promise<void> | void;
};

type InstallStatus =
  | "starting"
  | "downloading_pack"
  | "extracting_pack"
  | "installing_model"
  | "verifying_install"
  | "done"
  | "error";

type ProgressPayload = {
  progress?: number;
  status?: string;
  error?: string;
  detail?: string;
  bytes?: string;
  model_percent?: number;
  model_name?: string;
};

export default function PackModal({
  lang,
  version,
  filename,
  downloadUrl,
  onClose,
  onInstalled,
}: Props) {
  const { t } = useI18n();
  const [progress, setProgress] = useState(0);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState<InstallStatus>("starting");
  const [statusText, setStatusText] = useState("Preparing installation...");
  const [statusDetail, setStatusDetail] = useState("");
  const [modelPercent, setModelPercent] = useState<number | null>(null);

  const intervalRef = useRef<number | null>(null);
  const installedRef = useRef(false);

  const langName = t(LANG_MAP[lang] || lang);

  const stopPolling = () => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  };

  const handleClose = () => {
    stopPolling();
    onClose();
  };

  async function startInstall() {
    if (installedRef.current) return;
    installedRef.current = true;

    try {
      setError("");

      const res = await installPack({
        lang,
        version,
        filename,
        download_url: downloadUrl,
      });

      stopPolling();
      intervalRef.current = window.setInterval(async () => {
        try {
          const p = await getProgress(res.task_id) as ProgressPayload;

          const nextStatus = (p.status || "downloading_pack") as InstallStatus;
          setStatus(nextStatus);
          setProgress(Math.max(0, Math.min(1, p.progress || 0)));
          setStatusDetail(p.detail || "");
          setModelPercent(
            typeof p.model_percent === "number"
              ? Math.max(0, Math.min(100, p.model_percent))
              : null,
          );

          if (nextStatus === "downloading_pack") {
            setStatusText(t("Downloading language pack..."));
          } else if (nextStatus === "extracting_pack") {
            setStatusText(t("Extracting language pack..."));
          } else if (nextStatus === "installing_model") {
            const modelLabel = p.model_name || "analysis model";

            if (typeof p.model_percent === "number") {
              setStatusText(t("Installing {modelLabel}... {percent}%", {
                modelLabel,
                percent: p.model_percent,
              }));
            } else {
              setStatusText(t("Installing {modelLabel}...", { modelLabel }));
            }
          } else if (nextStatus === "verifying_install") {
            setStatusText(t("Finalizing installation..."));
          } else if (nextStatus === "done") {
            setStatusText(t("Installation complete."));
          } else if (nextStatus === "error") {
            setStatusText(t("Installation failed."));
          }

          if (nextStatus === "done") {
            stopPolling();
            setProgress(1);
            setDone(true);

            try {
              await onInstalled();
            } catch {
              setError(t("Installed, but failed to refresh the language list."));
            }
          }

          if (nextStatus === "error") {
            stopPolling();
            setError(t(p.error || "Installation failed."));
          }
        } catch {
          stopPolling();
          setStatus("error");
          setError(t("Failed to fetch install progress."));
        }
      }, 500);
    } catch {
      setStatus("error");
      setError(t("Failed to start installation."));
    }
  }

  useEffect(() => {
    startInstall();
    return () => stopPolling();
  }, []);

  const displayedPercent =
    status === "installing_model" && modelPercent !== null
      ? modelPercent
      : Math.round(progress * 100);

  return (
    <ResponsiveModal open={true} onClose={handleClose} closeOnBackdrop={false}>
      <div className="flex flex-col gap-7 min-w-[320px]">
        <div className="flex flex-col gap-7">
          <h2 className="pr-6">
            {langName} {version} {t("installing")}
          </h2>

          <p className="text-sm text-neutral-500">
            {t("Do not close this window until installation is complete.")}
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <div className="w-full h-3 rounded-full bg-neutral-200 overflow-hidden">
            {displayedPercent > 0 ? (
              <div
                className="h-full bg-black transition-all duration-300"
                style={{ width: `${displayedPercent}%` }}
              />
            ) : (
              <div className="h-full w-1/3 animate-pulse bg-neutral-500" />
            )}
          </div>

          <div className="text-sm text-neutral-500">
            {statusText}
          </div>

          {statusDetail ? (
            <div className="text-xs text-neutral-400 break-all">
              {statusDetail}
            </div>
          ) : null}

        </div>

        {done && (
          <div className="flex flex-col gap-4">
            <div className="text-sm text-green-600">{t("Installed successfully.")}</div>

            <Button
              onClick={handleClose}
              text={t("Close")}
              black
              fit
            />
          </div>
        )}

        {error && <div className="text-sm text-red-500">{error}</div>}
      </div>
    </ResponsiveModal>
  );
}
