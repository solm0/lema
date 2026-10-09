import type {
  Annotation,
  LemmaData,
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
  writePackCatalogSnapshot,
} from "./packCatalogSnapshot";
import type { PackCatalogEntry } from "./packCatalogSnapshot";
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
import { GRADSHOW_MODE, GRADSHOW_USER } from "./gradshow/mode";
import {
  analyzeWithNativePack,
  canAnalyzeWithNativePack,
  canLookupWithNativePack,
  getInstalledNativePacks,
  getNativePackInstallProgress,
  getSupportedNativePackLanguages,
  installNativePack,
  lookupNativeLemma,
  lookupNativeLemmas,
  uninstallNativePack,
} from "./nativeLanguagePack";

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
  retry_after_seconds?: number;
};

export type ApiErrorDetail =
  | string
  | ApiErrorDetailObject
  | Array<{ msg?: string }>
  | undefined;

export type AuthApiResponse = {
  access_token?: string;
  detail?: ApiErrorDetail;
  message?: string;
  httpStatus: number;
  retryAfterSeconds?: number;
};

const AUTH_BURST_LIMIT = 5;
const AUTH_BURST_WINDOW_MS = 10_000;
let authRequestTimestamps: number[] = [];

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

function parseRetryAfter(value: string | null) {
  if (!value) return undefined;
  const seconds = Number.parseInt(value, 10);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
}

async function parseAuthResponse(res: Response): Promise<AuthApiResponse> {
  const payload = await res.json().catch(() => ({})) as Omit<AuthApiResponse, "httpStatus">;
  const parsedDetail = parseApiErrorDetail(payload.detail);
  const retryAfterSeconds =
    parseRetryAfter(res.headers.get("Retry-After"))
    ?? (typeof payload.detail === "object" && !Array.isArray(payload.detail)
      ? payload.detail?.retry_after_seconds
      : undefined);

  if (!res.ok && !payload.detail) {
    payload.detail = {
      code: res.status === 429 ? "too_many_requests" : "request_failed",
      message: res.status === 429 ? "too many requests" : "request failed",
    };
  } else if (parsedDetail?.code && typeof payload.detail === "object" && !Array.isArray(payload.detail)) {
    payload.detail = {
      ...payload.detail,
      code: parsedDetail.code,
    };
  }

  return {
    ...payload,
    httpStatus: res.status,
    retryAfterSeconds,
  };
}

function reserveAuthRequest(): number {
  const now = Date.now();
  authRequestTimestamps = authRequestTimestamps.filter(
    timestamp => timestamp > now - AUTH_BURST_WINDOW_MS,
  );

  if (authRequestTimestamps.length >= AUTH_BURST_LIMIT) {
    return Math.max(
      1,
      Math.ceil(
        (authRequestTimestamps[0] + AUTH_BURST_WINDOW_MS - now) / 1000,
      ),
    );
  }

  authRequestTimestamps.push(now);
  return 0;
}

