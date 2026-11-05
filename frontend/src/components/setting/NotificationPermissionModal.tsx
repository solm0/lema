import TextButton from "../util/Button";
import { ResponsiveModal } from "../util/ResponsiveModal";
import { useI18n } from "../../i18n";

type Props = {
  open: boolean;
  onClose: () => void;
  onOpenSettings: () => void;
  title?: string;
  body?: string;
};

export default function NotificationPermissionModal({
  open,
  onClose,
  onOpenSettings,
  title = "Allow notifications?",
  body = "To show now playing alerts on this device, allow notifications for Lema in Android settings.",
}: Props) {
  const { t } = useI18n();
  return (
    <ResponsiveModal open={open} onClose={onClose}>
      <div className="flex flex-col gap-7 md:pb-3">
        <h2>{t(title)}</h2>
        <p className="pr-8 text-sm text-neutral-500">
          {t(body)}
        </p>
        <TextButton
          text={t("Open notification settings")}
          onClick={onOpenSettings}
          fit
          black
        />
      </div>
    </ResponsiveModal>
  );
}
