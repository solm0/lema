import { Preferences } from "@capacitor/preferences";
import { getStoredToken, getStoredUser } from "./authSession";
import { getAppPlatform, isCapacitorApp, isElectronApp } from "./platform";
import { centralFetch } from "./network";
import type { UserLemmaState } from "./components/pageTypes";
import { GRADSHOW_MODE, GRADSHOW_USER } from "./gradshow/mode";

type PendingInterestToggle = {
  id: string;
  key: string;
  next: boolean;
  created_at: string;
};

type PendingLemmaStateUpdate = {
  id: string;
  key: string;
  exposure_count?: number;
  is_known?: boolean;
  created_at: string;
};

type UserVocabularyState = {
  interestedSnapshot: string[];
  interestOutbox: PendingInterestToggle[];
  profileSnapshot: Record<string, UserLemmaState>;
  stateOutbox: PendingLemmaStateUpdate[];
};

type VocabularySyncState = {
  version: 3;
  users: Record<string, UserVocabularyState>;
};

const DEFAULT_STATE: VocabularySyncState = { version: 3, users: {} };
const MOBILE_STORAGE_KEY = "lema.vocabulary-sync.v3";
const LEGACY_MOBILE_STORAGE_KEY = "lema.favorite-sync.v2";
const DEFAULT_CENTRAL_API = "https://lema.solmi.wiki/api";
export const VOCABULARY_SYNC_EVENT = "lema:vocabulary-sync";

let stateCache: VocabularySyncState | null = null;
let syncPromise: Promise<boolean> | null = null;
let stateMutationPromise: Promise<void> = Promise.resolve();

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

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
  return trimTrailingSlash(import.meta.env.VITE_CENTRAL_API ?? DEFAULT_CENTRAL_API);
}

const CENTRAL_API = resolveCentralApi();

function currentUserId() {
  if (GRADSHOW_MODE) return String(GRADSHOW_USER.id);
  const id = getStoredUser()?.id;
  return typeof id === "number" ? String(id) : null;
}

function emptyUserState(): UserVocabularyState {
  return {
    interestedSnapshot: [],
    interestOutbox: [],
    profileSnapshot: {},
    stateOutbox: [],
  };
}

function normalizeUserState(value: unknown): UserVocabularyState {
  if (!value || typeof value !== "object") return emptyUserState();
  const candidate = value as {
    interestedSnapshot?: string[];
    interestOutbox?: PendingInterestToggle[];
    snapshot?: string[];
    outbox?: PendingInterestToggle[];
    profileSnapshot?: Record<string, UserLemmaState>;
    stateOutbox?: PendingLemmaStateUpdate[];
  };
  return {
    interestedSnapshot: Array.isArray(candidate.interestedSnapshot)
      ? [...candidate.interestedSnapshot]
      : Array.isArray(candidate.snapshot) ? [...candidate.snapshot] : [],
    interestOutbox: Array.isArray(candidate.interestOutbox)
      ? candidate.interestOutbox.map((item) => ({ ...item, id: String(item.id) }))
      : Array.isArray(candidate.outbox)
        ? candidate.outbox.map((item) => ({ ...item, id: String(item.id) }))
        : [],
    profileSnapshot:
      candidate.profileSnapshot && typeof candidate.profileSnapshot === "object"
        ? clone(candidate.profileSnapshot)
        : {},
    stateOutbox: Array.isArray(candidate.stateOutbox)
      ? candidate.stateOutbox.map((item) => ({ ...item, id: String(item.id) }))
      : [],
  };
}

function normalizeState(value: unknown): VocabularySyncState {
  if (!value || typeof value !== "object") return clone(DEFAULT_STATE);
  const candidate = value as {
    version?: number;
    users?: Record<string, unknown>;
    snapshot?: { favoriteLemmaKeys?: string[] };
    outbox?: { favoriteToggles?: PendingInterestToggle[] };
  };

  if ((candidate.version === 2 || candidate.version === 3) && candidate.users) {
    return {
      version: 3,
      users: Object.fromEntries(
        Object.entries(candidate.users).map(([userId, state]) => [
          userId,
          normalizeUserState(state),
        ]),
      ),
    };
  }

  const userId = currentUserId();
  if (!userId) return clone(DEFAULT_STATE);
  return {
    version: 3,
    users: {
      [userId]: normalizeUserState({
        snapshot: candidate.snapshot?.favoriteLemmaKeys,
        outbox: candidate.outbox?.favoriteToggles,
      }),
    },
  };
}

