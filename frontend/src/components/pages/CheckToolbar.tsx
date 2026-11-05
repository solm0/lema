import { Trash2, X } from "lucide-react";
import { IconButtonEvent } from "../util/Button";
import { useI18n } from "../../i18n";

export default function CheckToolbar({
  clear,
  onDelete
}: {
  clear: () => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="flex h-10 md:h-8 select-none gap-2 md:gap-0">
      <IconButtonEvent icon={<X size={14} />} onClick={clear} title={t("Clear selection")} />
      <IconButtonEvent icon={<Trash2 size={14} />} onClick={onDelete} red/>
    </div>
  );
}
