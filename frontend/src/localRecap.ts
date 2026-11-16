import { getLemmaProfile, lemmaLookup } from "./api";
import type {
  KwicData,
  LemmaData,
  LocalRecapItem,
  LocalRecapWeek,
  RecapItem,
  RecapQuestion,
  RecapState,
  Token,
  UserLemmaState,
} from "./components/pageTypes";
import {
  getLocalRecapWeek,
  queueOfflineRecapResult,
  saveLocalRecapWeek,
  syncOfflineOutbox,
} from "./offlineData";

const RECAP_GROUP_SIZE = 8;
const RECAP_SESSION_SIZE = 2;
const MIN_KWIC_EXAMPLES = 3;
let weekPreparation: { key: string; promise: Promise<LocalRecapWeek> } | null = null;

type KeyParts = { lemma: string; pos: string; language: string };
type PreparedCandidate = {
  key: string;
  state: UserLemmaState;
  parts: KeyParts;
  lookup: LemmaData;
};

function parseKey(key: string): KeyParts | null {
  const parts = key.split("/");
  if (parts.length < 3) return null;
  const language = parts.pop()?.trim() ?? "";
  const pos = parts.pop()?.trim() ?? "";
  const lemma = parts.join("/").trim();
  if (!lemma || !pos || !language || pos.toUpperCase() === "X") return null;
  return { lemma, pos, language };
}

function localDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function weekStart() {
  const date = new Date();
  const weekday = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - weekday);
  return localDate(date);
}

function previousWeekStart() {
  const date = new Date();
  const weekday = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - weekday - 7);
  return localDate(date);
}

function normalizedLanguages(languages: string[]) {
  return [...new Set(languages.filter(Boolean))].sort();
}

function sameLanguages(left: string[], right: string[]) {
  return JSON.stringify(normalizedLanguages(left)) === JSON.stringify(normalizedLanguages(right));
}

