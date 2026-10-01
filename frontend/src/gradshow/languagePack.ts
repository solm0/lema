import { registerPlugin } from "@capacitor/core";
import type { LemmaData, UserLemmaState } from "../components/pageTypes";

type LookupItem = { lemma: string; pos: string };

type GradshowLanguagePackPlugin = {
  lookupBatch(options: {
    items: LookupItem[];
    language: string;
    profile: Record<string, UserLemmaState>;
  }): Promise<{ items: Record<string, LemmaData> }>;
};

const NativeGradshowLanguagePack =
  registerPlugin<GradshowLanguagePackPlugin>("GradshowLanguagePack");

export async function lookupGradshowLemmas(
  items: LookupItem[],
  language: string,
  profile: Record<string, UserLemmaState>,
) {
  if (language !== "en") return {};
  return (await NativeGradshowLanguagePack.lookupBatch({ items, language, profile })).items;
}

