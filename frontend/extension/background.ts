const ALLOWED_FETCH_ORIGINS = new Set([
  "http://localhost:8010",
  "http://127.0.0.1:8010",
  "http://localhost:8000",
  "http://127.0.0.1:8000",
]);
const ALLOWED_OPEN_ORIGINS = new Set(["https://nautilus.solmi.wiki"]);

function parseUrl(rawUrl: string) {
  try {
    return new URL(rawUrl);
  } catch {
    return null;
  }
}

function isAllowedFetchUrl(rawUrl: string) {
  const parsed = parseUrl(rawUrl);
  if (!parsed) return false;
  if (!/^https?:$/.test(parsed.protocol)) return false;
  return ALLOWED_FETCH_ORIGINS.has(parsed.origin);
}

function isAllowedOpenUrl(rawUrl: string) {
  const parsed = parseUrl(rawUrl);
  if (!parsed) return false;
  if (parsed.protocol === "lema:") return true;
  return /^https?:$/.test(parsed.protocol) && ALLOWED_OPEN_ORIGINS.has(parsed.origin);
}

type RequestMessage = {
  type: "lema:request";
  input: {
    url: string;
    init?: RequestInit;
  };
};

type ProbeLocalMessage = {
  type: "lema:probe-local";
  input: {
    localApi: string;
  };
};

type OpenUrlMessage = {
  type: "lema:open-url";
  input: {
    url: string;
  };
};

type ExtensionMessage =
  | RequestMessage
  | ProbeLocalMessage
  | OpenUrlMessage;

async function proxyRequest(url: string, init?: RequestInit) {
  if (!isAllowedFetchUrl(url)) {
    throw new Error("blocked request URL");
  }

  const response = await fetch(url, init);
  const text = await response.text();

  return {
    ok: response.ok,
    status: response.status,
    text,
  };
}

async function probeLocal(localApi: string) {
  if (!isAllowedFetchUrl(localApi)) {
    return { ok: false };
  }

  try {
    const response = await fetch(`${localApi}/lang/installed`, {
      method: "GET",
    });

    if (!response.ok) {
      return { ok: false };
    }

    const text = await response.text();
    const parsed = JSON.parse(text);
    return { ok: Array.isArray(parsed) };
  } catch {
    return { ok: false };
  }
}

if (chrome.action?.onClicked) {
  chrome.action.onClicked.addListener((tab) => {
    if (typeof tab.id !== "number") return;
    if (!tab.url || !/^https?:/i.test(tab.url)) return;

    void chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["assets/content.js"],
    });
  });
}

chrome.runtime.onMessage.addListener((rawMessage, _sender, sendResponse) => {
  const message = rawMessage as ExtensionMessage;

  if (message.type === "lema:request") {
    void proxyRequest(message.input.url, message.input.init)
      .then((result) => sendResponse(result))
      .catch((error: unknown) => {
        sendResponse({
          ok: false,
          status: 0,
          text: error instanceof Error ? error.message : "request failed",
        });
      });
    return true;
  }

  if (message.type === "lema:probe-local") {
    void probeLocal(message.input.localApi).then(sendResponse);
    return true;
  }

  if (message.type === "lema:open-url") {
    if (!isAllowedOpenUrl(message.input.url)) {
      sendResponse({ ok: false, error: "blocked open URL" });
      return false;
    }

    void chrome.tabs.create({ url: message.input.url }).then(() => sendResponse({ ok: true }));
    return true;
  }

  return false;
});
