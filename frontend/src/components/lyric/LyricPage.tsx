import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import Button from "../util/Button";
import LanguageSelect from "../util/LanguageSelect";
import type { TextAnalysisResult, TextBlock } from "../pageTypes";
import {
  analyzeBlocks,
  lemmaLookup,
  savePage,
  type SavePageProgress,
} from "../../api";
import {
  buildTrackReference,
  openNowPlayingPermissionSettings,
} from "../../nowPlaying";
import { useNowPlaying } from "./useNowPlaying";
import { useAutoCenterActiveItem } from "./useAutoCenterActiveItem";
import { isCapacitorApp } from "../../platform";
import { getLookupMorph } from "../tokenLookup";
import { useI18n } from "../../i18n";
import NowPlayingAccessConsentModal from "./NowPlayingAccessConsentModal";

function median(values: number[]) {
  if (values.length === 0) return 0;

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }

  return sorted[middle];
}

function buildSyncedParagraphs(lines: { timestamp_ms: number; text: string }[]) {
  if (lines.length <= 1) return [lines];

  const gaps = lines
    .slice(1)
    .map((line, index) => Math.max(0, line.timestamp_ms - lines[index].timestamp_ms));

  const baselineGap = median(gaps);
  const mad = median(gaps.map((gap) => Math.abs(gap - baselineGap)));
  const hardFloor = Math.max(1200, baselineGap * 1.12);
  const dynamicThreshold = Math.max(
    hardFloor,
    baselineGap + Math.max(180, mad * 1.2),
  );

  const breakIndexes = new Set<number>();

  for (let i = 0; i < gaps.length; i += 1) {
    const gap = gaps[i];
    const prevGap = i > 0 ? gaps[i - 1] : baselineGap;
    const nextGap = i < gaps.length - 1 ? gaps[i + 1] : baselineGap;
    const localBaseline = median([prevGap, gap, nextGap].filter((value) => value > 0));
    const isClearOutlier =
      gap >= dynamicThreshold &&
      gap >= Math.max(localBaseline * 1.08, baselineGap * 1.18);

    if (isClearOutlier) {
      breakIndexes.add(i + 1);
    }
  }

  const paragraphs: { timestamp_ms: number; text: string }[][] = [];
  let current: { timestamp_ms: number; text: string }[] = [];

  lines.forEach((line, index) => {
    if (breakIndexes.has(index) && current.length > 0) {
      paragraphs.push(current);
      current = [];
    }

    current.push(line);
  });

  if (current.length > 0) {
    paragraphs.push(current);
  }

  if (paragraphs.length <= 1) {
    return paragraphs;
  }

  const merged: { timestamp_ms: number; text: string }[][] = [];

  for (let i = 0; i < paragraphs.length; i += 1) {
    const paragraph = paragraphs[i];

    if (paragraph.length !== 1) {
      merged.push(paragraph);
      continue;
    }

    const previous = merged.at(-1);
    const next = paragraphs[i + 1];

    if (!previous && next) {
      next.unshift(...paragraph);
      continue;
    }

    if (previous && !next) {
      previous.push(...paragraph);
      continue;
    }

    if (previous && next) {
      const prevGap =
        paragraph[0].timestamp_ms - previous[previous.length - 1].timestamp_ms;
      const nextGap =
        next[0].timestamp_ms - paragraph[paragraph.length - 1].timestamp_ms;

      if (prevGap <= nextGap) {
        previous.push(...paragraph);
      } else {
        next.unshift(...paragraph);
      }
      continue;
    }

    merged.push(paragraph);
  }

  return merged;
}

