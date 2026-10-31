import { FileInput, Languages, X } from "lucide-react";
import type { ReactNode } from "react";

import { useI18n } from "../../i18n";

export type PageInputSource = "user" | "lrclib" | "chrome";

type FilterOption = {
  label: string;
  value: string;
};

export function FilterSelect({
  icon,
  options,
  selectedValue,
  title,
  onChange,
}: {
  icon: ReactNode;
  options: FilterOption[];
  selectedValue: string | null;
  title: string;
  onChange: (value: string | null) => void;
}) {
  const selectedLabel = options.find(
    (option) => option.value === selectedValue
  )?.label;

  return (
    <div
      className={`relative flex min-w-0 items-center ${
        selectedValue
          ? "w-auto max-w-full shrink rounded-full bg-neutral-400/15 text-neutral-700"
          : "shrink-0 text-neutral-700"
      }`}
    >
      <label
        className={`relative flex min-w-0 cursor-pointer items-center justify-center gap-1 rounded-full transition-colors hover:bg-neutral-400/20 ${
          selectedValue ? "h-8 md:h-6 flex-1 pl-2 pr-2 md:pl-1.5 md:pr-1.5" : "h-8 w-8 md:h-6 md:w-6"
        }`}
        title={title}
      >
        <span className="shrink-0">{icon}</span>
        {selectedLabel ? (
          <span className="min-w-0 truncate text-sm md:text-xs">{selectedLabel}</span>
        ) : null}
        <select
          value={selectedValue ?? ""}
          onChange={(event) => onChange(event.target.value)}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          aria-label={title}
        >
          <option value="" disabled>
            {title}
          </option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      {selectedValue ? (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onChange(null);
          }}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-neutral-500 transition-colors hover:bg-neutral-400/25 hover:text-neutral-800"
          title={title}
        >
          <X size={12} />
        </button>
      ) : null}
    </div>
  );
}

export function LanguageFilter({
  languages,
  selectedLanguage,
  onLanguageChange,
}: {
  languages: string[];
  selectedLanguage: string | null;
  onLanguageChange: (value: string | null) => void;
}) {
  const { t } = useI18n();

  return (
    <div className="flex min-w-0 items-center gap-0.5 overflow-hidden text-xs">
      <FilterSelect
        icon={<Languages size={14} />}
        options={languages.map((language) => ({ label: language, value: language }))}
        selectedValue={selectedLanguage}
        title={t("Filter by language")}
        onChange={onLanguageChange}
      />
    </div>
  );
}

export function PageFilters({
  languages,
  selectedLanguage,
  selectedSource,
  mobileApp,
  onLanguageChange,
  onSourceChange,
}: {
  languages: string[];
  selectedLanguage: string | null;
  selectedSource: PageInputSource | null;
  mobileApp: boolean;
  onLanguageChange: (value: string | null) => void;
  onSourceChange: (value: PageInputSource | null) => void;
}) {
  const { t } = useI18n();
  const languageOptions = languages.map((language) => ({
    label: language,
    value: language,
  }));
  const sourceOptions: FilterOption[] = [
    { value: "user", label: t("Paste text") },
    { value: "lrclib", label: t("Get lyrics") },
    ...(!mobileApp
      ? [{ value: "chrome", label: t("Chrome browser") }]
      : []),
  ];

  return (
    <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden text-sm md:text-xs pl-0 md:pl-0.5">
      <FilterSelect
        icon={<Languages className="w-4 h-4 md:w-3.5 md:h-3.5" />}
        options={languageOptions}
        selectedValue={selectedLanguage}
        title={t("Filter by language")}
        onChange={onLanguageChange}
      />
      <FilterSelect
        icon={<FileInput className="w-4 h-4 md:w-3.5 md:h-3.5" />}
        options={sourceOptions}
        selectedValue={selectedSource}
        title={t("Filter by input method")}
        onChange={(value) => onSourceChange(value as PageInputSource | null)}
      />
    </div>
  );
}
