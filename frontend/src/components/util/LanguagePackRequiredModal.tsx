import { useNavigate } from "react-router-dom";
import { useI18n } from "../../i18n";
import { LANG_MAP } from "../setting/PackTable";
import { ResponsiveModal } from "./ResponsiveModal";
import Button from "./Button";

export default function LanguagePackRequiredModal({
  language,
  open,
  onClose,
}: {
  language: string;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();

  const handleClose = () => {
    onClose();
  };

  const handleOpenSettings = () => {
    handleClose();
    navigate("/setting", { state: { scrollTo: "language-packs" } });
  };

  const handleGoBack = () => {
    handleClose();
    navigate("/");
  };

  return (
    <ResponsiveModal
      open={open}
      onClose={handleClose}
      dismissible={false}
      zIndex={1100}
    >
      <div className="flex w-full max-w-sm flex-col gap-7 rounded-sm bg-neutral-50">
        <h2 className="pr-6 pt-7 md:pt-0">
          {t("Install {language} pack to continue.", {
            language: t(LANG_MAP[language] ?? language),
          })}
        </h2>
        <div className="flex flex-col gap-3">
          <Button text={t("Settings")} onClick={handleOpenSettings} fit black />
          <button
            type="button"
            className="text-neutral-500 text-sm cursor-pointer"
            onClick={handleGoBack}
          >
            {t("Go back")}
          </button>
        </div>
      </div>
    </ResponsiveModal>
  );
}
