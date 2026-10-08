import { useEffect, useRef, useState } from "react";
import { useLocation, useParams } from "react-router-dom";
import PageContent from "./PageContent";
import {
  addPageMetadata,
  deletePageMetadata,
  fetchPageDetail,
  getInterests,
  getInstalled,
  lemmaLookup,
  setInterest,
  updatePageMetadata,
} from "../../api";
import type { Annotation, LemmaData, TextAnalysisResult } from "../pageTypes";
import ResponsiveSideLayout from "../util/ResponsiveSideLayout";
import Desk, { type DeskHandle } from "../lemma_expansions/Desk";
import KnownWordsMilestoneToast, { type KnownWordsMilestone } from "../lemma_expansions/KnownWordsMilestoneToast";
import { useLayout } from "../RootLayout";
import { type Pack } from "../setting/PackTable";
import BlockingLoadingModal from "../util/BlockingLoadingModal";
import { isTrackReferenceMatch } from "../../nowPlaying";
import { useNowPlaying } from "../lyric/useNowPlaying";
import { getActiveTimedBlockIndex } from "../lyric/spotifyLyrics";
import { getLookupMorph } from "../tokenLookup";
import { useI18n } from "../../i18n";
import { isNetworkError } from "../../network";
import LanguagePackRequiredModal from "../util/LanguagePackRequiredModal";
import OfflineState from "../util/OfflineState";
import { GRADSHOW_MODE } from "../../gradshow/mode";

const lemmaInfoCache = new Map<string, Record<string, LemmaData>>();
const lemmaAttemptedKeysCache = new Map<string, Set<string>>();
const LEMMA_PREFETCH_BLOCK_MARGIN = 8;
const MAX_LOOKUP_BATCH_ITEMS = 100;

export type SidePanelState =
  | { type: "lemma"; data: LemmaData; language?: string }
  | { type: "annotation:new"; data: Annotation }
  | { type: "annotation:view"; data: Annotation }
  | null;

