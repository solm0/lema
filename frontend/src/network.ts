const CENTRAL_RETRY_COOLDOWN_MS = 5000;
export const CENTRAL_RESTORED_EVENT = "lema:central-restored";

let centralStatus: "unknown" | "available" | "blocked" = "unknown";
let centralBlockedUntil = 0;
let centralGate: Promise<void> | null = null;

export function isNetworkError(error: unknown) {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return true;
  }

  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();

  return (
    error.name === "TypeError" ||
    message.includes("network") ||
    message.includes("fetch failed") ||
    message.includes("failed to fetch")
  );
}

export function isDefinitelyOffline() {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

function markCentralBlocked() {
  centralStatus = "blocked";
  centralBlockedUntil = Date.now() + CENTRAL_RETRY_COOLDOWN_MS;
}

function isCentralBlocked() {
  return centralStatus === "blocked";
}

async function trackedCentralFetch(input: RequestInfo | URL, init?: RequestInit) {
  try {
    const wasUnavailable = centralStatus !== "available";
    const response = await fetch(input, init);
    centralStatus = "available";
    centralBlockedUntil = 0;
    if (wasUnavailable && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(CENTRAL_RESTORED_EVENT));
    }
    return response;
  } catch (error) {
    if (isNetworkError(error)) {
      markCentralBlocked();
    }
    throw error;
  }
}

export async function centralFetch(input: RequestInfo | URL, init?: RequestInit) {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    markCentralBlocked();
    throw new TypeError("central network unavailable");
  }

  if (centralStatus === "blocked") {
    if (Date.now() < centralBlockedUntil) {
      throw new TypeError("central network unavailable");
    }
    centralStatus = "unknown";
  }

  if (centralGate) {
    await centralGate;

    if (isCentralBlocked()) {
      throw new TypeError("central network unavailable");
    }

    return trackedCentralFetch(input, init);
  }

  if (centralStatus === "unknown") {
    const request = trackedCentralFetch(input, init);
    centralGate = request.then(() => undefined, () => undefined);

    try {
      return await request;
    } finally {
      centralGate = null;
    }
  }

  return trackedCentralFetch(input, init);
}

if (typeof window !== "undefined") {
  window.addEventListener("offline", markCentralBlocked);
  window.addEventListener("online", () => {
    centralStatus = "unknown";
    centralBlockedUntil = 0;
  });
}
