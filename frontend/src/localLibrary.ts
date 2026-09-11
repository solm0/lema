import { registerPlugin } from "@capacitor/core";
import type { Annotation, PageSource, TextAnalysisResult } from "./components/pageTypes";
import type { TimelineItem } from "./types";
import { getStoredUser } from "./authSession";
import { isCapacitorApp, isElectronApp } from "./platform";

export type LibraryId = string;

export type LocalPageSummary = {
  id: LibraryId;
  name: string;
  created_at: string;
  updated_at?: string;
  notebook_id?: LibraryId | null;
  language: string;
  source?: string;
  metadata?: string[];
};

export type LocalNotebook = {
  id: LibraryId;
  name: string;
  created_at: string;
  updated_at?: string;
};

export type LocalPageDetail = LocalPageSummary & {
  result: TextAnalysisResult;
  annotations: Annotation[];
};

export type LibraryBundle = {
  format: "lema-library";
  version: number;
  library_id: string;
  exported_at: string;
  notebooks: Array<Record<string, unknown>>;
  pages: Array<Record<string, unknown>>;
  annotations: Array<Record<string, unknown>>;
};

export type ImportResult = {
  notebooks: number;
  pages: number;
  annotations: number;
  conflicts: number;
};

type LemaLibraryPlugin = {
  activateProfile: (options: { user_id: string }) => Promise<void>;
  listPages: () => Promise<{ items: LocalPageSummary[] }>;
  listNotebooks: () => Promise<{ items: LocalNotebook[] }>;
  getPage: (options: { id: string }) => Promise<LocalPageDetail>;
  createPage: (options: { page: Record<string, unknown> }) => Promise<{ id: string }>;
  createNotebook: (options: { name: string }) => Promise<LocalNotebook>;
  renameItem: (options: { type: "page" | "notebook"; id: string; name: string }) => Promise<void>;
  deleteItem: (options: { type: "page" | "notebook"; id: string }) => Promise<void>;
  movePages: (options: { page_ids: string[]; notebook_id: string | null }) => Promise<void>;
  updateMetadata: (options: { id: string; metadata: string[] }) => Promise<{ metadata: string[] }>;
  listAnnotations: () => Promise<{ items: TimelineItem[]; next_cursor: null }>;
  createAnnotation: (options: { annotation: Annotation }) => Promise<Annotation>;
  updateAnnotation: (options: { id: string; content: string }) => Promise<Annotation>;
  deleteAnnotation: (options: { id: string }) => Promise<void>;
  getMeta: (options: { key: string }) => Promise<{ value: string | null }>;
  setMeta: (options: { key: string; value: string }) => Promise<void>;
  exportLibrary: () => Promise<{ ok: boolean }>;
  importLibrary: () => Promise<ImportResult>;
  mergeBundle: (options: { bundle: LibraryBundle }) => Promise<ImportResult>;
};

const NativeLibrary = registerPlugin<LemaLibraryPlugin>("LemaLibrary");
const ELECTRON_LIBRARY_API = "http://localhost:8010/api/library";
let activeMobileUserId: string | null = null;
let mobileActivation: Promise<void> | null = null;

function currentLibraryUserId() {
  const id = getStoredUser()?.id;
  if (typeof id !== "number" || !Number.isInteger(id) || id <= 0) {
    throw new Error("A verified user is required to access the local library.");
  }
  return String(id);
}

async function prepareLocalLibrary() {
  if (!isCapacitorApp()) return;
  const userId = currentLibraryUserId();
  if (activeMobileUserId === userId) return;
  if (!mobileActivation) {
    mobileActivation = NativeLibrary.activateProfile({ user_id: userId })
      .then(() => {
        activeMobileUserId = userId;
      })
      .finally(() => {
        mobileActivation = null;
      });
  }
  await mobileActivation;
  if (activeMobileUserId !== userId) await prepareLocalLibrary();
}

async function electronRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const userId = currentLibraryUserId();
  const response = await fetch(`${ELECTRON_LIBRARY_API}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-Lema-User-Id": userId,
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.detail || `Local library request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}

function assertNativePlatform() {
  if (!isElectronApp() && !isCapacitorApp()) {
    throw new Error("The local library is only available in the Lema desktop and Android apps.");
  }
}

export async function listLocalPages(): Promise<LocalPageSummary[]> {
  assertNativePlatform();
  await prepareLocalLibrary();
  if (isElectronApp()) return electronRequest<LocalPageSummary[]>("/pages");
  return (await NativeLibrary.listPages()).items;
}

export async function listLocalNotebooks(): Promise<LocalNotebook[]> {
  assertNativePlatform();
  await prepareLocalLibrary();
  if (isElectronApp()) return electronRequest<LocalNotebook[]>("/notebooks");
  return (await NativeLibrary.listNotebooks()).items;
}

export async function getLocalPage(id: string): Promise<LocalPageDetail> {
  assertNativePlatform();
  await prepareLocalLibrary();
  if (isElectronApp()) return electronRequest<LocalPageDetail>(`/pages/${encodeURIComponent(id)}`);
  return NativeLibrary.getPage({ id });
}

