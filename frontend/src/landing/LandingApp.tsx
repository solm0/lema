import { useEffect, useState } from "react";
import type { Annotation, LemmaData, TextAnalysisResult } from "../components/pageTypes";
import type { SidePanelState } from "../components/pageview/PageView";
import { CENTRAL_API } from "../api";
import Desk from "../components/lemma_expansions/Desk";
import PageContent from "../components/pageview/PageContent";
import { Link } from "react-router-dom";
import { Download } from "lucide-react";

type DemoPayload = {
  language: string;
  title: string;
  description: string;
  result: TextAnalysisResult;
  lemma_info: Record<string, LemmaData>;
};

type DesktopPlatform = "macOS" | "Linux" | "Windows";
type DesktopVersion = {
  version: string;
  platforms: Record<DesktopPlatform, string>;
};

type AndroidVersion = {
  version: string;
  href: string;
};

type ReleaseCatalog = {
  desktop: DesktopVersion[];
  android: AndroidVersion[];
};

type MutableDesktopVersion = {
  version: string;
  platforms: Partial<Record<DesktopPlatform, string>>;
};

const HF_REPO_ID = "solm0/nautilus-releases";
const HF_API_TREE_URL = `https://huggingface.co/api/datasets/${HF_REPO_ID}/tree/main/releases?recursive=1&expand=0`;
const HF_RESOLVE_BASE = `https://huggingface.co/datasets/${HF_REPO_ID}/resolve/main`;
const CHROME_EXTENSION_URL =
  "https://chromewebstore.google.com/detail/nautilus/fedaaafnilhpkoknpbkkppicjkalgflk?hl=en-US&utm_source=ext_sidebar";

type HfTreeEntry = {
  path?: string;
  type?: string;
};

async function readJsonOrThrow<T>(response: Response, fallbackMessage: string) {
  if (!response.ok) {
    throw new Error(fallbackMessage);
  }

  const contentType = response.headers.get("content-type") ?? "";

  if (!contentType.includes("application/json")) {
    const bodyPreview = (await response.text()).slice(0, 120);
    throw new Error(
      `${fallbackMessage} Expected JSON but received ${contentType || "unknown content type"}: ${bodyPreview}`,
    );
  }

  return response.json() as Promise<T>;
}