function buildLyricsBlocks({
  syncedLines,
  plainLyrics,
}: {
  syncedLines: { timestamp_ms: number; text: string }[];
  plainLyrics: string | null | undefined;
}): TextBlock[] {

  if (syncedLines.length > 0) {
    return buildSyncedParagraphs(syncedLines).flatMap((paragraph, paragraphIndex, paragraphs) => {
      const blocks: TextBlock[] = paragraph.map((line) => ({
        text: line.text,
        timestamp_ms: line.timestamp_ms,
      }));

      if (paragraphIndex < paragraphs.length - 1) {
        blocks.push({
          text: "",
          tokens: [],
        });
      }

      return blocks;
    });
  }

  return (plainLyrics ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((text) => ({ text }));
}

async function analyzeLyricsBlocks(blocks: TextBlock[], language: string) {
  const analyzableBlocks = blocks
    .map((block, index) => ({ block, index }))
    .filter(({ block }) => block.text.trim().length > 0);

  const data = await analyzeBlocks(
    analyzableBlocks.map(({ block }) => ({ text: block.text })),
    language,
  );

  return blocks.map((block, index) => {
    const analyzedIndex = analyzableBlocks.findIndex((item) => item.index === index);

    if (analyzedIndex < 0) {
      return {
        ...block,
        tokens: [],
      };
    }

    return {
      ...block,
      tokens: data.blocks?.[analyzedIndex]?.tokens ?? [],
    };
  }) satisfies TextBlock[];
}

function buildLyricsPageName(trackName: string | null | undefined, artists: string[]) {
  const prefix = artists.length ? artists.join(", ") : "Unknown artist";
  return `${prefix} - ${trackName ?? "Untitled"}`;
}

function PlayingWaveform({ playing }: { playing: boolean }) {
  return (
    <div className="flex h-4 items-end gap-[3px]">
      {[0, 1, 2, 3].map((bar) => (
        <div
          key={bar}
          className={`w-[3px] rounded-full bg-black ${
            playing ? "animate-waveform" : ""
          }`}
          style={{
            height: `${[40, 100, 65, 85][bar]}%`,
            animationDelay: `${bar * 0.12}s`,
          }}
        />
      ))}
    </div>
  );
}

export default function LyricPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const {
    loading,
    permission,
    track,
    syncedLines,
    activeLyricIndex,
    lyricsLoading,
    hasTrack,
  } = useNowPlaying();

  const [language, setLanguage] = useState<{
    lang: string;
  } | null>(null);
  const [openAccessConsent, setOpenAccessConsent] = useState(false);
  const mobileApp = isCapacitorApp();

  const [anyLangInstalled, setAnyLangInstalled] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveProgress, setSaveProgress] = useState<
    SavePageProgress | "analyzing" | "fetching-lemmas" | null
  >(null);
  const [savedPageId, setSavedPageId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const lyricsContainerRef = useRef<HTMLDivElement>(null);

  const blocks = useMemo(
    () =>
      buildLyricsBlocks({
        syncedLines,
        plainLyrics: track?.lyrics?.plain,
      }),
    [syncedLines, track?.lyrics?.plain],
  );

  const plainLines = useMemo(
    () => (track?.lyrics?.plain ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
    [track?.lyrics?.plain],
  );

  const getLineElement = useCallback((index: number, container: HTMLElement) => {
    return container.querySelector(`[data-lyric-line-index="${index}"]`) as HTMLElement | null;
  }, []);

  useAutoCenterActiveItem({
    containerRef: lyricsContainerRef,
    activeIndex: activeLyricIndex,
    enabled: syncedLines.length > 0,
    getElementForIndex: getLineElement,
  });

  useEffect(() => {
    setSavedPageId(null);
    setSaveError(null);
  }, [track?.track?.id, track?.lyrics?.plain, track?.lyrics?.synced]);

  const handleSave = async () => {
    if (!language || !track?.track || blocks.length === 0) return;

    setSaving(true);
    setSaveProgress("analyzing");
    setSaveError(null);

    try {
      const analyzedBlocks = await analyzeLyricsBlocks(blocks, language.lang);
      const resultToSave: TextAnalysisResult = {
        text: analyzedBlocks.map((block) => block.text).join("\n"),
        blocks: analyzedBlocks,
        track_ref: buildTrackReference(track),
      };

      const pageId = await savePage(
        resultToSave,
        buildLyricsPageName(track.track.name, track.track.artists),
        null,
        language.lang,
        {
          source: "lrclib",
          metadata: track.track.name ? [track.track.name] : [],
          onProgress: setSaveProgress,
        },
      );

      const items = analyzedBlocks
        .flatMap((block) => block.tokens ?? [])
        .map((token) => getLookupMorph(token, language.lang))
        .filter((item): item is { lemma: string; pos: string } => item !== null);

      if (items.length > 0) {
        setSaveProgress("fetching-lemmas");
        const uniqueItems = Array.from(
          new Map(items.map((item) => [`${item.lemma}_${item.pos}`, item])).values(),
        );
        await lemmaLookup(uniqueItems, language.lang);
      }

      setSavedPageId(pageId);
    } catch (error) {
      if (error instanceof Error && error.message === "unauthorized") {
        navigate("/login");
        return;
      }

      if (error instanceof Error && (
        error.message === "analysis_busy" || error.message === "analysis_queue_full"
      )) {
        setSaveError(t("The analysis server is busy. Try again shortly."));
      } else if (error instanceof Error && error.message === "analysis_rate_limited") {
        setSaveError(t("Too many analysis requests. Try again later."));
      } else {
        setSaveError(t("Saving lyrics failed."));
      }
    } finally {
      setSaving(false);
      setSaveProgress(null);
    }
  };

  const saveButtonText = saveProgress === "analyzing"
    ? t("Analyzing selected text...")
    : saveProgress === "fetching-lemmas"
      ? t("Fetching lemmas...")
      : saveProgress === "saving"
        ? t("Saving...")
        : t("Save");

  const isSaveDisabled =
    saving ||
    !language ||
    !anyLangInstalled ||
    !track?.lyrics ||
    blocks.length === 0;

  return (
    <div className={`flex flex-col items-start h-full w-full gap-2 pr-4 pb-18 md:pb-4 md:pr-6 pl-3 md:pl-6 ${mobileApp ? 'bg-neutral-200' : 'bg-neutral-transparent'}`}>

      <div className="flex flex-col gap-2 pt-12 pb-2">
        <h2>{t("Get lyrics")}</h2>
      </div>

      <div className="flex flex-1 min-h-0 w-full max-w-3xl flex-col gap-4 items-start">

        {loading && (
          <div className="rounded-sm bg-neutral-50 p-6 text-sm text-neutral-500">
            {t("Checking current playback...")}
          </div>
        )}

        {!loading && permission?.supported && permission.needs_user_action && (
          <div className="flex flex-col gap-4 rounded-sm bg-neutral-50 p-6">
            <div className="flex flex-col gap-1">
              <h3>{t("Playback access is not enabled")}</h3>
              <p className="text-sm text-neutral-500">
                {t("Android needs notification access to inspect active media sessions. macOS should work automatically with supported desktop players.")}
              </p>
            </div>
            <div className="flex justify-start">
              <Button text={t("Review access")} onClick={() => setOpenAccessConsent(true)} fit black />
            </div>
          </div>
        )}

        {!loading && permission && !permission.supported && (
          <div className="flex flex-col gap-4 rounded-sm bg-neutral-50 p-6">
            <div className="flex flex-col gap-1">
              <h3>{t("Playback detection is unavailable")}</h3>
              <p className="text-sm text-neutral-500">
                {t("This build did not expose the local now-playing bridge on this platform yet.")}
              </p>
            </div>
            <div className="text-xs text-neutral-400">
              {t("Platform:")} {permission.platform}
            </div>
          </div>
        )}

        {!loading && (!permission || permission.granted) && !hasTrack && (
          <div className="rounded-sm bg-neutral-50 p-6 text-neutral-500">
            {t("No active track was detected. On macOS, supported players are the desktop Spotify app and Music app. On Android, any player exposing a media session should work after notification access is granted.")}
          </div>
        )}

        {track?.track && (
          <div className="flex flex-col flex-1 min-h-0 w-full">
            <div className="flex w-full items-start gap-4 rounded-sm bg-neutral-50 p-4">

              <div className="flex w-full flex-col gap-1">
                <p className="text-3xl font-semibold">{track.track.name}</p>
                <p className="truncate text-sm">
                  <span>{track.track.artists.join(", ")}</span>
                  <span className="text-neutral-400"> | {track.track.album}</span>
                </p>
              </div>
              <PlayingWaveform playing={track.is_playing} />
            </div>

            <div className="flex-1 min-h-0 relative overflow-hidden rounded-sm text-lg md:text-xl py-4">
              <span className="absolute top-3 right-3 text-sm text-neutral-500">
                {track.lyrics?.is_synced ? t("synced") : track.lyrics ? t("plain") : ""}
              </span>

              {syncedLines.length > 0 ? (
                <div
                  ref={lyricsContainerRef}
                  className="pl-4 h-full flex flex-col gap-3 overflow-y-scroll overflow-x-hidden no-scrollbar py-[40vh]"
                >
                  {syncedLines.map((line, index) => (
                    <div
                      key={`${line.timestamp_ms}-${index}`}
                      data-lyric-line-index={index}
                      className={`transition-all duration-300 ${
                        index === activeLyricIndex
                          ? "font-semibold opacity-100 "
                          : index < activeLyricIndex
                            ? "text-neutral-700 opacity-50 scale-100"
                            : "text-neutral-700 opacity-70 scale-100"
                      }`}
                    >
                      {line.text}
                    </div>
                  ))}
                </div>
              ) : plainLines.length > 0 ? (
                <div className="whitespace-pre-wrap text-neutral-700">
                  {plainLines.join("\n")}
                </div>
              ) : lyricsLoading ? (
                <div className="text-neutral-500">{t("Looking for lyrics...")}</div>
              ) : (
                <div className="text-neutral-500">{t("Lyrics were not found for the current track.")}</div>
              )}
            </div>
          </div>
        )}
      </div>

      <LanguageSelect
        language={language?.lang ?? null}
        setLanguage={(next) => setLanguage(next)}
        allowUnselected
        handleReset={() => {
          setSavedPageId(null);
          setSaveError(null);
        }}
        setAnyLangInstalled={setAnyLangInstalled}
        background={!mobileApp}
      />
      <div className="flex flex-col gap-2 w-full">
        {saveError ? (
          <div className="text-sm text-red-600">{saveError}</div>
        ) : null}
        <div className="w-full">
          {savedPageId ? (
            <Button
              text={t("Go to page")}
              onClick={() => navigate(`/page/${savedPageId}`)}
              fit
              black
            />
          ) : (
            <Button
              text={saveButtonText}
              onClick={handleSave}
              disabled={isSaveDisabled}
              fit
              black
            />
          )}
        </div>
      </div>
      <NowPlayingAccessConsentModal
        open={openAccessConsent}
        onClose={() => setOpenAccessConsent(false)}
        onAccept={() => {
          setOpenAccessConsent(false);
          void openNowPlayingPermissionSettings();
        }}
      />
    </div>
  );
}
