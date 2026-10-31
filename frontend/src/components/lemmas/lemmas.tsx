import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  GraduationCap,
  Info,
  ListFilter,
  Maximize2,
  Search,
  Star,
  Trash2,
  X,
} from "lucide-react";
import {
  deleteLemmaState,
  getLemmaDatabase,
  getLemmaMilestones,
  lemmaLookupOne,
  setInterest,
  updateLemmaState,
} from "../../api";
import type {
  LemmaData,
  UserLemmaDatabaseItem,
  UserLemmaMilestone,
} from "../pageTypes";
import { FilterSelect } from "../pages/PageFilters";
import ResponsiveSideLayout from "../util/ResponsiveSideLayout";
import { ResponsiveModal } from "../util/ResponsiveModal";
import Desk, { type DeskHandle } from "../lemma_expansions/Desk";
import LanguagePackRequiredModal from "../util/LanguagePackRequiredModal";
import { hasLemmaPackInstalled } from "../util/LanguageSelect";
import { useLayout } from "../RootLayout";
import { useI18n } from "../../i18n";
import { IconButton } from "../util/Button";

const POS_ORDER = [
  "NOUN",
  "VERB",
  "ADJ",
  "ADV",
  "PRON",
  "PROPN",
  "ADP",
  "DET",
  "NUM",
  "AUX",
  "CCONJ",
  "SCONJ",
  "PART",
  "INTJ",
  "PUNCT",
  "X",
];
const DEFAULT_WIDTHS = [160, 92, 68, 200, 104, 92, 92, 44];
type BoolFilter = "true" | "false" | null;
type DatabaseFilters = {
  q: string;
  pos: string | null;
  language: string | null;
  known: BoolFilter;
  interested: BoolFilter;
};
const toBool = (value: BoolFilter) =>
  value === null ? null : value === "true";
const formatDate = (value: string) =>
  new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));