export async function createLocalPage(input: {
  result: TextAnalysisResult;
  name: string;
  notebookId: string | null;
  language: string;
  source?: PageSource;
  metadata?: string[];
}): Promise<string> {
  assertNativePlatform();
  await prepareLocalLibrary();
  const page = {
    result: input.result,
    name: input.name,
    notebook_id: input.notebookId,
    language: input.language,
    source: input.source ?? "user",
    metadata: input.metadata ?? [],
  };
  if (isElectronApp()) {
    return (await electronRequest<{ id: string }>("/pages", {
      method: "POST",
      body: JSON.stringify(page),
    })).id;
  }
  return (await NativeLibrary.createPage({ page })).id;
}

export async function createLocalNotebook(name: string): Promise<LocalNotebook> {
  assertNativePlatform();
  await prepareLocalLibrary();
  if (isElectronApp()) {
    return electronRequest<LocalNotebook>("/notebooks", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
  }
  return NativeLibrary.createNotebook({ name });
}

export async function renameLocalItem(
  type: "page" | "notebook",
  id: string,
  name: string,
) {
  assertNativePlatform();
  await prepareLocalLibrary();
  if (isElectronApp()) {
    await electronRequest(type === "page" ? `/pages/${id}` : `/notebooks/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    });
    return;
  }
  await NativeLibrary.renameItem({ type, id, name });
}

export async function deleteLocalItem(type: "page" | "notebook", id: string) {
  assertNativePlatform();
  await prepareLocalLibrary();
  if (isElectronApp()) {
    await electronRequest(type === "page" ? `/pages/${id}` : `/notebooks/${id}`, {
      method: "DELETE",
    });
    return;
  }
  await NativeLibrary.deleteItem({ type, id });
}

export async function moveLocalPages(pageIds: string[], notebookId: string | null) {
  assertNativePlatform();
  await prepareLocalLibrary();
  if (isElectronApp()) {
    await electronRequest("/pages/move", {
      method: "POST",
      body: JSON.stringify({ page_ids: pageIds, notebook_id: notebookId }),
    });
    return;
  }
  await NativeLibrary.movePages({ page_ids: pageIds, notebook_id: notebookId });
}

export async function setLocalPageMetadata(id: string, metadata: string[]) {
  assertNativePlatform();
  await prepareLocalLibrary();
  if (isElectronApp()) {
    return electronRequest<{ metadata: string[] }>(`/pages/${id}/metadata`, {
      method: "PUT",
      body: JSON.stringify({ metadata }),
    });
  }
  return NativeLibrary.updateMetadata({ id, metadata });
}

export async function listLocalAnnotations(): Promise<TimelineItem[]> {
  assertNativePlatform();
  await prepareLocalLibrary();
  if (isElectronApp()) {
    return (await electronRequest<{ items: TimelineItem[] }>("/annotations")).items;
  }
  return (await NativeLibrary.listAnnotations()).items;
}

export async function createLocalAnnotation(annotation: Annotation) {
  assertNativePlatform();
  await prepareLocalLibrary();
  if (isElectronApp()) {
    return electronRequest<Annotation>("/annotations", {
      method: "POST",
      body: JSON.stringify(annotation),
    });
  }
  return NativeLibrary.createAnnotation({ annotation });
}

export async function updateLocalAnnotation(id: string, content: string) {
  assertNativePlatform();
  await prepareLocalLibrary();
  if (isElectronApp()) {
    return electronRequest<Annotation>(`/annotations/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ content }),
    });
  }
  return NativeLibrary.updateAnnotation({ id, content });
}

export async function deleteLocalAnnotation(id: string) {
  assertNativePlatform();
  await prepareLocalLibrary();
  if (isElectronApp()) {
    await electronRequest(`/annotations/${id}`, { method: "DELETE" });
    return;
  }
  await NativeLibrary.deleteAnnotation({ id });
}

export async function getLocalLibraryMeta(key: string) {
  assertNativePlatform();
  await prepareLocalLibrary();
  if (isElectronApp()) {
    return (await electronRequest<{ value: string | null }>(`/meta/${encodeURIComponent(key)}`)).value;
  }
  return (await NativeLibrary.getMeta({ key })).value;
}

export async function setLocalLibraryMeta(key: string, value: string) {
  assertNativePlatform();
  await prepareLocalLibrary();
  if (isElectronApp()) {
    await electronRequest(`/meta/${encodeURIComponent(key)}`, {
      method: "PUT",
      body: JSON.stringify({ value }),
    });
    return;
  }
  await NativeLibrary.setMeta({ key, value });
}

export async function mergeLibraryBundle(bundle: LibraryBundle): Promise<ImportResult> {
  assertNativePlatform();
  await prepareLocalLibrary();
  if (isElectronApp()) {
    return electronRequest<ImportResult>("/import", {
      method: "POST",
      body: JSON.stringify(bundle),
    });
  }
  return NativeLibrary.mergeBundle({ bundle });
}

export async function exportLocalLibrary() {
  assertNativePlatform();
  await prepareLocalLibrary();
  if (isElectronApp()) {
    const bundle = await electronRequest<LibraryBundle>("/export");
    return window.electronAPI?.saveLibraryExport?.(bundle);
  }
  return NativeLibrary.exportLibrary();
}

export async function importLocalLibrary(): Promise<ImportResult | null> {
  assertNativePlatform();
  await prepareLocalLibrary();
  if (isElectronApp()) {
    const bundle = await window.electronAPI?.openLibraryImport?.();
    if (!bundle) return null;
    return mergeLibraryBundle(bundle as LibraryBundle);
  }
  return NativeLibrary.importLibrary();
}
