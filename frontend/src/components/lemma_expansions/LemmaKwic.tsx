import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { TokenInLemmaExpansion } from "./TokenInLemmaExpansion";
import type { KwicData, LemmaData } from "../pageTypes";
import { IconButton } from "../util/Button";
import { AlignCenterVertical } from "lucide-react";
import { lemmaLookupProgressively } from "../../api";
import { getLookupKey, getLookupKeyForMorph } from "../tokenLookup";
import { useI18n } from "../../i18n";
import LemmaActivityToast from "./LemmaActivityToast";

const SHOW_KWIC_DEBUG = false;

function highlightIntersect(
  surface: string,
  lemma: string
): React.ReactNode[] {

  const s = [...surface];
  const l = [...lemma.toLowerCase()];

  const n = s.length;
  const m = l.length;

  // dp[i][j] = LCS length
  const dp = Array.from({ length: n + 1 }, () =>
    Array(m + 1).fill(0)
  );

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {

      if (s[i - 1].toLowerCase() === l[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(
          dp[i - 1][j],
          dp[i][j - 1]
        );
      }
    }
  }

  // backtrack matched chars
  const matched = new Set<number>();

  let i = n;
  let j = m;

  while (i > 0 && j > 0) {

    if (s[i - 1].toLowerCase() === l[j - 1]) {
      matched.add(i - 1);
      i--;
      j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }

  return s.map((ch, idx) => (
    <span
      key={idx}
      className={`${
        matched.has(idx)
          ? "bg-neutral-200/50 z-10 h-full flex items-center"
          : "z-10 h-full flex items-center"
        } font-semibold`
      }
    >
      {ch}
    </span>
  ));
}

interface KwicRowProps {
  d: KwicData;
  lemma: string;
  language: string;
  onSelect: (tokenKey: string) => void;
  canSelectKey?: (tokenKey: string) => boolean;
  hovered: { pos: string | null; x: number, y: number };
  setHovered: React.Dispatch<React.SetStateAction<{ pos: string | null; x: number, y: number }>>
  lemmaInfo: Record<string, LemmaData>;
  interestKeys?: Set<string>;
  onMisalignedChange: (misaligned: boolean) => void;
}

interface KwicRowHandle {
  setCenter: () => void;
}

// KwicData의 tokens 배열 원소 타입을 추론
type Token = KwicData["tokens"][number];

const KwicRow = forwardRef<KwicRowHandle, KwicRowProps>(function KwicRow(
  { d, lemma, language, onSelect, canSelectKey, hovered, setHovered, lemmaInfo, interestKeys, onMisalignedChange },
  ref
) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const leadingGutterRef = useRef<HTMLDivElement>(null);
  const leftRef = useRef<HTMLDivElement>(null);
  const targetRef = useRef<HTMLDivElement>(null);
  const expectedScrollRef = useRef(0);
  const centeringUntilRef = useRef(0);
  const alignmentTimerRef = useRef<number | null>(null);

  const tokens = d.tokens;
  const baseLemma = lemma.split("_")[0];
  const targetIdx = d.match_indices[0] ?? tokens.findIndex((t) => t.lemma === baseLemma);

  const left = tokens.slice(0, targetIdx);
  const target = tokens[targetIdx];
  const right = tokens.slice(targetIdx + 1);

  const [gutterWidth, setGutterWidth] = useState(0);

  const setCenter = (behavior: ScrollBehavior = "smooth") => {
    const container = scrollRef.current;
    const leadingGutter = leadingGutterRef.current;
    const leftEl = leftRef.current;
    const targetEl = targetRef.current;
    if (!container || !leadingGutter || !leftEl || !targetEl) return;
    const desired = leadingGutter.offsetWidth
      + leftEl.scrollWidth
      + targetEl.offsetWidth / 2
      - container.clientWidth / 2;
    const target = Math.max(0, Math.min(desired, container.scrollWidth - container.clientWidth));
    expectedScrollRef.current = target;
    centeringUntilRef.current = performance.now() + 450;
    onMisalignedChange(false);
    container.scrollTo({
      left: target,
      behavior,
    });
  };

  const handleScroll = () => {
    const container = scrollRef.current;
    if (!container) return;
    const reportAlignment = () => {
      onMisalignedChange(Math.abs(container.scrollLeft - expectedScrollRef.current) > 3);
    };
    const remaining = centeringUntilRef.current - performance.now();
    if (remaining > 0) {
      if (alignmentTimerRef.current !== null) window.clearTimeout(alignmentTimerRef.current);
      alignmentTimerRef.current = window.setTimeout(reportAlignment, remaining + 20);
      return;
    }
    reportAlignment();
  };

  useImperativeHandle(ref, () => ({ setCenter: () => setCenter("smooth") }));

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const resizeObserver = new ResizeObserver(([entry]) => {
      setGutterWidth(entry.contentRect.width / 2);
    });
    resizeObserver.observe(container);
    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  useLayoutEffect(() => {
    if (gutterWidth > 0) setCenter("auto");
  }, [d.line_id, gutterWidth, lemma]);

  useEffect(() => () => {
    if (alignmentTimerRef.current !== null) window.clearTimeout(alignmentTimerRef.current);
    onMisalignedChange(false);
  }, []);

  const renderToken = (t: Token, j: number) => (
    <div
      key={j}
      className="font-body relative isolate h-full flex items-center px-[0.15em] shrink-0 font-medium"
      data-font-language={language}
      onMouseEnter={(e) =>
        setHovered({
          pos: t.pos,
          x: e.clientX,
          y: e.clientY,
        })
      }
      onMouseLeave={() => setHovered({ pos: null, x: 0, y: 0 })}
      onMouseMove={(e) =>
        setHovered((prev) => ({
          ...prev,
          x: e.clientX,
          y: e.clientY,
        }))
      }
    >
      {/* pointer-events-none으로 stacking context 충돌 방지 */}
      <div
        className={[
          "transition-colors pointer-events-none absolute inset-0 z-0 h-12",
          hovered.pos === t.pos ? "bg-pos-highlight" : "opacity-0",
        ].join(" ")}
      />
      <div className="relative z-10">
        <TokenInLemmaExpansion
          token={t}
          language={language}
          onSelect={onSelect}
          canSelectKey={canSelectKey}
          lemmaInfo={lemmaInfo}
          interestKeys={interestKeys}
          excludedInterestKey={lemma}
        />
      </div>
    </div>
  );

  // targetIdx를 못 찾은 경우 렌더링 스킵
  if (targetIdx === -1 || !target) return null;

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      className="relative w-full shrink-0 overflow-x-auto overflow-y-visible no-scrollbar h-auto"
      style={{ overscrollBehaviorX: 'contain' }}
    >
      {SHOW_KWIC_DEBUG && (
        <div
          className="pointer-events-none sticky left-1 top-0 z-30 w-max rounded-sm bg-neutral-50/85 px-1 font-mono text-[8px] leading-3 text-neutral-400"
          title="line · length · score · coverage · known · exposed · interested · frequency prior"
        >
          #{d.line_id}{d.selection_debug
            ? ` · l${d.selection_debug.length} · s${d.selection_debug.score.toFixed(3)} · c${d.selection_debug.coverage.toFixed(3)} · k${d.selection_debug.known} · e${d.selection_debug.exposed} · i${d.selection_debug.interested} · f${d.selection_debug.frequency_prior.toFixed(3)}`
            : " · debug unavailable"}
        </div>
      )}
      <div className="flex text-lg min-w-full w-max items-center whitespace-nowrap">
        <div
          ref={leadingGutterRef}
          className="shrink-0"
          style={{ width: gutterWidth }}
        />
        <div
          ref={leftRef}
          className="flex h-12 shrink-0 justify-end"
        >
          {left.map((t, j) => renderToken(t, j))}
        </div>

        <div ref={targetRef} className="relative px-2 flex shrink-0 items-center h-12 cursor-default">
          <div className="absolute inset-0 opacity-50 pointer-events-none" />
          <span className="font-body inline-flex h-full items-center" data-font-language={language}>
            {highlightIntersect(target.surface, baseLemma)}
          </span>
        </div>

        <div
          className="flex h-12 shrink-0 justify-start"
        >
          {right.map((t, j) => renderToken(t, j))}
        </div>
        <div className="shrink-0" style={{ width: gutterWidth }} />
      </div>
    </div>
  );
});

