declare global {
  type NotificationPermissionStatus = {
    granted: boolean;
    can_request: boolean;
  };

  type NowPlayingPluginBridge = {
    getCurrentTrack?: () => Promise<unknown>;
    getPermissionStatus?: () => Promise<unknown>;
    openPermissionSettings?: () => Promise<void>;
    getNotificationPermissionStatus?: () => Promise<NotificationPermissionStatus>;
    openNotificationSettings?: () => Promise<void>;
  };

  interface Window {
    Capacitor?: {
      isNativePlatform?: () => boolean;
      Plugins?: {
        NowPlaying?: NowPlayingPluginBridge;
      };
    };
    electronAPI?: {
      platform?: string;
      getNowPlaying?: () => Promise<unknown>;
      onDeepLink?: (callback: (url: string) => void) => (() => void) | void;
      relaunchApp?: () => Promise<void>;
      readOfflineState?: () => Promise<unknown>;
      writeOfflineState?: (value: unknown) => Promise<boolean>;
      saveLibraryExport?: (value: unknown) => Promise<{ ok: boolean; path?: string } | null>;
      openLibraryImport?: () => Promise<unknown | null>;
      setActiveLibraryUser?: (userId: number | null) => Promise<void>;
    };
  }
}

function hasWindow() {
  return typeof window !== "undefined";
}

export function isElectronApp() {
  return hasWindow() && typeof window.electronAPI !== "undefined";
}

export function isCapacitorApp() {
  if (!hasWindow()) return false;

  if (window.location.protocol === "capacitor:") return true;

  return window.Capacitor?.isNativePlatform?.() === true;
}

export function getAppPlatform() {
  if (isElectronApp()) return "electron";
  if (isCapacitorApp()) return "mobile";
  return "web";
}

export {};
