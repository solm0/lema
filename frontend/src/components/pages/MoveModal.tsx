import { useMemo, useState } from "react";

import type { Notebook } from "./PageLayout";
import { ResponsiveModal } from "../util/ResponsiveModal";
import TextButton from "../util/Button";
import { moveLocalPages } from "../../localLibrary";
import { useI18n } from "../../i18n";

function buildNotebookOptions(
  notebooks: Notebook[],
): Array<{ id: string; name: string }> {
  return notebooks
    .sort(
      (a, b) =>
        new Date(b.created_at).getTime() -
        new Date(a.created_at).getTime()
    )
    .map((notebook) => ({ id: notebook.id, name: notebook.name }));
}

export default function MoveModal({
  open,
  onClose,
  pageIds,
  pageLabel,
  notebooks,
  reload,
}: {
  open: boolean;
  onClose: () => void;
  pageIds: string[];
  pageLabel?: string;
  notebooks: Notebook[];
  reload: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [selectedNotebook, setSelectedNotebook] = useState<string | null>(null);

  const notebookOptions = useMemo(
    () => buildNotebookOptions(notebooks),
    [notebooks]
  );

  if (pageIds.length === 0) return null;

  const movePages = async (notebookId: string | null) => {
    await moveLocalPages(pageIds, notebookId);

    setSelectedNotebook(null);
    onClose();
    await reload();
  };

  return (
    <ResponsiveModal open={open} onClose={onClose}>
      <div className="flex flex-col gap-7">
        <h2>
          {pageIds.length > 1
            ? t("Move {count} pages", { count: pageIds.length })
            : t("Move page \"{name}\"", { name: pageLabel ?? "" })}
        </h2>

        <select
          value={selectedNotebook ?? ""}
          onChange={(event) =>
            setSelectedNotebook(
              event.target.value || null
            )
          }
          className="border-2 border-neutral-300 rounded-sm px-3 py-2 focus:outline-none opacity-50 focus:opacity-100"
        >
          <option value="">{t("root")}</option>
          {notebookOptions.map((notebook) => (
            <option key={notebook.id} value={notebook.id}>
              {notebook.name}
            </option>
          ))}
        </select>

        <TextButton
          text={t("Move")}
          onClick={() => movePages(selectedNotebook)}
          disabled={false}
          fit
          black
        />
      </div>
    </ResponsiveModal>
  );
}