export default function LemmaKwic({
  data,
  onSelect,
  lemma,
  language,
  lemmaInfo,
  interestKeys,
}: {
  data: KwicData[];
  onSelect: (tokenKey: string) => void;
  lemma: string;
  language: string;
  lemmaInfo?: Record<string, LemmaData>;
  interestKeys?: Set<string>;
}) {
  const { t } = useI18n();
  const [hovered, setHovered] = useState<{
    pos: string | null;
    x: number;
    y: number;
  }>({
    pos: null,
    x: 0,
    y: 0,
  });

  const rowRefs = useRef<(KwicRowHandle | null)[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const attemptedKeysRef = useRef(new Set<string>());
  const inflightKeysRef = useRef(new Set<string>());
  const [availableKeys, setAvailableKeys] = useState<Record<string, LemmaData>>(
    () => lemmaInfo ?? {},
  );
  const availableKeysRef = useRef<Record<string, LemmaData>>(lemmaInfo ?? {});
  const [loadingLemma, setLoadingLemma] = useState(false);
  const [fetchProgress, setFetchProgress] = useState({ completed: 0, total: 0 });
  const [showCenterButton, setShowCenterButton] = useState(false);

  const canSelectKey = (tokenKey: string) => {
    return availableKeys[tokenKey] != null;
  };

  useEffect(() => {
    const nextAvailableKeys = lemmaInfo ?? {};
    availableKeysRef.current = nextAvailableKeys;
    setAvailableKeys(nextAvailableKeys);
  }, [lemmaInfo]);

  useEffect(() => {
    attemptedKeysRef.current.clear();
    inflightKeysRef.current.clear();
    setLoadingLemma(false);
    setFetchProgress({ completed: 0, total: 0 });
  }, [data, language, lemma]);

  useEffect(() => {
    setShowCenterButton(false);
  }, [data, lemma]);

  const lookupItems = useMemo(() => {
    const seen = new Set<string>();
    const items: Array<{ lemma: string; pos: string }> = [];

    for (const row of data) {
      for (const token of row.tokens) {
        const tokenKey = getLookupKey(token, language);

        if (tokenKey && !seen.has(tokenKey)) {
          const parts = tokenKey.split("_");
          const tokenPos = parts.pop();
          const tokenLemma = parts.join("_");
          if (tokenLemma && tokenPos) {
            seen.add(tokenKey);
            items.push({ lemma: tokenLemma, pos: tokenPos });
          }
        }

        for (const morph of token.morphs ?? []) {
          const morphKey = getLookupKeyForMorph(morph, language);

          if (!morphKey || seen.has(morphKey)) {
            continue;
          }

          const parts = morphKey.split("_");
          const morphPos = parts.pop();
          const morphLemma = parts.join("_");

          if (!morphLemma || !morphPos) {
            continue;
          }

          seen.add(morphKey);
          items.push({ lemma: morphLemma, pos: morphPos });
        }
      }
    }

    return items.filter(({ lemma, pos }) => {
      const key = `${lemma}_${pos}`;

      if (availableKeysRef.current[key] != null) {
        return false;
      }

      if (attemptedKeysRef.current.has(key)) {
        return false;
      }

      if (inflightKeysRef.current.has(key)) {
        return false;
      }

      return true;
    });
  }, [data, language, lemmaInfo]);

  useEffect(() => {
    if (lookupItems.length === 0) {
      setLoadingLemma(false);
      return;
    }

    let cancelled = false;
    const pendingKeys = new Set(
      lookupItems.map(({ lemma, pos }) => `${lemma}_${pos}`),
    );

    pendingKeys.forEach((key) => inflightKeysRef.current.add(key));
    setLoadingLemma(true);
    setFetchProgress({ completed: 0, total: pendingKeys.size });

    void lemmaLookupProgressively(lookupItems, language, {
      batchSize: 25,
      concurrency: 2,
      onBatch: (lookupData) => {
        if (cancelled) return;

        setFetchProgress((prev) => ({
          ...prev,
          completed: Math.min(prev.total, prev.completed + Object.keys(lookupData).length),
        }));

        setAvailableKeys((prev) => {
          const nextAvailableKeys = { ...prev, ...lookupData };
          availableKeysRef.current = nextAvailableKeys;
          return nextAvailableKeys;
        });
      },
    })
      .then(() => {
        if (cancelled) return;
        pendingKeys.forEach((key) => attemptedKeysRef.current.add(key));
      })
      .catch(() => {})
      .finally(() => {
        if (cancelled) return;

        pendingKeys.forEach((key) => inflightKeysRef.current.delete(key));
        setLoadingLemma(false);
        setFetchProgress({ completed: pendingKeys.size, total: pendingKeys.size });
      });

    return () => {
      cancelled = true;
    };
  }, [lookupItems, language]);

  return (
    <div
      ref={containerRef}
      data-side-layout-no-swipe="true"
      className="relative flex h-full min-h-0 w-full overflow-hidden"
    >
      <div className={`absolute left-1/2 top-2 z-30 -translate-x-1/2 bg-neutral-50/70 backdrop-blur-2xl transition-[opacity,transform] duration-200 ${
        showCenterButton
          ? "pointer-events-auto translate-y-0 opacity-100"
          : "pointer-events-none -translate-y-2 opacity-0"
      }`}>
        <IconButton
          icon={<AlignCenterVertical className="w-4 h-4 md:w-3.5 md:h-3.5" />}
          onClick={() => {
            setShowCenterButton(false);
            rowRefs.current.forEach((r) => r?.setCenter());
          }}
          title={t("Align center")}
        />
      </div>

      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 h-12 bg-gradient-to-b from-neutral-50 via-neutral-50/80 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 h-12 bg-gradient-to-t from-neutral-50 via-neutral-50/80 to-transparent" />

      <div className="h-full w-full shrink-0 flex-col overflow-y-auto py-12 no-scrollbar">
        {data.map((d, i) => (
          <KwicRow
            key={`${lemma}:${d.line_id}:${i}`}
            ref={(el) => {
              rowRefs.current[i] = el;
            }}
            d={d}
            lemma={lemma}
            language={language}
            onSelect={onSelect}
            canSelectKey={canSelectKey}
            hovered={hovered}
            setHovered={setHovered}
            lemmaInfo={availableKeys}
            interestKeys={interestKeys}
            onMisalignedChange={(misaligned) => {
              if (misaligned) setShowCenterButton(true);
            }}
          />
        ))}
      </div>

      <LemmaActivityToast
        open={loadingLemma}
        title={t("Fetching lemmas...")}
        description={`${fetchProgress.completed} / ${fetchProgress.total}`}
        progress={fetchProgress}
        mobileViewport
      />

      {hovered.pos && (
        <div
          className="absolute z-[9999] pointer-events-none px-1 py-0.5 rounded-sm
                    bg-neutral-800 text-neutral-100 text-xs transition-transform duration-75"
          style={{
            left: Math.min(
              (containerRef.current?.clientWidth ?? 0) - 120,
              hovered.x -
                (containerRef.current?.getBoundingClientRect().left ?? 0) +
                12
            ),
            top: Math.min(
              (containerRef.current?.clientHeight ?? 0) - 60,
              hovered.y -
                (containerRef.current?.getBoundingClientRect().top ?? 0) +
                12
            ),
          }}
        >
          {hovered.pos}
        </div>
      )}
    </div>
  );
}