function HeaderFilterButton({
  options,
  selected,
  title,
  onChange,
}: {
  options: { value: string; label: string }[];
  selected: boolean;
  title: string;
  onChange: (value: string | null) => void;
}) {
  return (
    <label
      className={`relative ml-auto ${selected ? "[&>button]:text-accent" : ""}`}
    >
      <IconButton
        icon={<ListFilter size={13} />}
        onClick={() => undefined}
        title={title}
      />
      <select
        aria-label={title}
        defaultValue=""
        onChange={(event) => onChange(event.target.value || null)}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
      >
        <option value="">{title}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function Timeline({
  milestones,
}: {
  milestones: Record<string, UserLemmaMilestone[]>;
}) {
  const { t } = useI18n();
  const languages = Object.keys(milestones).sort();
  if (!languages.length)
    return (
      <p className="text-sm text-neutral-400">{t("No milestones yet.")}</p>
    );
  return (
    <div className="grid gap-8 md:grid-cols-2">
      {languages.map((language) => (
        <div key={language}>
          <p className="mb-3 text-xs font-medium uppercase text-neutral-400">
            {language}
          </p>
          <ol className="relative ml-1 border-l border-neutral-300">
            {milestones[language].map((item, index) => (
              <li
                key={`${item.count}-${item.achieved_at}`}
                className="relative ml-5 pb-4 last:pb-0"
              >
                <span
                  className={`absolute -left-[25px] top-1 h-2.5 w-2.5 rounded-full ${
                    index === 0
                      ? "bg-[var(--app-green-500)]"
                      : index === milestones[language].length - 1
                      ? "bg-neutral-100"
                      : "bg-neutral-300"
                  }`}
                />
                <p className="text-sm">
                  {t("You marked {count} {language} words as known!", {
                    count: item.count.toLocaleString(),
                    language,
                  })}
                </p>
                <time className="text-xs text-neutral-400">
                  {formatDate(item.achieved_at)}
                </time>
              </li>
            ))}
          </ol>
        </div>
      ))}
    </div>
  );
}

export default function Lemmas() {
  const { t } = useI18n();
  const { setTitlebarAction, setPanelOpen } = useLayout();
  const [items, setItems] = useState<UserLemmaDatabaseItem[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [milestones, setMilestones] = useState<
    Record<string, UserLemmaMilestone[]>
  >({});
  const [filters, setFilters] = useState<DatabaseFilters>({
    q: "",
    pos: null,
    language: null,
    known: null,
    interested: null,
  });
  const [searchDraft, setSearchDraft] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [availablePos, setAvailablePos] = useState(POS_ORDER);
  const [availableLanguages, setAvailableLanguages] = useState<string[]>([]);
  const [widths, setWidths] = useState(DEFAULT_WIDTHS);
  const [lemmaData, setLemmaData] = useState<LemmaData | null>(null);
  const [currentLang, setCurrentLang] = useState<string | null>(null);
  const [missingPackLang, setMissingPackLang] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] =
    useState<UserLemmaDatabaseItem | null>(null);
  const [memoTarget, setMemoTarget] = useState<UserLemmaDatabaseItem | null>(
    null
  );
  const [memoDraft, setMemoDraft] = useState("");
  const [decayInfoOpen, setDecayInfoOpen] = useState(false);
  const deskRef = useRef<DeskHandle>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const mobile =
    typeof window !== "undefined" &&
    window.matchMedia("(pointer: coarse)").matches;
  const load = useCallback(
    async (offset = 0, append = false) => {
      setLoading(true);
      try {
        const data = await getLemmaDatabase({
          q: filters.q || undefined,
          pos: filters.pos,
          language: filters.language,
          is_known: toBool(filters.known),
          is_interested: toBool(filters.interested),
          offset,
        });
        setItems((previous) =>
          append ? [...previous, ...data.items] : data.items
        );
        setAvailablePos((current) => [
          ...new Set([
            ...current,
            ...data.items.map((item) => item.pos).filter(Boolean),
          ]),
        ]);
        setAvailableLanguages((current) =>
          [
            ...new Set([
              ...current,
              ...data.items.map((item) => item.language).filter(Boolean),
            ]),
          ].sort()
        );
        setHasMore(data.has_more);
      } finally {
        setLoading(false);
      }
    },
    [filters]
  );
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    void getLemmaMilestones()
      .then(setMilestones)
      .catch(() => setMilestones({}));
  }, []);
  useEffect(() => {
    setPanelOpen(lemmaData !== null);
  }, [lemmaData, setPanelOpen]);
  useEffect(() => {
    setTitlebarAction(() => setLemmaData(null));
    return () => setTitlebarAction(null);
  }, [setTitlebarAction]);
  useEffect(() => {
    if (searchOpen) searchRef.current?.focus();
  }, [searchOpen]);
  const posOptions = useMemo(
    () => availablePos.map((value) => ({ value, label: value })),
    [availablePos]
  );
  const languageOptions = useMemo(
    () => availableLanguages.map((value) => ({ value, label: value })),
    [availableLanguages]
  );
  const updateItem = (key: string, patch: Partial<UserLemmaDatabaseItem>) =>
    setItems((current) =>
      current.map((item) => (item.key === key ? { ...item, ...patch } : item))
    );
  const commitSearch = () => {
    setFilters((current) => ({ ...current, q: searchDraft.trim() }));
    setSearchOpen(false);
  };
  const openLemma = async (item: UserLemmaDatabaseItem) => {
    setCurrentLang(item.language);
    if (!(await hasLemmaPackInstalled(item.language))) {
      setMissingPackLang(item.language);
      return;
    }
    setLemmaData(
      await lemmaLookupOne({ lemma: item.lemma, pos: item.pos }, item.language)
    );
  };
  const saveMemo = async (item: UserLemmaDatabaseItem, memo: string) => {
    await updateLemmaState(item.key, { memo });
    updateItem(item.key, { memo });
    setMemoTarget(null);
  };
  const toggleKnown = async (item: UserLemmaDatabaseItem) => {
    const next = !item.is_known;
    await updateLemmaState(item.key, { is_known: next });
    updateItem(item.key, { is_known: next });
    if (next) void getLemmaMilestones().then(setMilestones);
  };
  const toggleInterest = async (item: UserLemmaDatabaseItem) => {
    const next = !item.is_interested;
    await setInterest(item.key, next);
    updateItem(item.key, { is_interested: next });
  };
  const resize = (index: number, event: React.PointerEvent) => {
    const startX = event.clientX;
    const start = widths[index];
    const onMove = (move: PointerEvent) =>
      setWidths((current) =>
        current.map((width, i) =>
          i === index ? Math.max(68, start + move.clientX - startX) : width
        )
      );
    window.addEventListener("pointermove", onMove);
    window.addEventListener(
      "pointerup",
      () => window.removeEventListener("pointermove", onMove),
      { once: true }
    );
  };
  const clear = (name: keyof DatabaseFilters) =>
    setFilters((current) => ({ ...current, [name]: name === "q" ? "" : null }));
  const filterChips = filters.q
    ? [{ name: "q" as const, label: `${t("Lemma")}: ${filters.q}` }]
    : [];
  const headers = [
    <>
      {searchOpen ? (
        <input
          ref={searchRef}
          value={searchDraft}
          onChange={(event) => setSearchDraft(event.target.value)}
          onBlur={commitSearch}
          onKeyDown={(event) => event.key === "Enter" && commitSearch()}
          placeholder={t("Search lemmas")}
          className="min-w-0 w-full bg-transparent outline-none placeholder:text-neutral-300"
        />
      ) : (
        <span>{t("Lemma")}</span>
      )}
      <span className={`ml-auto ${filters.q ? "[&>button]:text-accent" : ""}`}>
        <IconButton
          icon={<Search size={14} />}
          onClick={() => {
            setSearchDraft(filters.q);
            setSearchOpen(true);
          }}
          title={t("Search lemmas")}
        />
      </span>
    </>,
    <>
      <span>POS</span>
      <HeaderFilterButton
        options={posOptions}
        selected={filters.pos !== null}
        title={t("Filter by part of speech")}
        onChange={(value) =>
          setFilters((current) => ({ ...current, pos: value }))
        }
      />
    </>,
    <>
      <span>{t("Language")}</span>
      <HeaderFilterButton
        options={languageOptions}
        selected={filters.language !== null}
        title={t("Filter by language")}
        onChange={(value) =>
          setFilters((current) => ({ ...current, language: value }))
        }
      />
    </>,
    <span>{t("Memo")}</span>,
    <>
      <span>{t("Known")}</span>
      <HeaderFilterButton
        options={[
          { value: "true", label: t("Known") },
          { value: "false", label: t("Unknown") },
        ]}
        selected={filters.known !== null}
        title={t("Filter by known status")}
        onChange={(value) =>
          setFilters((current) => ({ ...current, known: value as BoolFilter }))
        }
      />
    </>,
    <>
      <span>{t("Interested")}</span>
      <HeaderFilterButton
        options={[
          { value: "true", label: t("Interested") },
          { value: "false", label: t("Not interested") },
        ]}
        selected={filters.interested !== null}
        title={t("Filter by interest")}
        onChange={(value) =>
          setFilters((current) => ({
            ...current,
            interested: value as BoolFilter,
          }))
        }
      />
    </>,
    <>
      <span>{t("Decay")}</span>
      <span className="ml-auto">
        <IconButton
          icon={<Info size={14} />}
          onClick={() => setDecayInfoOpen(true)}
          title={t("Decay information")}
        />
      </span>
    </>,
    <span className="sr-only">{t("Delete")}</span>,
  ];
  return (
    <div className="relative flex h-full w-full bg-neutral-50 pl-3 md:pl-6">
      <div className="flex-1 overflow-y-auto pb-16 pt-12 pr-3 md:pr-6">
        <h2 className="mb-14">{t("Lemmas")}</h2>
        <div className="mx-auto flex max-w-6xl flex-col gap-16">
          <section>
            <h3 className="mb-3">Recap</h3>
          </section>
          <section>
            <h3 className="mb-2">{t("Achievements")}</h3>
            <p className="mb-7 text-sm text-neutral-400">
              {t("We'll prioritize examples containing words you know.")}
            </p>
            <Timeline milestones={milestones} />
          </section>
          <section>
            <div className="mb-5">
              <h3 className="mb-2">{t("Database")}</h3>
            </div>
            {(filterChips.length > 0 ||
              filters.pos ||
              filters.language ||
              filters.known ||
              filters.interested) && (
              <div className="mb-3 flex flex-wrap gap-1.5">
                {filterChips.map((chip) => (
                  <button
                    key={chip.name}
                    onClick={() => clear(chip.name)}
                    className="flex items-center gap-1 rounded-full bg-neutral-200/70 px-2 py-1 text-xs text-neutral-600"
                  >
                    {chip.label}
                    <X size={12} />
                  </button>
                ))}
                {filters.pos && (
                  <FilterSelect
                    icon={<ListFilter size={13} />}
                    options={posOptions}
                    selectedValue={filters.pos}
                    title={t("Filter by part of speech")}
                    onChange={(value) =>
                      setFilters((current) => ({ ...current, pos: value }))
                    }
                  />
                )}
                {filters.language && (
                  <FilterSelect
                    icon={<ListFilter size={13} />}
                    options={languageOptions}
                    selectedValue={filters.language}
                    title={t("Filter by language")}
                    onChange={(value) =>
                      setFilters((current) => ({ ...current, language: value }))
                    }
                  />
                )}
                {filters.known && (
                  <FilterSelect
                    icon={<ListFilter size={13} />}
                    options={[
                      { value: "true", label: t("Known") },
                      { value: "false", label: t("Unknown") },
                    ]}
                    selectedValue={filters.known}
                    title={t("Filter by known status")}
                    onChange={(value) =>
                      setFilters((current) => ({
                        ...current,
                        known: value as BoolFilter,
                      }))
                    }
                  />
                )}
                {filters.interested && (
                  <FilterSelect
                    icon={<ListFilter size={13} />}
                    options={[
                      { value: "true", label: t("Interested") },
                      { value: "false", label: t("Not interested") },
                    ]}
                    selectedValue={filters.interested}
                    title={t("Filter by interest")}
                    onChange={(value) =>
                      setFilters((current) => ({
                        ...current,
                        interested: value as BoolFilter,
                      }))
                    }
                  />
                )}
              </div>
            )}
            <div className="relative">
              <div className="overflow-x-auto">
                <table className="w-max min-w-full table-fixed text-sm">
                  <colgroup>
                    {widths.map((width, index) => (
                      <col key={index} style={{ width }} />
                    ))}
                  </colgroup>
                  <thead className="font-[var(--font-pretendard)] text-left text-xs font-normal text-neutral-400">
                    <tr>
                      {headers.map((header, index) => (
                        <th
                          key={index}
                          className={`relative h-11 px-3 ${
                            index === headers.length - 1 ? "pr-11" : ""
                          }`}
                        >
                          <div className="flex min-w-0 items-center gap-1 font-normal">
                            {header}
                          </div>
                          {index < headers.length - 1 && (
                            <>
                              <span className="pointer-events-none absolute right-0 top-1/2 h-6 -translate-y-1/2 border-r border-neutral-300" />
                              <span
                                onPointerDown={(event) => resize(index, event)}
                                className="absolute right-[-2px] top-0 z-10 h-full w-1 cursor-col-resize hover:bg-neutral-300"
                              />
                            </>
                          )}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => (
                      <tr
                        key={item.key}
                        className="group border-t border-neutral-200 hover:bg-neutral-100/70"
                      >
                        <td
                          className="cursor-pointer px-3 py-1"
                          onClick={() => void openLemma(item)}
                        >
                          <div className="flex min-w-0 items-center gap-1">
                            <button className="truncate text-left font-body text-base font-semibold">
                              {item.lemma}
                            </button>
                            <button
                              onClick={(event) => {
                                event.stopPropagation();
                                void openLemma(item);
                              }}
                              className="ml-auto shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                              title={t("View examples")}
                            >
                              <Maximize2 size={14} />
                            </button>
                          </div>
                        </td>
                        <td className="truncate px-3 py-2 font-mono font-semibold text-xs uppercase text-neutral-400">
                          {item.pos}
                        </td>
                        <td className="truncate px-3 py-2 text-neutral-400 text-xs">
                          {item.language}
                        </td>
                        <td className="truncate px-3 py-2">
                          {mobile ? (
                            <button
                              onClick={() => {
                                setMemoTarget(item);
                                setMemoDraft(item.memo);
                              }}
                              className="w-full truncate text-left"
                            >
                              {item.memo || (
                                <span className="text-neutral-300">
                                  {t("Memo")}
                                </span>
                              )}
                            </button>
                          ) : (
                            <input
                              aria-label={t("Memo for {lemma}", {
                                lemma: item.lemma,
                              })}
                              defaultValue={item.memo}
                              maxLength={20}
                              onBlur={(event) =>
                                event.target.value !== item.memo &&
                                void saveMemo(item, event.target.value)
                              }
                              className="w-full bg-transparent outline-none placeholder:text-neutral-300"
                              placeholder={t("Memo")}
                            />
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            aria-label={
                              item.is_known
                                ? t("Known word")
                                : t("I know this word")
                            }
                            className={`p-1 transition-colors ${
                              item.is_known
                                ? "text-green-500"
                                : "text-neutral-400 hover:text-neutral-500"
                            }`}
                            onClick={() => void toggleKnown(item)}
                          >
                            <GraduationCap
                              size={19}
                              fill="transparent"
                              stroke="currentColor"
                            />
                          </button>
                        </td>
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            aria-label={
                              item.is_interested
                                ? t("Remove from interested words")
                                : t("Add to interested words")
                            }
                            className={`p-1 transition-colors ${
                              item.is_interested
                                ? "text-yellow-400"
                                : "text-neutral-400 hover:text-neutral-500"
                            }`}
                            onClick={() => void toggleInterest(item)}
                          >
                            <Star
                              size={19}
                              fill={
                                item.is_interested
                                  ? "currentColor"
                                  : "transparent"
                              }
                              stroke="currentColor"
                            />
                          </button>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-neutral-500">
                          {item.decay}
                        </td>
                        <td className="px-2 py-2 pr-11">
                          <button
                            onClick={() => setDeleteTarget(item)}
                            title={t("Delete lemma")}
                            className="text-neutral-400 hover:text-red-500"
                          >
                            <Trash2 size={16} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-r from-transparent to-neutral-50" />
            </div>
            {!loading && items.length === 0 && (
              <p className="py-8 text-center text-sm text-neutral-400">
                {t("No lemmas to show.")}
              </p>
            )}
            {hasMore && (
              <div className="pt-4 text-center">
                <button
                  onClick={() => void load(items.length, true)}
                  disabled={loading}
                  className="text-sm text-neutral-500 hover:text-neutral-800"
                >
                  {loading ? t("Loading...") : t("More")}
                </button>
              </div>
            )}
          </section>
        </div>
      </div>
      <LanguagePackRequiredModal
        language={missingPackLang ?? ""}
        open={missingPackLang !== null}
        onClose={() => setMissingPackLang(null)}
      />
      {lemmaData && (
        <ResponsiveSideLayout
          open
          onClose={() => setLemmaData(null)}
          onSwipeRight={() => deskRef.current?.markActiveKnown()}
        >
          <Desk
            ref={deskRef}
            key={lemmaData.key}
            initialLemma={lemmaData}
            language={currentLang!}
            interestKeys={
              new Set(
                items
                  .filter((item) => item.is_interested)
                  .map((item) => item.key)
              )
            }
            onToggleInterest={async (key, next) => {
              await setInterest(key, next);
              updateItem(key, { is_interested: next });
            }}
            onKnownWordsMilestone={() =>
              void getLemmaMilestones().then(setMilestones)
            }
          />
        </ResponsiveSideLayout>
      )}
      <ResponsiveModal
        open={decayInfoOpen}
        onClose={() => setDecayInfoOpen(false)}
      >
        <p className="text-sm">
          {t("You can lower the decay score through Recap.")}
        </p>
      </ResponsiveModal>
      <ResponsiveModal
        open={memoTarget !== null}
        onClose={() => setMemoTarget(null)}
      >
        <h3 className="mb-4">{t("Edit memo")}</h3>
        <textarea
          value={memoDraft}
          maxLength={20}
          onChange={(event) => setMemoDraft(event.target.value)}
          className="w-full resize-none border-b border-neutral-300 bg-transparent py-2 outline-none"
          rows={2}
        />
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={() => setMemoTarget(null)}
            className="px-3 py-1.5 text-sm"
          >
            {t("Cancel")}
          </button>
          <button
            onClick={() => memoTarget && void saveMemo(memoTarget, memoDraft)}
            className="rounded bg-neutral-800 px-3 py-1.5 text-sm text-neutral-50"
          >
            {t("Save")}
          </button>
        </div>
      </ResponsiveModal>
      <ResponsiveModal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
      >
        <h3 className="mb-3">{t("Delete this lemma?")}</h3>
        <p className="text-sm text-neutral-500">
          {t("Its saved examples will also be deleted.")}
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={() => setDeleteTarget(null)}
            className="px-3 py-1.5 text-sm"
          >
            {t("Cancel")}
          </button>
          <button
            onClick={() => {
              if (deleteTarget)
                void deleteLemmaState(deleteTarget.key).then(() => {
                  setItems((current) =>
                    current.filter((item) => item.key !== deleteTarget.key)
                  );
                  setDeleteTarget(null);
                });
            }}
            className="rounded bg-red-500 px-3 py-1.5 text-sm text-white"
          >
            {t("Delete")}
          </button>
        </div>
      </ResponsiveModal>
    </div>
  );
}
