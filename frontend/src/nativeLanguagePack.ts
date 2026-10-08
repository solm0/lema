import { registerPlugin } from "@capacitor/core";
import type {
  LemmaData,
  TextBlock,
  UserLemmaState,
} from "./components/pageTypes";

type LookupItem = { lemma: string; pos: string };
type LanguagePackCapabilities = {
  analysisLanguages: string[];
  lookupLanguages: string[];
};

export type NativeInstalledPack = {
  lang: string;
  version: string;
  installed: boolean;
  lemma_installed: boolean;
  model_installed: boolean;
};

export type NativeInstallProgress = {
  progress?: number;
  status?: string;
  error?: string;
  detail?: string;
  model_percent?: number;
  model_name?: string;
};

type LemaLanguagePackPlugin = {
  getSupportedLanguages(): Promise<{ languages: string[] }>;
  getInstalledPacks(): Promise<{ packs: NativeInstalledPack[] }>;
  install(options: {
    lang: string;
    version: string;
    filename: string;
    download_url: string;
  }): Promise<{ task_id: string }>;
  uninstall(options: { lang: string; version: string }): Promise<void>;
  getInstallProgress(options: { task_id: string }): Promise<NativeInstallProgress>;
  getCapabilities(): Promise<LanguagePackCapabilities>;
  analyze(options: {
    blocks: Array<{ text: string }>;
    language: string;
  }): Promise<{ blocks: TextBlock[] }>;
  lookup(options: LookupItem & {
    language: string;
    profile: Record<string, UserLemmaState>;
  }): Promise<LemmaData>;
  lookupBatch(options: {
    items: LookupItem[];
    language: string;
    profile: Record<string, UserLemmaState>;
  }): Promise<{ items: Record<string, LemmaData> }>;
};

const NativeLanguagePack =
  registerPlugin<LemaLanguagePackPlugin>("LemaLanguagePack");

let capabilitiesPromise: Promise<LanguagePackCapabilities> | null = null;
let supportedLanguagesPromise: Promise<string[]> | null = null;

function getCapabilities() {
  capabilitiesPromise ??= NativeLanguagePack.getCapabilities().catch(() => ({
    analysisLanguages: [],
    lookupLanguages: [],
  }));
  return capabilitiesPromise;
}

export function invalidateNativeLanguagePackCapabilities() {
  capabilitiesPromise = null;
}

export function getSupportedNativePackLanguages() {
  supportedLanguagesPromise ??= NativeLanguagePack.getSupportedLanguages()
    .then(({ languages }) => languages)
    .catch(() => []);
  return supportedLanguagesPromise;
}

export async function getInstalledNativePacks() {
  return (await NativeLanguagePack.getInstalledPacks()).packs;
}

export async function installNativePack(pack: {
  lang: string;
  version: string;
  filename: string;
  download_url?: string;
}) {
  const result = await NativeLanguagePack.install({
    ...pack,
    download_url: pack.download_url ?? "",
  });
  invalidateNativeLanguagePackCapabilities();
  return result;
}

export async function uninstallNativePack(pack: { lang: string; version: string }) {
  await NativeLanguagePack.uninstall(pack);
  invalidateNativeLanguagePackCapabilities();
}

export async function getNativePackInstallProgress(taskId: string) {
  const progress = await NativeLanguagePack.getInstallProgress({ task_id: taskId });
  if (progress.status === "done") invalidateNativeLanguagePackCapabilities();
  return progress;
}

export async function canAnalyzeWithNativePack(language: string) {
  return (await getCapabilities()).analysisLanguages.includes(language);
}

export async function canLookupWithNativePack(language: string) {
  return (await getCapabilities()).lookupLanguages.includes(language);
}

export async function analyzeWithNativePack(
  blocks: Array<{ text: string }>,
  language: string,
) {
  return NativeLanguagePack.analyze({ blocks, language });
}

export async function lookupNativeLemmas(
  items: LookupItem[],
  language: string,
  profile: Record<string, UserLemmaState>,
) {
  return (await NativeLanguagePack.lookupBatch({ items, language, profile })).items;
}

export function lookupNativeLemma(
  item: LookupItem,
  language: string,
  profile: Record<string, UserLemmaState>,
) {
  return NativeLanguagePack.lookup({ ...item, language, profile });
}
