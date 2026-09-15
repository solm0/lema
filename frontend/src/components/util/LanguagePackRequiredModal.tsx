import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { isCapacitorApp } from "../../platform";
import { enableMobileLanguage } from "../../mobilePacks";
import { useI18n } from "../../i18n";
import { LANG_MAP } from "../setting/PackTable";
import { invalidateInstalledLanguagesCache } from "./LanguageSelect";
import { ResponsiveModal } from "./ResponsiveModal";
import Button from "./Button";

export default function LanguagePackRequiredModal({
  language,
  open,
  onClose,
  onActivated,
}: {
  language: string;
  open: boolean;
  onClose: () => void;
  onActivated?: () => void | Promise<void>;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const mobileApp = isCapacitorApp();
  const [activationStatus, setActivationStatus] = useState<
    "idle" | "activating" | "activated" | "error"
  >("idle");

  const handleClose = () => {
    setActivationStatus("idle");
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

  const handleActivate = async () => {
    if (!language || activationStatus === "activating" || activationStatus === "activated") {
      return;
    }

    setActivationStatus("activating");

    try {
      await enableMobileLanguage(language);
      invalidateInstalledLanguagesCache();
      setActivationStatus("activated");
      try {
        await onActivated?.();
      } catch (error) {
        console.error("[language-pack] post-activation refresh failed:", error);
      }
      handleClose();
    } catch {
      setActivationStatus("error");
    }
  };

  const buttonText = activationStatus === "activating"
    ? t("Activating...")
    : activationStatus === "activated"
      ? t("Activated")
      : t("Activate");

  return (
    <ResponsiveModal
      open={open}
      onClose={handleClose}
      dismissible={false}
      zIndex={1100}
    >
      <div className="flex w-full max-w-sm flex-col gap-7 rounded-sm bg-neutral-50">
        <h2 className="pr-6 pt-7 md:pt-0">
          {mobileApp
            ? t("Activate {language}?", {
                language: t(LANG_MAP[language] ?? language),
              })
            : t("Install {language} pack to continue.", {
                language: t(LANG_MAP[language] ?? language),
              })}
        </h2>
        {activationStatus === "error" ? (
          <p className="text-sm text-red-600">{t("Failed to activate language.")}</p>
        ) : null}
        <div className="flex flex-col gap-3">
          {mobileApp ? (
            <Button
              text={buttonText}
              onClick={() => void handleActivate()}
              disabled={activationStatus === "activating" || activationStatus === "activated"}
              fit
              black
            />
          ) : (
            <Button text={t("Settings")} onClick={handleOpenSettings} fit black />
          )}
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