function shuffle<T>(values: T[]) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = Math.floor(Math.random() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

function candidateRank(candidate: PreparedCandidate) {
  const knownTier = candidate.state.is_known ? 2 : candidate.state.is_interested ? 1 : 0;
  return [knownTier, candidate.state.decay ?? 0];
}

function validKwic(kwic: KwicData) {
  return Array.isArray(kwic.tokens)
    && kwic.tokens.length > 0
    && Array.isArray(kwic.match_indices)
    && kwic.match_indices.some((index) => index >= 0 && index < kwic.tokens.length);
}

function lookupForKey(results: Record<string, LemmaData>, key: string, parts: KeyParts) {
  return results[`${parts.lemma}_${parts.pos}`]
    ?? Object.values(results).find((result) => result.global_key === key);
}

function questionFor(candidate: PreparedCandidate, pool: PreparedCandidate[]): RecapQuestion {
  const group = pool.filter((other) =>
    other.key !== candidate.key
    && other.parts.pos === candidate.parts.pos
    && other.parts.language === candidate.parts.language
  );
  const distractors = shuffle(group).slice(0, 3);
  if (distractors.length < 3) throw new Error("recap_distractors_unavailable");
  const examples = candidate.lookup.kwic.filter(validKwic).slice(0, MIN_KWIC_EXAMPLES).map((kwic) => ({
    text: kwic.tokens.map((token: Token) => token.surface).join(" "),
    tokens: kwic.tokens,
    match_indices: kwic.match_indices,
  }));
  if (examples.length < MIN_KWIC_EXAMPLES) throw new Error("recap_examples_unavailable");
  const label = (key: string) => parseKey(key)?.lemma ?? key;
  return {
    primary_example: examples[0],
    extra_examples: examples.slice(1),
    options: shuffle([candidate, ...distractors]).map((item) => ({
      key: item.key,
      label: label(item.key),
    })),
  };
}

async function prepareCandidates(languages: string[], randomize: boolean) {
  const profile = await getLemmaProfile();
  const languageSet = new Set(normalizedLanguages(languages));
  const recentFailureCutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const raw = Object.entries(profile).flatMap(([key, state]) => {
    const parts = parseKey(key);
    if (!parts || (!state.is_known && !state.is_interested)) return [];
    if (languageSet.size && !languageSet.has(parts.language)) return [];
    const failedAt = state.last_recap_failed_at ? Date.parse(state.last_recap_failed_at) : 0;
    if (Number.isFinite(failedAt) && failedAt >= recentFailureCutoff) return [];
    return [{ key, state, parts }];
  });

  const lookups = new Map<string, Record<string, LemmaData>>();
  await Promise.all([...new Set(raw.map((candidate) => candidate.parts.language))].map(async (language) => {
    const items = raw
      .filter((candidate) => candidate.parts.language === language)
      .map((candidate) => ({ lemma: candidate.parts.lemma, pos: candidate.parts.pos }));
    try {
      lookups.set(language, await lemmaLookup(items, language));
    } catch {
      lookups.set(language, {});
    }
  }));

  const prepared: PreparedCandidate[] = raw.flatMap((candidate) => {
    const lookup = lookupForKey(lookups.get(candidate.parts.language) ?? {}, candidate.key, candidate.parts);
    if (!lookup || lookup.found === false || lookup.kwic.filter(validKwic).length < MIN_KWIC_EXAMPLES) return [];
    return [{ ...candidate, lookup }];
  });
  const usable = prepared.filter((candidate) => prepared.filter((other) =>
    other.parts.language === candidate.parts.language && other.parts.pos === candidate.parts.pos
  ).length >= 4);

  if (randomize) return shuffle(usable);
  return usable.sort((left, right) => {
    const [leftTier, leftDecay] = candidateRank(left);
    const [rightTier, rightDecay] = candidateRank(right);
    return rightTier - leftTier || rightDecay - leftDecay || left.key.localeCompare(right.key);
  });
}

function testItemFor(candidate: PreparedCandidate, position: number, pool: PreparedCandidate[]): LocalRecapItem {
  return {
    id: crypto.randomUUID(),
    lemma_key: candidate.key,
    position,
    status: "pending",
    session_date: null,
    answer_key: candidate.key,
    question: questionFor(candidate, pool),
  };
}

function showcaseItemFor(candidate: PreparedCandidate, position: number): RecapItem {
  return {
    id: crypto.randomUUID(),
    lemma_key: candidate.key,
    position,
    status: "pending",
  };
}

async function createWeek(
  languages: string[],
  randomize = false,
  previousWeek: LocalRecapWeek | null = null,
): Promise<LocalRecapWeek> {
  const candidates = await prepareCandidates(languages, randomize);
  const byKey = new Map(candidates.map((candidate) => [candidate.key, candidate]));
  const previousShowcase = previousWeek?.showcase_items ?? [];
  const testCandidates: PreparedCandidate[] = [];
  for (const item of previousShowcase) {
    const candidate = byKey.get(item.lemma_key);
    if (candidate && !testCandidates.some((selected) => selected.key === candidate.key)) {
      testCandidates.push(candidate);
    }
    if (testCandidates.length === RECAP_GROUP_SIZE) break;
  }
  for (const candidate of candidates) {
    if (testCandidates.length === RECAP_GROUP_SIZE) break;
    if (!testCandidates.some((selected) => selected.key === candidate.key)) testCandidates.push(candidate);
  }
  const testKeys = new Set(testCandidates.map((candidate) => candidate.key));
  const showcaseCandidates = candidates
    .filter((candidate) => !testKeys.has(candidate.key))
    .slice(0, RECAP_GROUP_SIZE);
  const week: LocalRecapWeek = {
    week_start: weekStart(),
    languages: normalizedLanguages(languages),
    test_items: testCandidates.map((candidate, index) => testItemFor(candidate, index + 1, candidates)),
    showcase_items: showcaseCandidates.map((candidate, index) => showcaseItemFor(candidate, index + 1)),
    created_at: new Date().toISOString(),
  };
  await saveLocalRecapWeek(week);
  return week;
}

async function prepareWeekIfNeeded(languages: string[]) {
  const stored = await getLocalRecapWeek();
  if (
    stored?.week_start === weekStart()
    && sameLanguages(stored.languages, languages)
    && Array.isArray(stored.test_items)
    && Array.isArray(stored.showcase_items)
  ) {
    return stored;
  }
  const previousWeek = stored?.week_start === previousWeekStart() ? stored : null;
  return createWeek(languages, false, previousWeek);
}

async function ensureWeek(languages: string[]) {
  const key = JSON.stringify([weekStart(), normalizedLanguages(languages)]);
  if (weekPreparation?.key === key) return weekPreparation.promise;
  const promise = prepareWeekIfNeeded(languages).finally(() => {
    if (weekPreparation?.promise === promise) weekPreparation = null;
  });
  weekPreparation = { key, promise };
  return promise;
}

function recapState(week: LocalRecapWeek): RecapState {
  const today = localDate();
  const pending = week.test_items.filter((item) => item.status === "pending");
  const todayItems = week.test_items.filter((item) => item.session_date === today);
  const state: RecapState["state"] = week.test_items.length === 0
    ? "warming_up"
    : pending.length === 0
      ? "completed"
      : todayItems.length > 0 && todayItems.every((item) => item.status !== "pending")
        ? "daily_complete"
        : "ready";
  return {
    week_start: week.week_start,
    available: week.test_items.length > 0,
    state,
    remaining_count: pending.length,
    test_items: week.test_items,
    showcase_items: week.showcase_items,
  };
}

export async function getLocalLemmaRecap(languages: string[] = []) {
  return recapState(await ensureWeek(languages));
}

export async function startLocalLemmaRecapSession(languages: string[] = []) {
  const week = await ensureWeek(languages);
  const today = localDate();
  const assigned = week.test_items.filter((item) => item.session_date === today);
  if (assigned.some((item) => item.status === "pending")) {
    return { week_start: week.week_start, items: assigned };
  }
  if (assigned.length > 0) throw new Error("today's recap is complete");
  const next = week.test_items.filter((item) => item.status === "pending").slice(0, RECAP_SESSION_SIZE);
  if (!next.length) throw new Error("recap week is complete");
  const ids = new Set(next.map((item) => item.id));
  for (const item of week.test_items) {
    if (ids.has(item.id)) item.session_date = today;
  }
  await saveLocalRecapWeek(week);
  return { week_start: week.week_start, items: next };
}

export async function answerLocalLemmaRecapQuestion(
  itemId: string | number,
  choiceKey: string,
  finalAttempt: boolean,
) {
  const week = await getLocalRecapWeek();
  const item = week?.test_items.find((candidate) => candidate.id === itemId);
  if (!week || !item || item.status !== "pending") throw new Error("recap item is not active");
  const correct = choiceKey === item.answer_key;
  const retryAvailable = !correct && !finalAttempt;
  if (!retryAvailable) {
    item.status = correct ? "passed" : "failed";
    const answeredAt = new Date().toISOString();
    await saveLocalRecapWeek(week);
    await queueOfflineRecapResult(item.lemma_key, item.status, answeredAt);
    void syncOfflineOutbox().catch(() => false);
  }
  return {
    correct,
    retry_available: retryAvailable,
    status: item.status,
    answer_key: retryAvailable ? null : item.answer_key,
    week_completed: week.test_items.every((candidate) => candidate.status !== "pending"),
  };
}

export async function rerollLocalLemmaRecap(languages: string[] = []) {
  const week = await ensureWeek(languages);
  const candidates = await prepareCandidates(languages, true);
  const testKeys = new Set(week.test_items.map((item) => item.lemma_key));
  week.showcase_items = candidates
    .filter((candidate) => !testKeys.has(candidate.key))
    .slice(0, RECAP_GROUP_SIZE)
    .map((candidate, index) => showcaseItemFor(candidate, index + 1));
  await saveLocalRecapWeek(week);
  return week.showcase_items;
}

export async function rebuildLocalLemmaRecap(languages: string[] = []) {
  return createWeek(languages, true);
}

export async function resetTodayLocalLemmaRecapSession(languages: string[] = []) {
  const week = await ensureWeek(languages);
  const today = localDate();
  const items = week.test_items.filter((item) => item.session_date === today);
  for (const item of items) item.status = "pending";
  await saveLocalRecapWeek(week);
  return items;
}
