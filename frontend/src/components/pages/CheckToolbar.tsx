import { Trash2, X } from "lucide-react";
import { IconButton } from "../util/Button";
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
    <div className="flex h-6 select-none gap-1">
      <IconButton icon={<X size={14} />} onClick={clear} title={t("Clear selection")} />
      <IconButton icon={<Trash2 className="text-red-600" size={14} />} onClick={onDelete}/>
    </div>
  );
}