async function loadState(): Promise<VocabularySyncState> {
  if (stateCache) return clone(stateCache);
  let loaded: unknown = null;
  if (isElectronApp()) {
    loaded = await window.electronAPI?.readOfflineState?.();
  } else if (isCapacitorApp()) {
    let stored = await Preferences.get({ key: MOBILE_STORAGE_KEY });
    if (!stored.value) stored = await Preferences.get({ key: LEGACY_MOBILE_STORAGE_KEY });
    if (stored.value) {
      try { loaded = JSON.parse(stored.value); } catch { loaded = null; }
    }
  }
  stateCache = normalizeState(loaded);
  return clone(stateCache);
}

async function saveState(state: VocabularySyncState) {
  stateCache = clone(state);
  if (isElectronApp()) {
    await window.electronAPI?.writeOfflineState?.(stateCache);
  } else if (isCapacitorApp()) {
    await Preferences.set({ key: MOBILE_STORAGE_KEY, value: JSON.stringify(stateCache) });
  }
}

function mutateState(mutation: (state: VocabularySyncState) => void) {
  const nextMutation = stateMutationPromise.then(async () => {
    const state = await loadState();
    mutation(state);
    await saveState(state);
  });
  stateMutationPromise = nextMutation.catch(() => undefined);
  return nextMutation;
}

function userState(state: VocabularySyncState, userId: string) {
  state.users[userId] ??= emptyUserState();
  return state.users[userId];
}

function mergeInterestedKeys(base: string[], toggles: PendingInterestToggle[]) {
  const keys = new Set(base);
  for (const toggle of toggles) {
    if (toggle.next) keys.add(toggle.key);
    else keys.delete(toggle.key);
  }
  return Array.from(keys).sort((a, b) => a.localeCompare(b));
}

export async function cacheInterestedLemmaKeys(keys: string[]) {
  const userId = currentUserId();
  if (!userId) return;
  await mutateState((state) => {
    const vocabulary = userState(state, userId);
    vocabulary.interestedSnapshot = [...keys];
    for (const [key, item] of Object.entries(vocabulary.profileSnapshot)) {
      vocabulary.profileSnapshot[key] = {
        ...item,
        is_interested: keys.includes(key),
      };
    }
  });
}

export async function cacheLemmaProfile(items: UserLemmaState[]) {
  const userId = currentUserId();
  if (!userId) return;
  await mutateState((state) => {
    const vocabulary = userState(state, userId);
    const pendingKeys = new Set(vocabulary.stateOutbox.map((item) => item.key));
    const pendingItems = Object.fromEntries(
      Object.entries(vocabulary.profileSnapshot).filter(([key]) => pendingKeys.has(key)),
    );
    vocabulary.profileSnapshot = {
      ...Object.fromEntries(items.map((item) => [item.key, { ...item }])),
      ...pendingItems,
    };
    vocabulary.interestedSnapshot = items
      .filter((item) => item.is_interested)
      .map((item) => item.key);
  });
}

export async function getOfflineLemmaProfile() {
  const userId = currentUserId();
  if (!userId) return {};
  const state = await loadState();
  return clone(userState(state, userId).profileSnapshot);
}

export async function getOfflineInterestedKeys() {
  const userId = currentUserId();
  if (!userId) return [];
  const state = await loadState();
  const vocabulary = userState(state, userId);
  return mergeInterestedKeys(vocabulary.interestedSnapshot, vocabulary.interestOutbox);
}

export async function queueOfflineInterestToggle(key: string, next: boolean) {
  const userId = currentUserId();
  if (!userId) throw new Error("not authenticated");
  await mutateState((state) => {
    const vocabulary = userState(state, userId);
    const remaining = vocabulary.interestOutbox.filter((item) => item.key !== key);
    vocabulary.interestOutbox = [...remaining, {
      id: crypto.randomUUID(),
      key,
      next,
      created_at: new Date().toISOString(),
    }];
    const existing = vocabulary.profileSnapshot[key];
    vocabulary.profileSnapshot[key] = {
      key,
      exposure_count: existing?.exposure_count ?? 0,
      is_known: existing?.is_known ?? false,
      is_interested: next,
      updated_at: new Date().toISOString(),
    };
  });
}