export default function PageView() {
  const { t } = useI18n();
  const { id } = useParams();

  const [result, setResult] = useState<TextAnalysisResult | null>(null);
  const [lemmaInfo, setLemmaInfo] = useState<Record<string, any>>({});
  const [visibleBlockRange, setVisibleBlockRange] = useState<{
    start: number;
    end: number;
  } | null>(null);

  const [loadingPage, setLoadingPage] = useState(true);
  const [loadingLemma, setLoadingLemma] = useState(false);
  const [offline, setOffline] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [pageName, setPageName] = useState("");
  const [pageSource, setPageSource] = useState("user");
  const [pageMetadata, setPageMetadata] = useState<string[]>([]);
  const [interestKeys, setInterestKeys] = useState<Set<string>>(new Set());

  const [panel, setPanel] = useState<SidePanelState>(null);
  const [language, setLanguage] = useState<string | null>(null);
  const [knownWordsMilestone, setKnownWordsMilestone] = useState<KnownWordsMilestone | null>(null);

  const scrollRef = useRef<null | ((startIndex: number) => void)>(null);
  const deskRef = useRef<DeskHandle>(null);
  const location = useLocation();
  const annotationId = location.state?.annotationId;

  const { setTitlebarAction, setPanelOpen } = useLayout();

  const [noPack, setNoPack] = useState(false);
  const fetchedRef = useRef(false);
  const inflightLemmaKeysRef = useRef(new Set<string>());
  const activeLemmaPageKeyRef = useRef<string | null>(null);

  const lastPanelRef = useRef<SidePanelState>(null);
  const { progressMs, track } = useNowPlaying({
    enabled: !GRADSHOW_MODE && Boolean(result?.blocks?.some((block) => block.timestamp_ms != null)),
  });

  useEffect(() => {
    if (panel) {
      lastPanelRef.current = panel;
    }
    setPanelOpen(panel !== null);
  }, [panel]);

  useEffect(() => {
    setTitlebarAction(() => {
      setPanel((prev) => {
        if (prev) return null;
        return lastPanelRef.current;
      });
    });

    return () => {
      setTitlebarAction(null);
    };
  }, []);

  // RESET ON PAGE CHANGE
  useEffect(() => {
    setResult(null);
    setLemmaInfo({});
    setAnnotations([]);
    setPageName("");
    setPageSource("user");
    setPageMetadata([]);
    setPanel(null);
    setLanguage(null);
    setNoPack(false);
    setVisibleBlockRange(null);
    setLoadingPage(true);
    setLoadingLemma(false);
    inflightLemmaKeysRef.current.clear();
    fetchedRef.current = false;
  }, [id, reloadTick]);

  // FETCH PAGE DATA
  useEffect(() => {
    if (!id) return;
    let active = true;
    const requestedPageId = id;

    const run = async () => {
      if (fetchedRef.current) return;
      fetchedRef.current = true;

      setLoadingPage(true);
      setOffline(false);
      let lang = "";

      try {
        const detail = await fetchPageDetail(requestedPageId);
        if (!active) return;
        const resultData: TextAnalysisResult = detail.result;
        lang = detail.language;

        setResult(resultData);
        setPageName(detail.name ?? "");
        setPageSource(detail.source ?? "user");
        setPageMetadata(Array.isArray(detail.metadata) ? detail.metadata : []);
        setLanguage(lang);
        setAnnotations(
          Array.isArray(detail.annotations)
            ? detail.annotations.filter(
                (annotation) => annotation.page_id === requestedPageId,
              )
            : [],
        );
        setOffline(false);
        const interests = await getInterests();
        if (!active) return;
        setInterestKeys(new Set(interests));
      } catch (error) {
        if (!active) return;
        setOffline(isNetworkError(error));
        setLoadingPage(false);
        return;
      }

      const lemmaCacheKey = `${id}:${lang}`;
      const cachedLemmaInfo = lemmaInfoCache.get(lemmaCacheKey);
      if (cachedLemmaInfo) {
        setLemmaInfo(cachedLemmaInfo);
      }

      setLoadingPage(false);

      const installed = await getInstalled();
      if (!active) return;
      const pack = installed.find((l: Pack) => l.lang === lang);

      if (!pack?.installed) {
        setNoPack(true);
      }
    };

    void run();

    return () => {
      active = false;
    };
  }, [id, reloadTick]);

  useEffect(() => {
    activeLemmaPageKeyRef.current =
      id && language ? `${id}:${language}` : null;
  }, [id, language]);

  useEffect(() => {
    if (!id || !result || !language || noPack || !visibleBlockRange) return;

    const lemmaCacheKey = `${id}:${language}`;
    const attemptedKeys =
      lemmaAttemptedKeysCache.get(lemmaCacheKey) ?? new Set<string>();

    if (!lemmaAttemptedKeysCache.has(lemmaCacheKey)) {
      lemmaAttemptedKeysCache.set(lemmaCacheKey, attemptedKeys);
    }

    const start = Math.max(0, visibleBlockRange.start - LEMMA_PREFETCH_BLOCK_MARGIN);
    const end = Math.min(
      result.blocks.length - 1,
      visibleBlockRange.end + LEMMA_PREFETCH_BLOCK_MARGIN,
    );

    const pendingItems: { lemma: string; pos: string }[] = [];
    const pendingKeys = new Set<string>();

    for (let blockIndex = start; blockIndex <= end; blockIndex += 1) {
      const block = result.blocks[blockIndex];
      const blockItems: { lemma: string; pos: string }[] = [];
      const blockKeys = new Set<string>();

      block?.tokens?.forEach((token) => {
        const lookup = getLookupMorph(token, language);
        if (!lookup) return;

        const key = `${lookup.lemma}_${lookup.pos}`;
        if (lemmaInfo[key]) return;
        if (attemptedKeys.has(key)) return;
        if (inflightLemmaKeysRef.current.has(key)) return;
        if (pendingKeys.has(key)) return;
        if (blockKeys.has(key)) return;

        blockKeys.add(key);
        blockItems.push(lookup);
      });

      if (blockItems.length === 0) continue;

      // Keep normal requests at block (sentence) boundaries. The following
      // render picks up this block after the current batch has completed.
      if (pendingItems.length + blockItems.length > MAX_LOOKUP_BATCH_ITEMS) {
        // A single block can itself exceed the server limit. Fetch the part
        // that fits so it cannot block all prefetching for the page.
        if (pendingItems.length === 0) {
          const fittingItems = blockItems.slice(0, MAX_LOOKUP_BATCH_ITEMS);
          fittingItems.forEach((item) => {
            pendingItems.push(item);
            pendingKeys.add(`${item.lemma}_${item.pos}`);
          });
        }
        break;
      }

      blockItems.forEach((item) => {
        pendingItems.push(item);
        pendingKeys.add(`${item.lemma}_${item.pos}`);
      });
    }

    if (pendingItems.length === 0) return;

    pendingKeys.forEach((key) => inflightLemmaKeysRef.current.add(key));
    setLoadingLemma(true);

    void lemmaLookup(pendingItems, language)
      .then((lookupData) => {
        pendingKeys.forEach((key) => attemptedKeys.add(key));
        const cached = lemmaInfoCache.get(lemmaCacheKey) ?? {};
        const next = { ...cached, ...lookupData };
        lemmaInfoCache.set(lemmaCacheKey, next);

        if (activeLemmaPageKeyRef.current === lemmaCacheKey) {
          setLemmaInfo((prev) => ({ ...prev, ...lookupData }));
        }
      })
      .catch(() => {
        // Keep keys retriable on request failure.
      })
      .finally(() => {
        pendingKeys.forEach((key) => inflightLemmaKeysRef.current.delete(key));
        if (activeLemmaPageKeyRef.current === lemmaCacheKey) {
          setLoadingLemma(inflightLemmaKeysRef.current.size > 0);
        }
      });
  }, [id, language, lemmaInfo, noPack, result, visibleBlockRange]);

  // ANNOTATION SCROLL + PANEL
  useEffect(() => {
    if (!id) return;
    if (!annotationId) return;
    if (annotations.length === 0) return;

    const ann = annotations.find((a) => a.id === annotationId);
    if (!ann) return;

    if (ann.type !== "emoji") {
      setPanel({
        type: "annotation:view",
        data: ann,
      });
    }

    requestAnimationFrame(() => {
      scrollRef.current?.(ann.start_index);
    });
  }, [id, annotationId, annotations]);

  const onInterestClick = async (key: string, next: boolean) => {
    await setInterest(key, next);
    setInterestKeys(new Set(await getInterests()));
    const [lemma, pos] = key.split("/");
    const localKey = lemma && pos ? `${lemma}_${pos}` : null;
    if (localKey) {
      setLemmaInfo((prev) => {
        const current = prev[localKey];
        if (!current) return prev;
        const nextInfo = { ...prev, [localKey]: { ...current, is_interested: next } };
        if (id && language) {
          lemmaInfoCache.set(`${id}:${language}`, nextInfo);
        }
        return nextInfo;
      });
    }
  };

  const trackReference = result?.track_ref ?? null;
  const loadingMessage = loadingPage
    ? t("Fetching page...")
    : null;
  const shouldSyncTimedBlocks =
    Boolean(trackReference) &&
    Boolean(track?.is_playing) &&
    isTrackReferenceMatch(trackReference, track);
  const lyricMotionActive =
    pageSource === "lrclib" && shouldSyncTimedBlocks;

  const activeLyricBlockIndex = getActiveTimedBlockIndex(
    result?.blocks ?? [],
    lyricMotionActive ? progressMs : null
  );

  const handleAddMetadata = async (value: string) => {
    if (!id) return;
    const data = await addPageMetadata(id, value);
    setPageMetadata(data.metadata);
  };

  const handleUpdateMetadata = async (metadataIndex: number, value: string) => {
    if (!id) return;
    const data = await updatePageMetadata(id, metadataIndex, value);
    setPageMetadata(data.metadata);
  };

  const handleDeleteMetadata = async (metadataIndex: number) => {
    if (!id) return;
    const data = await deletePageMetadata(id, metadataIndex);
    setPageMetadata(data.metadata);
  };

  return (
    <div className="relative w-full h-full flex justify-center bg-neutral-50">
      <BlockingLoadingModal
        open={loadingMessage !== null}
        message={loadingMessage ?? ""}
        usePortal={false}
      />

      {offline && !result ? (
        <OfflineState onRetry={() => {
          fetchedRef.current = false;
          setLoadingPage(true);
          setOffline(false);
          setReloadTick((prev) => prev + 1);
        }} />
      ) : null}

      {offline && result ? (
        <div className="absolute left-3 top-3 z-40 text-xs text-neutral-400 md:left-6">
          {t("You're offline.")}
        </div>
      ) : null}

      <LanguagePackRequiredModal
        language={language ?? ""}
        open={noPack && language !== null}
        onClose={() => setNoPack(false)}
      />

      {result && (
        <>
          <div
            className="absolute w-full h-12 z-30 inset-0 backdrop-blur-lg"
            style={{
              WebkitMaskImage:
                "linear-gradient(to bottom, black 0%, rgba(0,0,0,0.9) 40%, rgba(0,0,0,0.4) 70%, transparent 100%)",
              maskImage:
                "linear-gradient(to bottom, black 0%, rgba(0,0,0,0.9) 40%, rgba(0,0,0,0.4) 70%, transparent 100%)",
            }}
          />

          <div
            className="relative flex h-full min-w-0 flex-1 overflow-hidden"
          >
            <PageContent
              key={id}
              blocks={result.blocks}
              activeLyricBlockIndex={activeLyricBlockIndex}
              syncPlaybackActive={lyricMotionActive}
              lemmaInfo={lemmaInfo}
              interestKeys={interestKeys}
              onVisibleBlockRangeChange={setVisibleBlockRange}
              annotations={annotations}
              pageName={pageName}
              pageSource={pageSource}
              pageMetadata={pageMetadata}
              onAddMetadata={offline || Number(id) < 0 ? undefined : handleAddMetadata}
              onUpdateMetadata={offline || Number(id) < 0 ? undefined : handleUpdateMetadata}
              onDeleteMetadata={offline || Number(id) < 0 ? undefined : handleDeleteMetadata}
              pageId={id}
              panelData={panel}
              language={language ?? ""}
              setPanelData={setPanel}
              scrollRef={(fn) => (scrollRef.current = fn)}
              setAnnotations={setAnnotations}
              horizontalAlign="center"
            />
          </div>

          <ResponsiveSideLayout
            open={panel?.type === "lemma"}
            onClose={() => setPanel(null)}
            onSwipeRight={() => deskRef.current?.markActiveKnown()}
          >
            {panel?.type === "lemma" && language && (
              <Desk
                ref={deskRef}
                key={panel.data.key}
                initialLemma={panel.data}
                onToggleInterest={onInterestClick}
                language={panel.language ?? language}
                lemmaInfo={lemmaInfo}
                interestKeys={interestKeys}
                onKnownWordsMilestone={setKnownWordsMilestone}
              />
            )}

          </ResponsiveSideLayout>

          {loadingLemma && !loadingPage && !noPack && (
            <div className="pointer-events-none absolute bottom-20 left-1/2 z-40 -translate-x-1/2 rounded-full bg-neutral-50/90 px-3 py-1 text-xs text-neutral-500 shadow-sm backdrop-blur-sm md:bottom-4">
              {t("Fetching lemmas...")}
            </div>
          )}
        </>
      )}
      <KnownWordsMilestoneToast
        milestone={knownWordsMilestone}
        onClose={() => setKnownWordsMilestone(null)}
      />
    </div>
  );
}
