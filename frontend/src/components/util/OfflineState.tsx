import { GlobeX } from "lucide-react";
import TextButton from "./Button";
import { useI18n } from "../../i18n";

export default function OfflineState({
  message,
  detail,
  onRetry,
}: {
  message?: string;
  detail?: string;
  onRetry: () => void;
}) {
  const { t } = useI18n();

  return (
    <div className="flex h-full w-full items-center justify-center px-6">
      <div className="flex flex-col gap-7 text-center text-neutral-400">
        <div className="flex flex-col items-center gap-2">
          <GlobeX size={28} />
          <p className="text-sm">
            {message ?? t("You're offline. Check your connection and try again.")}
          </p>
          {detail ? <p className="text-sm">{detail}</p> : null}
        </div>

        <div className="flex justify-center">
          <TextButton text={t("Try again")} onClick={onRetry} fit />
        </div>
      </div>
    </div>
  );
}
