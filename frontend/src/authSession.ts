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

  if (parts.length < 2) {
    return null;
  }

  try {
    return JSON.parse(decodeBase64Url(parts[1]));
  } catch {
    return null;
  }
}

function readStoredSession(): StoredAuthSession | null {
  if (!hasWindow()) {
    return null;
  }

  const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);

  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<StoredAuthSession>;

      if (typeof parsed.token === "string" && parsed.token.trim()) {
        return {
          token: parsed.token,
          user: parsed.user ?? null,
          lastVerifiedAt: parsed.lastVerifiedAt ?? null,
        };
      }
    } catch {
      window.localStorage.removeItem(SESSION_STORAGE_KEY);
    }
  }

  const legacyToken = window.localStorage.getItem(LEGACY_TOKEN_KEY);

  if (!legacyToken) {
    return null;
  }

  return {
    token: legacyToken,
    user: null,
    lastVerifiedAt: null,
  };
}

function writeStoredSession(session: StoredAuthSession | null) {
  if (!hasWindow()) {
    return;
  }

  if (!session) {
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
    window.localStorage.removeItem(LEGACY_TOKEN_KEY);
    return;
  }

  window.localStorage.setItem(LEGACY_TOKEN_KEY, session.token);
  window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
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

  if (typeof exp !== "number") {
    return true;
  }

  return exp * 1000 <= Date.now() + EXPIRY_SKEW_MS;
}

export function getStoredToken() {
  const session = readStoredSession();

  if (!session) {
    return null;
  }

  if (isTokenExpired(session.token)) {
    clearStoredSession();
    return null;
  }

  if (window.localStorage.getItem(LEGACY_TOKEN_KEY) !== session.token) {
    writeStoredSession(session);
  }

  return session.token;
}

export function getStoredUser() {
  return readStoredSession()?.user ?? null;
}

export function hasStoredSession() {
  return getStoredToken() !== null;
}

export function storeAccessToken(token: string) {
  const current = readStoredSession();

  const session = {
    token,
    user: current?.user ?? null,
    lastVerifiedAt: current?.lastVerifiedAt ?? null,
  };
  writeStoredSession(session);
  syncElectronLibraryUser(session);
}

export function storeVerifiedSession(token: string, user: User) {
  const session = {
    token,
    user,
    lastVerifiedAt: new Date().toISOString(),
  };
  writeStoredSession(session);
  syncElectronLibraryUser(session);
}

export function updateStoredUser(user: User) {
  const token = getStoredToken();

  if (!token) {
    return;
  }

  const current = readStoredSession();

  const session = {
    token,
    user,
    lastVerifiedAt: current?.lastVerifiedAt ?? null,
  };
  writeStoredSession(session);
  syncElectronLibraryUser(session);
}

export function clearStoredSession() {
  writeStoredSession(null);
  syncElectronLibraryUser(null);
}

export function getOfflineSessionUser() {
  if (!isElectronApp() && !isCapacitorApp()) {
    return null;
  }

  const token = getStoredToken();

  if (!token) {
    return null;
  }

  const user = getStoredUser();
  syncElectronLibraryUser({
    token,
    user,
    lastVerifiedAt: readStoredSession()?.lastVerifiedAt ?? null,
  });
  return user;
}
