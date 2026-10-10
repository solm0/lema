import type { LemmaData, TextAnalysisResult, TextBlock } from "../src/components/pageTypes";

const DEFAULT_INSTALL_URL = "https://lema.solmi.wiki";
const DEFAULT_LOCAL_API = "http://localhost:8010/api";
const FALLBACK_LOCAL_APIS = [
  "http://localhost:8010/api",
  "http://127.0.0.1:8010/api",
  "http://localhost:8000/api",
  "http://127.0.0.1:8000/api",
];
const DEFAULT_DEEPLINK_BASE = "lema://page/";

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function getEnv(name: string, fallback: string) {
  const value = import.meta.env[name];
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

export const EXTENSION_INSTALL_URL = getEnv(
  "VITE_EXTENSION_INSTALL_URL",
  DEFAULT_INSTALL_URL,
);

export const EXTENSION_LOCAL_API = trimTrailingSlash(
  getEnv("VITE_EXTENSION_LOCAL_API", DEFAULT_LOCAL_API),
);

const localApiCandidates = Array.from(
  new Set(
    [
      import.meta.env.VITE_EXTENSION_LOCAL_API,
      import.meta.env.VITE_LOCAL_API,
      EXTENSION_LOCAL_API,
      ...FALLBACK_LOCAL_APIS,
    ]
      .filter((value): value is string => typeof value === "string" && value.length > 0)
      .map(trimTrailingSlash),
  ),
);

export const EXTENSION_DEEPLINK_BASE = getEnv(
  "VITE_EXTENSION_DEEPLINK_BASE",
  DEFAULT_DEEPLINK_BASE,
);

type ExtensionResponse = {
  ok: boolean;
  status: number;
  text: string;
};

type ErrorPayload = {
  code: string | null;
  message: string | null;
};

export class ExtensionRequestError extends Error {
  status: number;
  code: string | null;

  constructor(status: number, payload: ErrorPayload) {
    super(payload.message || "request failed");
    this.name = "ExtensionRequestError";
    this.status = status;
    this.code = payload.code;
  }
}

export type InstalledPack = {
  lang: string;
  version: string;
  installed: boolean;
};

export type ExtensionStatus = {
  running: true;
  signed_in: boolean;
};

let activeLocalApi: string | null = null;

function isExtensionContextInvalidatedError(error: unknown) {
  return error instanceof Error && error.message.includes("Extension context invalidated");
}

async function sendMessage<T>(message: unknown) {
  try {
    return await chrome.runtime.sendMessage(message) as T;
  } catch (error) {
    if (isExtensionContextInvalidatedError(error)) {
      throw error;
    }

    throw error;
  }
}

async function probeSpecificLocalApi(localApi: string) {
  const result = await sendMessage<{ ok: boolean }>({
    type: "lema:probe-local",
    input: {
      localApi,
    },
  });

  return result.ok;
}

function parseErrorPayload(text: string): ErrorPayload {
  if (!text) return { code: null, message: null };

  try {
    const body = JSON.parse(text) as {
      detail?:
        | string
        | { code?: string; message?: string }
        | Array<{ msg?: string }>;
      code?: string;
      message?: string;
    };
    const detail = body.detail;

    if (typeof detail === "string") {
      return { code: body.code ?? null, message: detail };
    }

    if (Array.isArray(detail)) {
      return {
        code: body.code ?? null,
        message: detail.find((item) => item.msg)?.msg ?? null,
      };
    }

    if (detail && typeof detail === "object") {
      return {
        code: detail.code ?? body.code ?? null,
        message: detail.message ?? body.message ?? null,
      };
    }

    return {
      code: body.code ?? null,
      message: body.message ?? null,
    };
  } catch {
    return { code: null, message: text };
  }
}

async function parseResponse<T>(response: ExtensionResponse) {
  if (!response.ok) {
    throw new ExtensionRequestError(response.status, parseErrorPayload(response.text));
  }

  if (!response.text) {
    return null as T;
  }

  return JSON.parse(response.text) as T;
}

export async function probeLocalApi() {
  for (const candidate of localApiCandidates) {
    const ok = await probeSpecificLocalApi(candidate);
    if (!ok) continue;

    activeLocalApi = candidate;
    return true;
  }

  return false;
}

export async function extensionFetch<T>(url: string, init?: RequestInit) {
  const response = await sendMessage<ExtensionResponse>({
    type: "lema:request",
    input: {
      url,
      init,
    },
  });

  return parseResponse<T>(response);
}

async function extensionFetchWithLocalFallback<T>(
  path: string,
  initFactory?: (localApi: string) => RequestInit | Promise<RequestInit> | undefined,
) {
  const candidates = activeLocalApi
    ? [activeLocalApi, ...localApiCandidates.filter((candidate) => candidate !== activeLocalApi)]
    : localApiCandidates;

  let lastError: unknown = null;

  for (const candidate of candidates) {
    try {
      const init = initFactory ? await initFactory(candidate) : undefined;
      const result = await extensionFetch<T>(`${candidate}${path}`, init);
      activeLocalApi = candidate;
      return result;
    } catch (error) {
      // A response from the local API is authoritative. Trying another port
      // after a 4xx/5xx response would hide that useful error behind a later
      // connection failure from an inactive fallback port.
      if (error instanceof ExtensionRequestError && error.status !== 0) {
        throw error;
      }
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("local api unavailable");
}

export async function analyzeElementText(text: string, language: string) {
  return extensionFetchWithLocalFallback<{ blocks: TextBlock[] }>("/analyze", () => ({
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      blocks: [{ text }],
      language,
    }),
  }));
}

export async function analyzeTextBlocks(blocks: string[], language: string) {
  return extensionFetchWithLocalFallback<{ blocks: TextBlock[] }>("/analyze", () => ({
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      blocks: blocks.map((text) => ({ text })),
      language,
    }),
  }));
}

