import { registerPlugin } from "@capacitor/core";
import { isCapacitorApp, isElectronApp } from "./platform";
import type { User } from "./types";

const SESSION_STORAGE_KEY = "auth-session-v1";
const LEGACY_TOKEN_KEY = "token";
const EXPIRY_SKEW_MS = 30_000;

type StoredAuthSession = {
  token: string;
  user: User | null;
  lastVerifiedAt: string | null;
};

type LemaSecureStoragePlugin = {
  get: () => Promise<{ value: string | null }>;
  set: (options: { value: string }) => Promise<void>;
  clear: () => Promise<void>;
};

const NativeSecureStorage = registerPlugin<LemaSecureStoragePlugin>("LemaSecureStorage");
let mobileSession: StoredAuthSession | null = null;
let mobileInitialization: Promise<void> | null = null;

function hasWindow() {
  return typeof window !== "undefined";
}

function decodeBase64Url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - (normalized.length % 4)) % 4);
  return atob(normalized + padding);
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length < 2) return null;

  try {
    return JSON.parse(decodeBase64Url(parts[1]));
  } catch {
    return null;
  }
}

function parseStoredSession(raw: string | null): StoredAuthSession | null {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<StoredAuthSession>;
    if (typeof parsed.token === "string" && parsed.token.trim()) {
      return {
        token: parsed.token,
        user: parsed.user ?? null,
        lastVerifiedAt:
          typeof parsed.lastVerifiedAt === "string" ? parsed.lastVerifiedAt : null,
      };
    }
  } catch {
    return null;
  }

  return null;
}

function readStoredSession(): StoredAuthSession | null {
  if (!hasWindow()) return null;
  if (isCapacitorApp()) return mobileSession;

  const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
  const session = parseStoredSession(raw);
  if (session) return session;
  if (raw) window.localStorage.removeItem(SESSION_STORAGE_KEY);

  const legacyToken = window.localStorage.getItem(LEGACY_TOKEN_KEY);
  if (!legacyToken) return null;

  return {
    token: legacyToken,
    user: null,
    lastVerifiedAt: null,
  };
}

function writeBrowserStoredSession(session: StoredAuthSession | null) {
  if (!hasWindow()) return;

  if (!session) {
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
    window.localStorage.removeItem(LEGACY_TOKEN_KEY);
    return;
  }

  window.localStorage.setItem(LEGACY_TOKEN_KEY, session.token);
  window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
}

async function writeStoredSession(session: StoredAuthSession | null) {
  if (isCapacitorApp()) {
    if (session) {
      await NativeSecureStorage.set({ value: JSON.stringify(session) });
      mobileSession = session;
    } else {
      mobileSession = null;
      await NativeSecureStorage.clear();
    }
    return;
  }

  writeBrowserStoredSession(session);
}

function syncElectronLibraryUser(session: StoredAuthSession | null) {
  if (!isElectronApp()) return;

  const userId = session?.user?.id;
  void window.electronAPI?.setActiveLibraryUser?.(
    typeof userId === "number" && Number.isInteger(userId) && userId > 0 ? userId : null,
  ).catch(() => undefined);
}

export function isTokenExpired(token: string) {
  const payload = decodeJwtPayload(token);
  const exp = payload?.exp;
  if (typeof exp !== "number") return true;
  return exp * 1000 <= Date.now() + EXPIRY_SKEW_MS;
}

export function initializeAuthSession() {
  if (!isCapacitorApp()) return Promise.resolve();
  if (mobileInitialization) return mobileInitialization;

  mobileInitialization = (async () => {
    // Mobile starts directly on secure storage. There are no production users
    // whose legacy localStorage session needs to be migrated.
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
    window.localStorage.removeItem(LEGACY_TOKEN_KEY);

    const { value } = await NativeSecureStorage.get();
    const session = parseStoredSession(value);

    if (!session || isTokenExpired(session.token)) {
      mobileSession = null;
      if (value) await NativeSecureStorage.clear();
      return;
    }

    mobileSession = session;
  })();

  return mobileInitialization;
}

export function getStoredToken() {
  const session = readStoredSession();
  if (!session) return null;

  if (isTokenExpired(session.token)) {
    void clearStoredSession().catch(() => undefined);
    return null;
  }

  if (
    !isCapacitorApp()
    && window.localStorage.getItem(LEGACY_TOKEN_KEY) !== session.token
  ) {
    writeBrowserStoredSession(session);
  }

  return session.token;
}

export function getStoredUser() {
  return readStoredSession()?.user ?? null;
}

export function hasStoredSession() {
  return getStoredToken() !== null;
}

export async function storeAccessToken(token: string) {
  const current = readStoredSession();
  const session = {
    token,
    user: current?.user ?? null,
    lastVerifiedAt: current?.lastVerifiedAt ?? null,
  };
  await writeStoredSession(session);
  syncElectronLibraryUser(session);
}

export async function storeVerifiedSession(token: string, user: User) {
  const session = {
    token,
    user,
    lastVerifiedAt: new Date().toISOString(),
  };
  await writeStoredSession(session);
  syncElectronLibraryUser(session);
}

export async function updateStoredUser(user: User) {
  const token = getStoredToken();
  if (!token) return;

  const current = readStoredSession();
  const session = {
    token,
    user,
    lastVerifiedAt: current?.lastVerifiedAt ?? null,
  };
  await writeStoredSession(session);
  syncElectronLibraryUser(session);
}

export async function clearStoredSession() {
  await writeStoredSession(null);
  syncElectronLibraryUser(null);
}

export function getOfflineSessionUser() {
  if (!isElectronApp() && !isCapacitorApp()) return null;

  const token = getStoredToken();
  if (!token) return null;

  const user = getStoredUser();
  syncElectronLibraryUser({
    token,
    user,
    lastVerifiedAt: readStoredSession()?.lastVerifiedAt ?? null,
  });
  return user;
}