function compareVersionsDesc(a: string, b: string) {
  return b.localeCompare(a, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function buildHfResolveUrl(pathInRepo: string) {
  return `${HF_RESOLVE_BASE}/${pathInRepo}`;
}

function buildReleaseCatalogFromHfTree(entries: HfTreeEntry[]): ReleaseCatalog {
  const desktopReleases = new Map<string, MutableDesktopVersion>();
  const androidReleases = new Map<string, AndroidVersion>();

  for (const entry of entries) {
    if (entry.type !== "file" || typeof entry.path !== "string") {
      continue;
    }

    const parts = entry.path.split("/");
    if (parts.length < 4 || parts[0] !== "releases") {
      continue;
    }

    const platform = parts[1];
    const tag = parts[2];
    const versionMatch = tag.match(/^app-(desktop|android)-v(\d+\.\d+\.\d+)$/);

    if (!versionMatch) {
      continue;
    }

    const version = versionMatch[2];

    if (platform === "desktop" && parts.length >= 5) {
      const artifactFolder = parts[3];
      const filename = parts[parts.length - 1];
      const platformKey = {
        "lema-electron-macos": "macOS",
        "lema-electron-linux": "Linux",
        "lema-electron-windows": "Windows",
        "nautilus-electron-macos": "macOS",
        "nautilus-electron-linux": "Linux",
        "nautilus-electron-windows": "Windows",
      }[artifactFolder] as DesktopPlatform | undefined;

      if (!platformKey) {
        continue;
      }

      if (platformKey === "macOS" && !filename.endsWith(".dmg")) {
        continue;
      }

      if (platformKey === "Linux" && !filename.endsWith(".AppImage")) {
        continue;
      }

      if (platformKey === "Windows" && !filename.endsWith(".exe")) {
        continue;
      }

      const release: MutableDesktopVersion = desktopReleases.get(version) ?? {
        version,
        platforms: {},
      };

      release.platforms[platformKey] = buildHfResolveUrl(entry.path);
      desktopReleases.set(version, release);
    }

    if (platform === "android") {
      const filename = parts[parts.length - 1];

      if (!filename.endsWith(".apk")) {
        continue;
      }

      androidReleases.set(version, {
        version,
        href: buildHfResolveUrl(entry.path),
      });
    }
  }

  return {
    desktop: Array.from(desktopReleases.values())
      .filter((release) => Object.keys(release.platforms).length > 0)
      .sort((a, b) => compareVersionsDesc(a.version, b.version))
      .map((release) => ({
        version: release.version,
        platforms: release.platforms as Record<DesktopPlatform, string>,
      })),
    android: Array.from(androidReleases.values())
      .sort((a, b) => compareVersionsDesc(a.version, b.version)),
  };
}

async function loadReleaseCatalog() {
  const apiResponse = await fetch(`${CENTRAL_API}/releases`);

  if (apiResponse.ok) {
    return readJsonOrThrow<ReleaseCatalog>(
      apiResponse,
      "Could not load release catalog.",
    );
  }

  if (apiResponse.status !== 404) {
    throw new Error("Could not load release catalog.");
  }

  const hfResponse = await fetch(HF_API_TREE_URL);
  const tree = await readJsonOrThrow<HfTreeEntry[]>(
    hfResponse,
    "Could not load release catalog.",
  );

  return buildReleaseCatalogFromHfTree(tree);
}

function LandingApp() {
  const [demo, setDemo] = useState<DemoPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [panel, setPanel] = useState<SidePanelState>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [selectedLemma, setSelectedLemma] = useState<LemmaData | null>(null);
  const [releaseCatalog, setReleaseCatalog] = useState<ReleaseCatalog>({
    desktop: [],
    android: [],
  });

  useEffect(() => {
    let cancelled = false;

    const loadDemo = async () => {
      try {
        const response = await fetch(`${CENTRAL_API}/demo/landing/en`);
        const payload = await readJsonOrThrow<DemoPayload>(
          response,
          "Could not load demo data.",
        );

        if (cancelled) {
          return;
        }

        const firstLemma = Object.values(payload.lemma_info)[0] ?? null;

        setDemo(payload);
        setSelectedLemma(firstLemma);
      } catch (fetchError) {
        if (cancelled) {
          return;
        }

        setError(
          fetchError instanceof Error
            ? fetchError.message
            : "Could not load demo data.",
        );
      }
    };

    void loadDemo();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const fetchReleaseCatalog = async () => {
      try {
        const payload = await loadReleaseCatalog();

        if (cancelled) {
          return;
        }

        setReleaseCatalog(payload);
      } catch (fetchError) {
        if (cancelled) {
          return;
        }

        console.error(fetchError);
      }
    };

    void fetchReleaseCatalog();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (panel?.type === "lemma") {
      setSelectedLemma(panel.data);
    }
  }, [panel]);

  return (
    <main>
      <div className="mx-auto min-h-screen max-w-300 px-7 xl:pr-[19rem] break-keep">
        <div className="flex flex-col gap-21 pb-21 lg:pt-14">

          {/* 개요 */}
          <section className="min-h-180 shrink-0 pt-21 pb-21 flex flex-col gap-14">
            <h1 className="text-4xl max-w-100 md:max-w-max leading-[1.3] tracking-[-0.02em] text-neutral-900 md:text-5xl font-medium">
              Don't wait until everything is perfect.
              <br/>Just dive into text.
            </h1>
            <div className="max-w-3xl text-base md:text-lg leading-7 text-neutral-600 flex flex-col items-start gap-4">
              <p>
                Lema는 외국어 콘텐츠의 독해를 문맥 정보를 활용해 돕는 도구입니다.
              </p>
              <Link to={'/landing/background/index.html'} className="bg-neutral-900 text-neutral-50 py-2 px-4 rounded-lg hover:rounded-3xl transition-all text-base">
                설계 배경 →
              </Link>
            </div>
          </section>

          {/* 다운로드 */}
          <section className="min-h-180 shrink-0 pt-21 pb-21 flex flex-col gap-14">
            {/* <h2 className="font-pretendard text-4xl! pt-8">다운로드</h2> */}

            <div className="flex flex-col gap-2">
              <div className="flex flex-col gap-7">

                <div className="flex gap-4">
                  <p className="text-sm font-medium text-neutral-600 w-30">Desktop App</p>
                  <div className="flex flex-col gap-3">
                    {releaseCatalog.desktop.map((desktopVersion) => (
                      <div
                        key={desktopVersion.version}
                        className="flex flex-col gap-1.5"
                      >
                        <p className="text-xs font-medium text-neutral-500">
                          v{desktopVersion.version}
                        </p>
                        <div className="flex flex-wrap gap-3 items-center">
                          {Object.entries(desktopVersion.platforms).map(([label, href]) => (
                            <a
                              key={`${desktopVersion.version}-${label}`}
                              href={href}
                              target="_blank"
                              rel="noreferrer"
                              className="rounded-sm border border-transparent bg-neutral-900 px-4 py-2 text-sm font-medium text-neutral-200 transition-colors hover:border-neutral-300 hover:bg-neutral-200 hover:text-neutral-900 flex items-center gap-1"
                            >
                              {label}
                              <Download size={14}/>
                            </a>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex gap-4">
                  <p className="text-sm font-medium text-neutral-600 w-30">Chrome Extension</p>
                  <div className="flex flex-wrap gap-3 items-center">
                    <a
                      href={CHROME_EXTENSION_URL}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-sm border border-transparent bg-neutral-900 px-4 py-2 text-sm font-medium text-neutral-200 transition-colors hover:border-neutral-300 hover:bg-neutral-200 hover:text-neutral-900"
                    >
                      Chrome Web Store →
                    </a>
                  </div>
                </div>

                <div className="flex gap-4">
                  <p className="text-sm font-medium text-neutral-600 w-30">Android App</p>
                  <div className="flex flex-col gap-3">
                    <p>플레이스토어 출시 예정</p>
                    {/* {releaseCatalog.android.map((androidVersion) => (
                      <div key={androidVersion.version} className="flex flex-col gap-1.5">
                        <p className="text-xs font-medium text-neutral-500">
                          v{androidVersion.version}
                        </p>
                        <div className="flex flex-wrap gap-3 items-center">
                          <a
                            href={androidVersion.href}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded-sm border border-transparent bg-neutral-900 px-4 py-2 text-sm font-medium text-neutral-200 transition-colors hover:border-neutral-300 hover:bg-neutral-200 hover:text-neutral-900 flex items-center gap-1"
                          >
                            APK Download
                            <Download size={14}/>
                          </a>
                        </div>
                      </div>
                    ))} */}
                  </div>
                </div>

              </div>
            </div>
          </section>

          {/* Demos */}
          <section id="demos" className="flex flex-col gap-7">
            {/* <h2 className="font-pretendard text-4xl! pt-8">기능</h2> */}

            <div className="grid gap-6">
              <div className="flex w-full overflow-hidden">
                <div className="flex-1 w-1/2 shrink-0 border border-neutral-300">

                  <div className="h-[640px] min-h-0 p-4">
                    {demo ? (
                      <PageContent
                        blocks={demo.result.blocks}
                        lemmaInfo={demo.lemma_info}
                        panelData={panel}
                        language={demo.language}
                        setPanelData={setPanel}
                        annotations={annotations}
                        setAnnotations={setAnnotations}
                      />
                    ) : (
                      <DemoPlaceholder message={error ?? "Loading page demo..."} />
                    )}
                  </div>
                </div>

                <div className="flex-1 w-1/2 shrink-0 border border-neutral-300 border-l-0">

                  <div className="h-[640px] min-h-0 p-4">
                    {demo && selectedLemma ? (
                      <Desk
                        key={selectedLemma.key}
                        initialLemma={selectedLemma}
                        onToggleInterest={async () => {}}
                        language={demo.language}
                        lemmaInfo={demo.lemma_info}
                      />
                    ) : (
                      <DemoPlaceholder message={error ?? "Loading lemma demo..."} />
                    )}
                  </div>
                </div>
              </div>
              
            </div>

          </section>

          {/* use */}
          <section id="use" className="flex flex-col gap-7">
            {/* <h2 className="font-pretendard text-4xl! pt-8">입력</h2> */}

            <div className="flex gap-4 flex-col">
              <div className="flex gap-4">
                <div className="flex-1 py-4 flex flex-col gap-4">
                  <p className="text-2xl font-semibold">직접 입력</p>
                </div>
                <div className="flex-1">
                  <img src="/landing/landing_4.png" />
                </div>
              </div>
              <div className="flex gap-4">
                <div className="flex-1 py-4 flex flex-col gap-4">
                  <p className="text-2xl font-semibold">음악 가사 입력</p>
                  <p>맥과 안드로이드에서 유튜브 뮤직, 스포티파이 등의 재생을 감지하면 LRCLIB에서 가사를 불러와 바로 저장하고 분석할 수 있습니다.</p>
                </div>
                <div className="flex-1 ">
                  <img src="/landing/landing_5.png" />
                </div>
              </div>
              <div className="flex gap-4">
                <div className="flex-1 py-4 flex flex-col gap-4">
                  <p className="text-2xl font-semibold">크롬 익스텐션을 사용해 입력</p>
                  <p>웹에서 원하는 텍스트 영역을 선택해 바로 저장하고 분석할 수 있습니다.</p>
                </div>
                <div className="flex-1 ">
                  <img src="/landing/landing_6.png" />
                </div>
              </div>
            </div>
          </section>

          


          


        </div>

      </div>
    </main>
  );
}

function DemoPlaceholder({ message }: { message: string }) {
  return (
    <div className="flex h-full items-center justify-center px-6 text-center text-sm text-neutral-500">
      {message}
    </div>
  );
}

export default LandingApp;