export async function getInstalledLanguages() {
  return extensionFetchWithLocalFallback<InstalledPack[]>("/lang/installed", () => ({
    method: "GET",
  }));
}

export async function getExtensionStatus() {
  return extensionFetchWithLocalFallback<ExtensionStatus>("/extension/status", () => ({
    method: "GET",
  }));
}

export async function lookupBatch(blocks: TextBlock[], language: string) {
  const seen = new Set<string>();
  const items: Array<{ lemma: string; pos: string }> = [];

  blocks.forEach((block) => {
    block.tokens?.forEach((token) => {
      if (!token.lemma || !token.pos) return;

      const key = `${token.lemma}_${token.pos}`;
      if (seen.has(key)) return;

      seen.add(key);
      items.push({
        lemma: token.lemma,
        pos: token.pos,
      });
    });
  });

  if (items.length === 0) {
    return {} as Record<string, LemmaData>;
  }

  return extensionFetchWithLocalFallback<Record<string, LemmaData>>("/lookup_batch", () => ({
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      items,
      language,
    }),
  }));
}

export async function lookupLemma(lemma: string, pos: string, language: string) {
  return extensionFetchWithLocalFallback<LemmaData>("/lookup", () => ({
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      lemma,
      pos,
      language,
    }),
  }));
}

export async function saveAnalyzedPage(
  result: TextAnalysisResult,
  name: string,
  language: string,
  sourceUrl: string,
) {
  return extensionFetchWithLocalFallback<{ id: string }>("/extension/pages", () => ({
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      result,
      name,
      notebook_id: null,
      language,
      source: "chrome",
      metadata: sourceUrl ? [sourceUrl] : [],
    }),
  }));
}

export async function openInstallPage() {
  await sendMessage({
    type: "lema:open-url",
    input: {
      url: EXTENSION_INSTALL_URL,
    },
  });
}

function openDeepLinkInPage(url: string) {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.style.display = "none";
  document.documentElement.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

export async function openSavedPage(pageId: string) {
  const url = `${EXTENSION_DEEPLINK_BASE}${pageId}`;

  try {
    openDeepLinkInPage(url);
  } catch {
    await sendMessage({
      type: "lema:open-url",
      input: {
        url,
      },
    });
  }
}