async function authPost(
  path: string,
  body: Record<string, string>,
  { applyBurstLimit = true }: { applyBurstLimit?: boolean } = {},
) {
  if (applyBurstLimit && (typeof navigator === "undefined" || navigator.onLine)) {
    const retryAfterSeconds = reserveAuthRequest();
    if (retryAfterSeconds) {
      return {
        httpStatus: 429,
        retryAfterSeconds,
        detail: {
          code: "too_many_requests",
          message: "too many requests",
          retry_after_seconds: retryAfterSeconds,
        },
      } satisfies AuthApiResponse;
    }
  }

  const res = await centralFetch(`${CENTRAL_API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return parseAuthResponse(res);
}

export async function signup(email: string, password: string, name: string) {
  return authPost("/signup", { email, password, name });
}

export async function login(email:string,password:string){
  return authPost("/login", { email, password });
}

export async function requestReset(email:string){
  return authPost("/request-password-reset", { email });
}

export async function resetPassword(token:string,new_password:string){
  return authPost(
    "/reset-password",
    { token, new_password },
    { applyBurstLimit: false },
  );
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
  if (GRADSHOW_MODE) return GRADSHOW_USER;
  const token = getStoredToken();

  if (!token) {
    return null;
  }

  if (isTokenExpired(token)) {
    await clearStoredSession();
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
        await clearStoredSession();
        return null;
      }

      return hasStoredSession() ? getOfflineSessionUser() : null;
    }

    const data = await res.json() as User;
    await storeVerifiedSession(token, data);
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
  if (isCapacitorApp() && await canAnalyzeWithNativePack(language)) {
    return analyzeWithNativePack(blocks, language);
  }

  const remoteAnalysis = !isElectronApp();
  const headers = remoteAnalysis
    ? authHeaders()
    : { "Content-Type": "application/json" };

  if (!headers) {
    throw new Error("unauthorized");
  }

  const request = remoteAnalysis ? centralFetch : fetch;
  const res = await request(`${LOCAL_API}/analyze`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      blocks,
      language,
    }),
  });

  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new Error("unauthorized");
    }

    const payload = await res.json().catch(() => null) as {
      detail?: ApiErrorDetail;
    } | null;
    const detail = parseApiErrorDetail(payload?.detail);
    throw new Error(
      detail?.code || detail?.message || `analyze failed (${res.status})`,
    );
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

const MAX_LOOKUP_BATCH_ITEMS = 100;

export async function lemmaLookup(
  items: { lemma: string; pos: string }[],
  language: string
): Promise<Record<string, LemmaData>> {
  const output: Record<string, LemmaData> = {};
  const useNativePack =
    isCapacitorApp() && await canLookupWithNativePack(language);
  const profile = useNativePack ? await getOfflineLemmaProfile() : null;

  for (let start = 0; start < items.length; start += MAX_LOOKUP_BATCH_ITEMS) {
    const batch = items.slice(start, start + MAX_LOOKUP_BATCH_ITEMS);

    if (useNativePack && profile) {
      Object.assign(output, await lookupNativeLemmas(batch, language, profile));
      continue;
    }

    const headers = authHeaders() ?? {};
    const res = await fetch(`${LOCAL_API}/lookup_batch`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
      body: JSON.stringify({
        items: batch,
        language,
      }),
    });

    if (!res.ok) throw new Error("lookup_batch failed");
    Object.assign(output, await res.json() as Record<string, LemmaData>);
  }

  return output;
}

export async function lemmaLookupOne(
  item: { lemma:string; pos:string; },
  language: string
) {
  if (isCapacitorApp() && await canLookupWithNativePack(language)) {
    return lookupNativeLemma(
      item,
      language,
      await getOfflineLemmaProfile(),
    );
  }
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
  if (GRADSHOW_MODE) {
    await queueOfflineInterestToggle(key, next);
    return { ok: true, offline: true };
  }
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
  if (GRADSHOW_MODE) return getOfflineLemmaProfile();
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
  if (GRADSHOW_MODE) {
    await queueOfflineLemmaStateUpdate(key, update);
    return (await getOfflineLemmaProfile())[key];
  }
  const headers = authHeaders();
  if (!headers) throw new Error("not authenticated");

  await queueOfflineLemmaStateUpdate(key, update);
  const synced = await syncOfflineOutbox();
  if (synced) await invalidateLocalLemmaProfileCache();
  const profile = await getOfflineLemmaProfile();
  return profile[key];
}

export async function getInterests(): Promise<string[]> {
  if (GRADSHOW_MODE) return getOfflineInterestedKeys();
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
export async function getPacks(): Promise<PackCatalogEntry[]> {
  if (GRADSHOW_MODE) {
    return [{
      lang: "en",
      version: "1.1.2",
      lemma_filename: "en-v1.1.2-lemma.zip",
      lemma_download_url: "",
      tag: "gradshow",
      corpus: [{ "Data source": "Bundled exhibition pack" }, { "Corpora used": "English" }],
    }];
  }
  const res = await centralFetch(`${CENTRAL_API}/lang/packs`);

  if (!res.ok) {
    throw new Error("pack fetch failed");
  }

  const data: unknown = await res.json();

  if (Array.isArray(data)) {
    let packs = data as PackCatalogEntry[];
    if (isCapacitorApp()) {
      const supportedLanguages = new Set(await getSupportedNativePackLanguages());
      packs = packs.filter((pack) => supportedLanguages.has(pack.lang));
    }
    writePackCatalogSnapshot(packs);
    return packs;
  }

  return [];
}

// 설치 상태
export async function getInstalled() {
  if (GRADSHOW_MODE) {
    return [{
      lang: "en",
      version: "1.1.2",
      installed: true,
      lemma_installed: true,
      model_installed: false,
    }];
  }
  if (isCapacitorApp()) {
    return getInstalledNativePacks();
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
    return installNativePack(pack);
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
    await uninstallNativePack(pack);
    return { status: "ok" };
  }

  return fetch(`${LOCAL_API}/lang/uninstall`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(pack)
  }).then(r => r.json());
}

// progress
export async function getProgress(taskId: string) {
  if (isCapacitorApp()) {
    return getNativePackInstallProgress(taskId);
  }
  return fetch(`${LOCAL_API}/lang/progress/${taskId}`).then(r => r.json());
}