export async function queueOfflineLemmaStateUpdate(
  key: string,
  update: { exposure_count?: number; is_known?: boolean },
) {
  const userId = currentUserId();
  if (!userId) throw new Error("not authenticated");
  await mutateState((state) => {
    const vocabulary = userState(state, userId);
    const existing = vocabulary.profileSnapshot[key];
    const now = new Date().toISOString();
    vocabulary.profileSnapshot[key] = {
      key,
      exposure_count: Math.min(
        10,
        Math.max(update.exposure_count ?? existing?.exposure_count ?? 0, 0),
      ),
      is_known: update.is_known ?? existing?.is_known ?? false,
      is_interested: existing?.is_interested ?? false,
      updated_at: now,
    };
    vocabulary.stateOutbox = [
      ...vocabulary.stateOutbox.filter((item) => item.key !== key),
      {
        id: crypto.randomUUID(),
        key,
        ...update,
        created_at: now,
      },
    ];
  });
}

async function syncVocabularyOutboxOnce() {
  if (GRADSHOW_MODE) return true;
  if (typeof navigator !== "undefined" && !navigator.onLine) return false;
  const userId = currentUserId();
  const token = getStoredToken();
  if (!userId || !token) return true;

  let changed = false;
  while (true) {
    await stateMutationPromise;
    const pendingState = await loadState();
    const pendingVocabulary = userState(pendingState, userId);
    const toggles = [...pendingVocabulary.interestOutbox];
    const updates = [...pendingVocabulary.stateOutbox];
    if (toggles.length === 0 && updates.length === 0) break;

    for (const toggle of toggles) {
      const response = await centralFetch(`${CENTRAL_API}/lemma/interest`, {
        method: toggle.next ? "POST" : "DELETE",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ key: toggle.key }),
      }).catch(() => null);
      if (!response?.ok) return false;

      await mutateState((latestState) => {
        const latestVocabulary = userState(latestState, userId);
        const hasNewerToggle = latestVocabulary.interestOutbox.some(
          (item) => item.key === toggle.key && item.id !== toggle.id,
        );
        latestVocabulary.interestOutbox = latestVocabulary.interestOutbox.filter(
          (item) => item.id !== toggle.id,
        );
        if (!hasNewerToggle) {
          latestVocabulary.interestedSnapshot = mergeInterestedKeys(
            latestVocabulary.interestedSnapshot,
            [toggle],
          );
          const existing = latestVocabulary.profileSnapshot[toggle.key];
          latestVocabulary.profileSnapshot[toggle.key] = {
            key: toggle.key,
            exposure_count: existing?.exposure_count ?? 0,
            is_known: existing?.is_known ?? false,
            is_interested: toggle.next,
            updated_at: toggle.created_at,
          };
        }
      });
      changed = true;
    }

    for (const update of updates) {
      const response = await centralFetch(`${CENTRAL_API}/lemma/state`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          key: update.key,
          exposure_count: update.exposure_count,
          is_known: update.is_known,
        }),
      }).catch(() => null);
      if (!response?.ok) return false;

      const item = await response.json() as UserLemmaState;
      await mutateState((latestState) => {
        const latestVocabulary = userState(latestState, userId);
        const hasNewerUpdate = latestVocabulary.stateOutbox.some(
          (queued) => queued.key === update.key && queued.id !== update.id,
        );
        latestVocabulary.stateOutbox = latestVocabulary.stateOutbox.filter(
          (queued) => queued.id !== update.id,
        );
        if (!hasNewerUpdate) latestVocabulary.profileSnapshot[update.key] = item;
      });
      changed = true;
    }
  }
  if (changed) window.dispatchEvent(new CustomEvent(VOCABULARY_SYNC_EVENT));
  return true;
}

export function syncOfflineOutbox(): Promise<boolean> {
  if (syncPromise) {
    return syncPromise.then((synced) => synced ? syncOfflineOutbox() : false);
  }
  syncPromise = syncVocabularyOutboxOnce().finally(() => {
    syncPromise = null;
  });
  return syncPromise;
}
