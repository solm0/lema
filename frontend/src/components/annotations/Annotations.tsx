import { useEffect, useRef, useState } from "react";
import { Tags } from "lucide-react";
import { useInfiniteAnnotations } from "./useInfiniteAnnotations";
import AnnotationCard from "./AnnotationCard";
import type { TimelineItem } from "../../types";
import BlockingLoadingModal from "../util/BlockingLoadingModal";
import OfflineState from "../util/OfflineState";
import { useI18n } from "../../i18n";
import { CENTRAL_RESTORED_EVENT } from "../../network";
import { FilterSelect } from "../pages/PageFilters";

type AnnotationTypeFilter = Exclude<TimelineItem["type"], undefined>;

export default function Annotations() {
  const { t } = useI18n();
  const { items, setItems, load, hasMore, loading, offline } = useInfiniteAnnotations()
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const [selectedType, setSelectedType] = useState<AnnotationTypeFilter | null>(null);

  useEffect(() => {
    if (!sentinelRef.current || offline) return;

    const observer = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && hasMore && !loading && !offline) {
        void load();
      }
    });

    observer.observe(sentinelRef.current);

    return () => observer.disconnect();
  }, [hasMore, load, loading, offline]);

  useEffect(() => {
    if (items.length === 0 && !offline) {
      void load();
    }
  }, [items.length, load, offline]);

  useEffect(() => {
    if (!offline) return;

    const handleCentralRestored = () => {
      void load();
    };

    window.addEventListener(CENTRAL_RESTORED_EVENT, handleCentralRestored);
    return () => window.removeEventListener(CENTRAL_RESTORED_EVENT, handleCentralRestored);
  }, [load, offline]);

  const handleUpdate = (updated: TimelineItem) => {
    setItems((prev) => prev.map((item) => item.id === updated.id ? updated : item));
  };

  const handleDelete = (id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  };

  const filteredItems = selectedType
    ? items.filter((item) => item.type === selectedType)
    : items;

  return (
    <div className="flex flex-col gap-14 w-full h-full overflow-y-scroll px-3 md:px-6 bg-neutral-50">
      <div className="sticky top-0 z-30 flex flex-col gap-7 bg-neutral-50 pt-12">
        <h2>{t("Annotations")}</h2>
        <div className="flex min-w-0 items-center gap-0.5 overflow-hidden pl-0.5 text-xs">
          <FilterSelect
            icon={<Tags size={14} />}
            options={[
              { value: "memo", label: t("Memo") },
              { value: "link", label: t("Link") },
              { value: "emoji", label: t("Emoji") },
            ]}
            selectedValue={selectedType}
            title={t("Filter by annotation type")}
            onChange={(value) => setSelectedType(value as AnnotationTypeFilter | null)}
          />
        </div>
      </div>

      {offline && items.length > 0 ? (
        <p className="text-xs text-neutral-400">
          {t("You're offline. Check your connection and try again.")}
        </p>
      ) : null}

      {offline && items.length === 0 ? (
        <OfflineState onRetry={() => void load()} />
      ) : null}

      <div className="flex flex-col gap-3 pt-7 md:flex-row md:flex-wrap md:content-start">
        {filteredItems.map(item => (
          <AnnotationCard
            key={item.id}
            item={item}
            onUpdate={handleUpdate}
            onDelete={handleDelete}
            readonlySnapshotActions={false}
          />
        ))}

        {/* sentinel */}
        <div ref={sentinelRef} className="h-10 w-full" />

        <BlockingLoadingModal open={loading} message="Loading annotations..." />
        {!hasMore && <p className="text-center opacity-50 pb-18 text-sm">{t("End of the list")}</p>}
      </div>
    </div>
  );
}
