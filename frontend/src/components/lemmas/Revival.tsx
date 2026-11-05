import { useCallback, useEffect, useState } from "react";
import { getLemmaRecap } from "../../api";
import { useI18n } from "../../i18n";
import type { RecapState } from "../pageTypes";
import { useSettings } from "../useSettings";
import { Recap } from "./Recap";

function RevivalBanner({ title, description, onClick, disabled = false }: {
  title: string;
  description: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag type={onClick ? "button" : undefined} onClick={onClick} disabled={onClick ? disabled : undefined}
      className={`flex h-60 w-full flex-col justify-between rounded-3xl bg-accent p-5 text-left ${onClick ? "cursor-pointer inset-shadow-[0_0_10px_#000] hover:inset-shadow-[0_0_20px_#000] inset-shadow-neutral-50 transition-all duration-300 disabled:cursor-wait disabled:opacity-50" : ""}`}>
      <div className="flex flex-col gap-3">
        <p className="max-w-[60ch] text-xl font-semibold font-body text-neutral-50 leading-tight">{title}</p>
        <p className="max-w-[60ch] font-medium font-body text-neutral-50/70 leading-tight">{description}</p>
      </div>
    </Tag>
  );
}

export default function Revival() {
  const { t } = useI18n();
  const { settings } = useSettings();
  const [recap, setRecap] = useState<RecapState | null>(null);
  const loadRecap = useCallback(() => {
    void getLemmaRecap(settings.recap_languages).then(setRecap).catch(() => setRecap(null));
  }, [settings.recap_languages]);

  useEffect(() => { loadRecap(); }, [loadRecap]);

  if (recap?.state === "completed") {
    return <RevivalBanner title={t("This week's Revival is complete.")} description={t("See you next week.")} />;
  }
  if (recap?.state === "daily_complete") {
    return <RevivalBanner title={t("Today's Revival is complete.")} description={t("Come back tomorrow for the next session.")} />;
  }
  if (recap?.state === "warming_up" || !recap?.available) {
    return <RevivalBanner title={t("Revival is not available yet.")} description={t("Check back after more lemmas have been collected.")} />;
  }
  return (
    <Recap onFinished={loadRecap} languages={settings.recap_languages}
      renderTrigger={({ start, loading }) => (
        <RevivalBanner
          title={t("We found lemmas ready to be revived.")}
          description={t("Use this session to revive them.")}
          onClick={start}
          disabled={loading}
        />
      )}
    />
  );
}
