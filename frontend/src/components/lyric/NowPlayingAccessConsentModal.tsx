import { ANDROID_PRIVACY_POLICY_URL } from "../../config";
import { useI18n } from "../../i18n";
import TextButton from "../util/Button";
import { ResponsiveModal } from "../util/ResponsiveModal";

type Props = {
  open: boolean;
  onClose: () => void;
  onAccept: () => void;
};

export default function NowPlayingAccessConsentModal({
  open,
  onClose,
  onAccept,
}: Props) {
  const { t } = useI18n();

  return (
    <ResponsiveModal open={open} onClose={onClose}>
      <div className="flex flex-col gap-6 md:pb-3">
        <div className="flex flex-col gap-3">
          <h2>{t("Find lyrics for the song playing now?")}</h2>
          <p className="pr-8 text-sm text-neutral-600">
            {t("Lema uses Android notification access only to read the current song and player. It sends the song title and artist to LRCLIB to find lyrics. You can keep using other features without allowing access.")}
          </p>
          <a
            href={ANDROID_PRIVACY_POLICY_URL}
            target="_blank"
            rel="noreferrer"
            className="w-fit text-xs text-neutral-500 underline underline-offset-2"
          >
            {t("Android app privacy policy")}
          </a>
        </div>
        <div className="flex flex-col gap-2">
          <TextButton
            text={t("Agree and open settings")}
            onClick={onAccept}
            fit
            black
          />
          <TextButton text={t("Not now")} onClick={onClose} fit />
        </div>
      </div>
    </ResponsiveModal>
  );
}
