import type {
  Annotation,
  PageSource,
  TextAnalysisResult,
  UserLemmaState,
} from "./components/pageTypes"
import type { User } from "./types";
import {
  clearStoredSession,
  getOfflineSessionUser,
  getStoredToken,
  hasStoredSession,
  isTokenExpired,
  storeVerifiedSession,
} from "./authSession";
import {
  readPackCatalogSnapshot,
  writePackCatalogSnapshot,
} from "./packCatalogSnapshot";
import {
  cacheInterestedLemmaKeys,
  cacheLemmaProfile,
  getOfflineInterestedKeys,
  getOfflineLemmaProfile,
  queueOfflineInterestToggle,
  queueOfflineLemmaStateUpdate,
  syncOfflineOutbox,
} from "./offlineData";
import { getAppPlatform, isCapacitorApp, isElectronApp } from "./platform";
import {
  disableMobileLanguage,
  enableMobileLanguage,
  getEnabledMobileLanguages,
} from "./mobilePacks";
import { centralFetch } from "./network";
import {
  createLocalAnnotation,
  createLocalPage,
  deleteLocalAnnotation,
  getLocalPage,
  listLocalAnnotations,
  listLocalNotebooks,
  listLocalPages,
  setLocalPageMetadata,
  updateLocalAnnotation,
} from "./localLibrary";

const DEFAULT_CENTRAL_API = "https://nautilus.solmi.wiki/api";
const DEFAULT_ELECTRON_LOCAL_API = "http://localhost:8010/api";
const DEFAULT_WEB_LOCAL_API = "http://localhost:8000/api";

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function resolveCentralApi() {
  const platform = getAppPlatform();

  if (platform === "electron") {
    return trimTrailingSlash(
      import.meta.env.VITE_ELECTRON_CENTRAL_API
        ?? import.meta.env.VITE_CENTRAL_API
        ?? DEFAULT_CENTRAL_API,
    );
  }

  if (platform === "mobile") {
    return trimTrailingSlash(
      import.meta.env.VITE_MOBILE_CENTRAL_API
        ?? import.meta.env.VITE_CENTRAL_API
        ?? DEFAULT_CENTRAL_API,
    );
  }

  return trimTrailingSlash(
    import.meta.env.VITE_WEB_CENTRAL_API
      ?? import.meta.env.VITE_CENTRAL_API
      ?? DEFAULT_CENTRAL_API,
  );
}

function resolveLocalApi(centralApi: string) {
  const platform = getAppPlatform();

  if (platform === "electron") {
    return trimTrailingSlash(
      import.meta.env.VITE_ELECTRON_LOCAL_API
        ?? import.meta.env.VITE_LOCAL_API
        ?? DEFAULT_ELECTRON_LOCAL_API,
    );
  }

  if (platform === "mobile") {
    return trimTrailingSlash(
      import.meta.env.VITE_MOBILE_LOCAL_API
        ?? `${centralApi}/mobile`,
    );
  }

  return trimTrailingSlash(
    import.meta.env.VITE_WEB_LOCAL_API
      ?? import.meta.env.VITE_LOCAL_API
      ?? DEFAULT_WEB_LOCAL_API,
  );
}

export const CENTRAL_API = resolveCentralApi();
export const LOCAL_API = resolveLocalApi(CENTRAL_API);

export type LatestVersionPlatform = "desktop" | "android";

type ApiErrorDetailObject = {
  code?: string;
  message?: string;
};

export type ApiErrorDetail =
  | string
  | ApiErrorDetailObject
  | Array<{ msg?: string }>
  | undefined;

function resolveLatestVersionPlatform(): LatestVersionPlatform {
  return getAppPlatform() === "mobile" ? "android" : "desktop";
}

export type AnalyzeBlockInput = {
  text: string;
};

const MOBILE_ANALYZE_BATCH_SIZE = 8;

function compareVersionsDesc(a: string, b: string) {
  return b.localeCompare(a, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

export function isNewerVersion(latest: string, current: string) {
  return compareVersionsDesc(latest, current) < 0;
}

export type LatestVersionInfo = {
  platform: LatestVersionPlatform;
  version: string;
  download_url: string;
  notes: string[];
};

export async function getLatestVersionInfo() {
  const platform = resolveLatestVersionPlatform();
  const res = await centralFetch(`${CENTRAL_API}/latest-version?platform=${platform}`);

  if (!res.ok) {
    throw new Error(`latest version fetch failed (${res.status})`);
  }

  return res.json() as Promise<LatestVersionInfo>;
}

export async function signup(email: string, password: string, name: string) {
  const res = await centralFetch(CENTRAL_API+"/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, name })
  });
  return res.json();
}

export async function login(email:string,password:string){
  return centralFetch(CENTRAL_API+"/login",{
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body:JSON.stringify({email,password})
  }).then(r=>r.json())
}

export async function requestReset(email:string){
  return centralFetch(CENTRAL_API+"/request-password-reset",{
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body:JSON.stringify({email})
  }).then(r=>r.json())
}

export async function resetPassword(token:string,new_password:string){
  return centralFetch(CENTRAL_API+"/reset-password",{
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body:JSON.stringify({token,new_password})
  }).then(r=>r.json())
}

export function parseApiErrorDetail(detail: ApiErrorDetail): {
  code?: string;
  message: string;
} | null {
  if (!detail) {
    return null;
  }

  if (Array.isArray(detail)) {
    return {
      message: detail[0]?.msg || "error",
    };
  }

  if (typeof detail === "string") {
    return {
      message: detail,
    };
  }

  return {
    code: detail.code,
    message: detail.message || "error",
  };
}

export function authHeaders() {
  const token = getStoredToken();
  if (!token) return null

  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`
  }
}

export async function verifyToken({
  throwOnNetworkError = false,
}: {
  throwOnNetworkError?: boolean;
} = {}) {
  const token = getStoredToken();

  if (!token) {
    return null;
  }

  if (isTokenExpired(token)) {
    clearStoredSession();
    return null;
  }

  const headers = authHeaders();

  if (!headers) {
    return null;
  }

  try {
    const res = await centralFetch(CENTRAL_API + "/me", {
      headers,
    });

    if (!res.ok) {
      if (res.status === 401) {
        clearStoredSession();
        return null;
      }

      return hasStoredSession() ? getOfflineSessionUser() : null;
    }

    const data = await res.json() as User;
    storeVerifiedSession(token, data);
    return data;
  } catch (error) {
    if (throwOnNetworkError) {
      throw error;
    }
    return getOfflineSessionUser();
  }
}

export async function updateName(name: string) {
  const headers = authHeaders()
  if (!headers) return false

  const res = await centralFetch(CENTRAL_API+"/me/name", {
    method: "PUT",
    headers,
    body: JSON.stringify({ name })
  });

  return res.json();
}

export async function deleteAccount() {
  const headers = authHeaders();
  if (!headers) {
    throw new Error("unauthorized");
  }

  const res = await centralFetch(CENTRAL_API + "/me", {
    method: "DELETE",
    headers,
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const error = Array.isArray(data.detail) ? data.detail[0]?.msg : data.detail;
    throw new Error(error || "delete account failed");
  }

  return data;
}

async function analyzeBlocksBatch(
  blocks: AnalyzeBlockInput[],
  language: string,
) {
  const res = await fetch(`${LOCAL_API}/analyze`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      blocks,
      language,
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(detail || `analyze failed (${res.status})`);
  }

  return res.json() as Promise<{
    blocks: Array<{
      text: string;
      tokens?: TextAnalysisResult["blocks"][number]["tokens"];
    }>;
  }>;
}

export async function analyzeBlocks(
  blocks: AnalyzeBlockInput[],
  language: string,
) {
  const shouldBatch =
    isCapacitorApp() && blocks.length > MOBILE_ANALYZE_BATCH_SIZE;

  if (!shouldBatch) {
    return analyzeBlocksBatch(blocks, language);
  }

  const analyzedBlocks: Array<{
    text: string;
    tokens?: TextAnalysisResult["blocks"][number]["tokens"];
  }> = [];

  for (let start = 0; start < blocks.length; start += MOBILE_ANALYZE_BATCH_SIZE) {
    const batch = blocks.slice(start, start + MOBILE_ANALYZE_BATCH_SIZE);
    const result = await analyzeBlocksBatch(batch, language);
    analyzedBlocks.push(...result.blocks);
  }

  return {
    blocks: analyzedBlocks,
  };
}

// ----------- local library -------------

export type SavePageProgress = "saving";

export async function savePage(
  result: TextAnalysisResult,
  name: string,
  notebookId: string | null,
  language: string,
  options?: {
    source?: PageSource;
    metadata?: string[];
    onProgress?: (stage: SavePageProgress) => void;
  },
) {
  options?.onProgress?.("saving");
  return createLocalPage({
    result,
    name,
    notebookId,
    language,
    source: options?.source ?? "user",
    metadata: options?.metadata ?? [],
  });
}

export async function addPageMetadata(pageId: string, value: string) {
  const page = await getLocalPage(pageId);
  return setLocalPageMetadata(pageId, [...(page.metadata ?? []), value]);
}

export async function updatePageMetadata(
  pageId: string,
  metadataIndex: number,
  value: string,
) {
  const page = await getLocalPage(pageId);
  const metadata = [...(page.metadata ?? [])];
  metadata[metadataIndex] = value;
  return setLocalPageMetadata(pageId, metadata);
}

export async function deletePageMetadata(pageId: string, metadataIndex: number) {
  const page = await getLocalPage(pageId);
  const metadata = (page.metadata ?? []).filter((_, index) => index !== metadataIndex);
  return setLocalPageMetadata(pageId, metadata);
}

export async function fetchPages () {
  return listLocalPages();
};

export async function fetchNotebooks() {
  return listLocalNotebooks();
}

export async function fetchPageDetail(pageId: string) {
  return getLocalPage(pageId);
}

const CYR_TO_LAT_MAP: Record<string, string> = {
  а:"a", б:"b", в:"v", г:"g", д:"d",
  ђ:"đ", е:"e", ж:"ž", з:"z", и:"i",
  ј:"j", к:"k", л:"l", љ:"lj", м:"m",
  н:"n", њ:"nj", о:"o", п:"p", р:"r",
  с:"s", т:"t", ћ:"ć", у:"u", ф:"f",
  х:"h", ц:"c", ч:"č", џ:"dž", ш:"š"
}

function normalizeSr(lemma: string) {
  return lemma
    .toLowerCase()
    .split("")
    .map(ch => CYR_TO_LAT_MAP[ch] ?? ch)
    .join("")
}

export async function lemmaLookup(
  items: { lemma: string; pos: string }[],
  language: string
) {
  const headers = authHeaders() ?? {}

  const normalizedItems =
    language === "sr"
      ? items.map(i => ({
          ...i,
          lemma: normalizeSr(i.lemma),
        }))
      : items

  const res = await fetch(`${LOCAL_API}/lookup_batch`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify({
      items: normalizedItems,
      language,
    }),
  })

  if (!res.ok) throw new Error("lookup_batch failed")

  return res.json()
}

export async function lemmaLookupOne(
  item: { lemma:string; pos:string; },
  language: string
) {
  const headers = authHeaders() ?? {}

  const res = await fetch(`${LOCAL_API}/lookup`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify({...item, language})
  })

  if (!res.ok) throw new Error("lookup failed")

  return res.json()
}

export async function setInterest(
  key: string,
  next: boolean
) {
  const headers = authHeaders();

  if (!headers) {
    throw new Error("not authenticated");
  }

  if (isElectronApp() || isCapacitorApp()) {
    await queueOfflineInterestToggle(key, next);
    const synced = await syncOfflineOutbox();
    if (synced) await invalidateLocalLemmaProfileCache();
    return { ok: true, offline: !synced };
  }

  let res: Response;

  try {
    res = await centralFetch(`${CENTRAL_API}/lemma/interest`, {
      method: next ? "POST" : "DELETE",
      headers,
      body: JSON.stringify({ key })
    });
  } catch {
    await queueOfflineInterestToggle(key, next);
    return { ok: true, offline: true };
  }

  if (!res.ok) {
    throw new Error("interest request failed");
  }

  await invalidateLocalLemmaProfileCache();
  return res.json();
}

async function invalidateLocalLemmaProfileCache() {
  if (isCapacitorApp()) return;
  const headers = authHeaders();
  if (!headers) return;
  await fetch(`${LOCAL_API}/lemma/profile/cache`, {
    method: "DELETE",
    headers,
  }).catch(() => undefined);
}

export async function getLemmaProfile(): Promise<Record<string, UserLemmaState>> {
  const headers = authHeaders();
  if (!headers) throw new Error("not authenticated");

  try {
    const response = await centralFetch(`${CENTRAL_API}/lemma/profile`, {
      method: "GET",
      headers,
    });
    if (!response.ok) throw new Error("lemma profile request failed");
    const data = await response.json() as { items?: UserLemmaState[] };
    const items = Array.isArray(data.items) ? data.items : [];
    await cacheLemmaProfile(items);
    return getOfflineLemmaProfile();
  } catch {
    return getOfflineLemmaProfile();
  }
}

export async function updateLemmaState(
  key: string,
  update: { exposure_count?: number; is_known?: boolean },
): Promise<UserLemmaState> {
  const headers = authHeaders();
  if (!headers) throw new Error("not authenticated");

  await queueOfflineLemmaStateUpdate(key, update);
  const synced = await syncOfflineOutbox();
  if (synced) await invalidateLocalLemmaProfileCache();
  const profile = await getOfflineLemmaProfile();
  return profile[key];
}

export async function getInterests(): Promise<string[]> {
  const headers = authHeaders()
  if (!headers) throw new Error("no token")

  try {
    const res = await centralFetch(`${CENTRAL_API}/lemma/interests`, {
      method: "GET",
      headers
    })

    if (!res.ok) throw new Error("fetch interests failed")

    const data = await res.json()
    const items = data.items as string[];
    if (isElectronApp() || isCapacitorApp()) {
      await cacheInterestedLemmaKeys(items);
      return getOfflineInterestedKeys();
    }
    return items;
  } catch (error) {
    if (isElectronApp() || isCapacitorApp()) {
      return getOfflineInterestedKeys();
    }
    throw error;
  }
}

export async function deleteAnnotation(id: string) {
  await deleteLocalAnnotation(id);
  return true;
}

export async function updateAnnotation(id: string, content: string) {
  return updateLocalAnnotation(id, content);
}

// get all annotations

export type AnnotationItem = {
  id: string;
  type: "link" | "memo" | "emoji";
  content: string;
  page_id: string;
  page_name: string;
  source: string;
  created_at: string;
  user: User
};

export type AnnotationCursor = {
  created_at: string;
  id: string;
} | null;

export async function fetchAnnotations(cursor: AnnotationCursor) {
  if (cursor) return { items: [], next_cursor: null, offline: false };
  return { items: await listLocalAnnotations(), next_cursor: null, offline: false };
}

export async function createAnnotation(annotation: Annotation) {
  return createLocalAnnotation(annotation);
}

// packs 목록
export async function getPacks() {
  const res = await centralFetch(`${CENTRAL_API}/lang/packs`);

  if (!res.ok) {
    throw new Error("pack fetch failed");
  }

  const data = await res.json();

  if (Array.isArray(data)) {
    writePackCatalogSnapshot(data);
    return data;
  }

  return [];
}

// 설치 상태
export async function getInstalled() {
  if (isCapacitorApp()) {
    const enabledLangs = await getEnabledMobileLanguages();
    let packs = readPackCatalogSnapshot();

    try {
      packs = await getPacks();
    } catch {
      // Fallback to the last known pack catalog so mobile can keep showing enabled languages offline.
    }

    const latestByLang = new Map<string, any>();

    for (const pack of packs) {
      const existing = latestByLang.get(pack.lang);

      if (!existing || compareVersionsDesc(existing.version, pack.version) > 0) {
        latestByLang.set(pack.lang, pack);
      }
    }

    return Array.from(latestByLang.values()).map((pack) => ({
      lang: pack.lang,
      version: pack.version,
      installed: enabledLangs.includes(pack.lang),
      lemma_installed: enabledLangs.includes(pack.lang),
    }));
  }

  return fetch(`${LOCAL_API}/lang/installed`).then(r => r.json());
}

// 설치
export async function installPack(pack: {
  lang: string;
  version: string;
  filename: string;
  download_url?: string;
}) {
  if (isCapacitorApp()) {
    await enableMobileLanguage(pack.lang);

    return {
      status: "ok",
      lang: pack.lang,
      version: pack.version,
      installed: true,
    };
  }

  return fetch(`${LOCAL_API}/lang/install`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(pack)
  }).then(r => r.json());
}

// 삭제
export async function uninstallPack(pack: {
  lang: string;
  version: string;
}) {
  if (isCapacitorApp()) {
    await disableMobileLanguage(pack.lang);

    return {
      status: "ok",
      lang: pack.lang,
      version: pack.version,
      installed: false,
    };
  }

  return fetch(`${LOCAL_API}/lang/uninstall`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(pack)
  }).then(r => r.json());
}

// progress
export async function getProgress(taskId: string) {
  return fetch(`${LOCAL_API}/lang/progress/${taskId}`).then(r => r.json());
}
