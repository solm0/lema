import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import Breadcrumb, { type D3Node } from "./Breadcrumb.tsx";
import type { TreeNode } from "../../types.ts";
import type {
  LemmaData,
  UserLemmaExample,
  UserLemmaExampleCapture,
  UserLemmaState,
} from "../pageTypes.ts";
import LemmaExpansionWrapper from "./LemmaExpansionWrapper.tsx";
import {
  getLemmaProfile,
  getUserLemmaExamples,
  saveUserLemmaExample,
  updateLemmaState,
} from "../../api.ts";
import { isCapacitorApp } from "../../platform.ts";
import KnownWordsMilestoneToast, {
  type KnownWordsMilestone,
} from "./KnownWordsMilestoneToast.tsx";
import { isKnownWordsMilestone } from "./knownWordMilestones.ts";
import { useOptionalLayout } from "../RootLayout.tsx";

const EXPOSURE_DELAY_MS = 750;
const USER_EXAMPLE_DELAY_MS = 5_000;
const MAX_EXPOSURE_COUNT = 10;

export type DeskHandle = {
  markActiveKnown: () => Promise<void>;
};

type DeskProps = {
  initialLemma: LemmaData;
  onToggleInterest: (key: string, next: boolean) => Promise<void>;
  language: string;
  lemmaInfo?: Record<string, LemmaData>;
  interestKeys?: Set<string>;
  userExampleCapture?: UserLemmaExampleCapture;
  onKnownWordsMilestone?: (milestone: KnownWordsMilestone) => void;
  startMemoEditing?: boolean;
};

function toGlobalKey(localKey: string, language: string) {
  const parts = localKey.split("_");
  const pos = parts.pop() ?? "";
  return `${parts.join("_")}/${pos}/${language}`;
}

const Desk = forwardRef<DeskHandle, DeskProps>(function Desk(
  {
    initialLemma,
    onToggleInterest,
    language,
    lemmaInfo,
    interestKeys,
    userExampleCapture,
    onKnownWordsMilestone,
    startMemoEditing,
  },
  ref
) {
  const layout = useOptionalLayout();
  const breadcrumbRef = useRef<{
    addNode: (parentLemma: string, newNode: TreeNode) => void;
  }>(null);
  const [activeNode, setActiveNode] = useState<D3Node | null>(null);
  const [lemmaDatas, setLemmaDatas] = useState<LemmaData[]>([initialLemma]);
  const [activeKey, setActiveKey] = useState<string | null>(initialLemma.key);
  const [lemmaStatus, setLemmaStatus] = useState<
    Record<string, "loading" | "ready">
  >({});
  const [profile, setProfile] = useState<Record<string, UserLemmaState>>({});
  const [hasExplored, setHasExplored] = useState(false);
  const [knownWordsMilestone, setKnownWordsMilestone] =
    useState<KnownWordsMilestone | null>(null);
  const [isMemoEditing, setIsMemoEditing] = useState(false);
  const [userExamples, setUserExamples] = useState<UserLemmaExample[]>([]);
  const breadcrumbOpen = layout?.breadcrumbOpen ?? true;
  const profileRef = useRef(profile);
  const profileLoadRef = useRef<Promise<Record<string, UserLemmaState>> | null>(
    null
  );
  const knownCountsRef = useRef<Record<string, number>>({});
  const exposedThisSessionRef = useRef(new Set<string>());
  const prevActiveLemmaRef = useRef<string | null>(null);
  const savedUserExampleRef = useRef(false);

  useEffect(() => {
    profileRef.current = profile;
  }, [profile]);

  useEffect(() => {
    let cancelled = false;
    const profileLoad = getLemmaProfile();
    profileLoadRef.current = profileLoad;
    void profileLoad.then((items) => {
      const counts: Record<string, number> = {};
      Object.values(items).forEach((item) => {
        if (!item.is_known) return;
        const itemLanguage = item.key.split("/").at(-1);
        if (!itemLanguage) return;
        counts[itemLanguage] = (counts[itemLanguage] ?? 0) + 1;
      });
      knownCountsRef.current = counts;
      profileRef.current = items;
      if (!cancelled) setProfile(items);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const activeData = lemmaDatas.find((item) => item.key === activeKey);
  const activeGlobalKey = activeKey
    ? activeData?.global_key ?? toGlobalKey(activeKey, language)
    : null;
  const initialGlobalKey =
    initialLemma.global_key ?? toGlobalKey(initialLemma.key, language);

  useEffect(() => {
    let cancelled = false;
    void getUserLemmaExamples(activeGlobalKey ?? initialGlobalKey)
      .then((examples) => {
        if (!cancelled) setUserExamples(examples);
      })
      .catch(() => {
        if (!cancelled) setUserExamples([]);
      });
    return () => {
      cancelled = true;
    };
  }, [activeGlobalKey, initialGlobalKey]);

  useEffect(() => {
    if (
      !userExampleCapture ||
      savedUserExampleRef.current ||
      activeKey !== initialLemma.key
    )
      return;

    let remaining = USER_EXAMPLE_DELAY_MS;
    let startedAt = 0;
    let timer: number | null = null;
    let cancelled = false;

    const clearTimer = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
    };
    const save = () => {
      if (cancelled || savedUserExampleRef.current) return;
      savedUserExampleRef.current = true;
      void saveUserLemmaExample({
        lemma_key: initialGlobalKey,
        language,
        ...userExampleCapture,
      }).catch(() => undefined);
    };
    const resume = () => {
      if (document.visibilityState !== "visible" || timer !== null) return;
      startedAt = performance.now();
      timer = window.setTimeout(save, remaining);
    };
    const pause = () => {
      if (timer === null) return;
      remaining = Math.max(0, remaining - (performance.now() - startedAt));
      clearTimer();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") resume();
      else pause();
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    resume();
    return () => {
      cancelled = true;
      clearTimer();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [
    activeKey,
    initialGlobalKey,
    initialLemma.key,
    language,
    userExampleCapture,
  ]);

  useEffect(() => {
    if (!activeGlobalKey || exposedThisSessionRef.current.has(activeGlobalKey))
      return;
    const timer = window.setTimeout(() => {
      if (exposedThisSessionRef.current.has(activeGlobalKey)) return;
      exposedThisSessionRef.current.add(activeGlobalKey);
      const current = profileRef.current[activeGlobalKey];
      const exposure_count = Math.min(
        MAX_EXPOSURE_COUNT,
        (current?.exposure_count ?? 0) + 1
      );
      const next: UserLemmaState = {
        key: activeGlobalKey,
        exposure_count,
        is_known: current?.is_known ?? false,
        is_interested:
          current?.is_interested ?? interestKeys?.has(activeGlobalKey) ?? false,
        memo: current?.memo ?? "",
        created_at: current?.created_at ?? new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      profileRef.current = { ...profileRef.current, [activeGlobalKey]: next };
      setProfile(profileRef.current);
      void updateLemmaState(activeGlobalKey, { exposure_count }).then(
        (saved) => {
          if (!saved) return;
          profileRef.current = {
            ...profileRef.current,
            [activeGlobalKey]: saved,
          };
          setProfile(profileRef.current);
        }
      );
    }, EXPOSURE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [activeGlobalKey, interestKeys]);

  const setActiveKnown = useCallback(
    async (isKnown: boolean) => {
      if (!activeGlobalKey) return;
      await profileLoadRef.current;
      const current = profileRef.current[activeGlobalKey];
      if ((current?.is_known ?? false) === isKnown) return;
      const next: UserLemmaState = {
        key: activeGlobalKey,
        exposure_count: current?.exposure_count ?? 0,
        is_known: isKnown,
        is_interested:
          current?.is_interested ?? interestKeys?.has(activeGlobalKey) ?? false,
        memo: current?.memo ?? "",
        created_at: current?.created_at ?? new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      profileRef.current = { ...profileRef.current, [activeGlobalKey]: next };
      setProfile(profileRef.current);
      const activeLanguage = activeGlobalKey.split("/").at(-1) ?? language;
      const knownCount = Math.max(
        0,
        (knownCountsRef.current[activeLanguage] ?? 0) + (isKnown ? 1 : -1)
      );
      knownCountsRef.current = {
        ...knownCountsRef.current,
        [activeLanguage]: knownCount,
      };
      if (isKnown && isKnownWordsMilestone(knownCount)) {
        const milestone = { count: knownCount, language: activeLanguage };
        if (isCapacitorApp() || window.innerWidth < 768) {
          onKnownWordsMilestone?.(milestone);
        } else {
          setKnownWordsMilestone(milestone);
        }
      }
      const saved = await updateLemmaState(activeGlobalKey, {
        is_known: isKnown,
      });
      if (saved) {
        profileRef.current = {
          ...profileRef.current,
          [activeGlobalKey]: saved,
        };
        setProfile(profileRef.current);
      }
    },
    [activeGlobalKey, interestKeys, language, onKnownWordsMilestone]
  );

  const setActiveMemo = useCallback(
    async (memo: string) => {
      if (!activeGlobalKey) return;
      await profileLoadRef.current;
      const current = profileRef.current[activeGlobalKey];
      if ((current?.memo ?? "") === memo) return;
      const next: UserLemmaState = {
        key: activeGlobalKey,
        exposure_count: current?.exposure_count ?? 0,
        is_known: current?.is_known ?? false,
        is_interested:
          current?.is_interested ?? interestKeys?.has(activeGlobalKey) ?? false,
        memo,
        created_at: current?.created_at ?? new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      profileRef.current = { ...profileRef.current, [activeGlobalKey]: next };
      setProfile(profileRef.current);
      const saved = await updateLemmaState(activeGlobalKey, { memo });
      if (saved) {
        profileRef.current = {
          ...profileRef.current,
          [activeGlobalKey]: saved,
        };
        setProfile(profileRef.current);
      }
    },
    [activeGlobalKey, interestKeys]
  );

  const markActiveKnown = useCallback(
    () => setActiveKnown(true),
    [setActiveKnown]
  );

  useImperativeHandle(ref, () => ({ markActiveKnown }), [markActiveKnown]);

  const addLemmaData = useCallback(
    (lemmaData: LemmaData, autoActivate = true) => {
      setLemmaDatas((prev) =>
        prev.find((item) => item.key === lemmaData.key)
          ? prev
          : [...prev, lemmaData]
      );
      if (autoActivate) setActiveKey(lemmaData.key);
    },
    []
  );

  useEffect(() => {
    const nextLemmaKey = activeNode?.data.lemma ?? null;
    if (prevActiveLemmaRef.current === nextLemmaKey) return;
    prevActiveLemmaRef.current = nextLemmaKey;
    if (!nextLemmaKey) return;
    const hasLemmaData = lemmaDatas.some((item) => item.key === nextLemmaKey);
    if (hasLemmaData && lemmaStatus[nextLemmaKey] !== "loading")
      setActiveKey(nextLemmaKey);
  }, [activeNode, lemmaDatas, lemmaStatus]);

  useEffect(() => {
    if (!activeKey || lemmaStatus[activeKey] !== "ready") return;
    setLemmaStatus((prev) => {
      const next = { ...prev };
      delete next[activeKey];
      return next;
    });
  }, [activeKey, lemmaStatus]);

  const handleTokenSelect = (tokenKey: string) => {
    const parentLemma = activeNode?.data.lemma ?? activeKey;
    if (!parentLemma) return;
    setHasExplored(true);
    breadcrumbRef.current?.addNode(parentLemma, { lemma: tokenKey });
  };

  return (
    <div className="relative flex h-full w-full flex-col gap-1 overflow-visible md:gap-0 md:overflow-hidden">
      <KnownWordsMilestoneToast
        milestone={knownWordsMilestone}
        onClose={() => setKnownWordsMilestone(null)}
      />
      <div
        className={`grid shrink-0 overflow-hidden rounded-3xl bg-neutral-50 transition-[grid-template-rows,opacity] duration-300 ease-in-out md:rounded-none ${
          hasExplored
            ? "grid-rows-[1fr] opacity-100"
            : "grid-rows-[0fr] opacity-0"
        } ${
          breadcrumbOpen
            ? "md:grid-rows-[1fr] md:opacity-100"
            : "md:grid-rows-[0fr] md:opacity-0"
        }`}
      >
        <div className="min-h-0 overflow-hidden">
          <Breadcrumb
            ref={breadcrumbRef}
            initialLemmaKey={initialLemma.key}
            activeNode={activeNode}
            setActiveNode={setActiveNode}
            nodeStatusByLemma={lemmaStatus}
          />
        </div>
      </div>
      <div
        className={`${
          isMemoEditing ? "h-[min(22vh,8.667rem)]" : "h-[min(66vh,26rem)]"
        } min-h-0 overflow-hidden rounded-3xl bg-neutral-50 shadow-xl transition-[height,margin] duration-300 ease-in-out md:h-auto md:flex-1 md:rounded-none md:border-t md:border-neutral-200 md:shadow-none ${
          breadcrumbOpen ? "md:mt-0" : "md:mt-10"
        }`}
      >
        <LemmaExpansionWrapper
          activeNode={activeNode}
          lemmaDatas={lemmaDatas}
          activeKey={activeKey}
          addLemmaData={addLemmaData}
          onLemmaFetchStart={(lemmaKey) =>
            setLemmaStatus((prev) => ({ ...prev, [lemmaKey]: "loading" }))
          }
          onLemmaFetchSuccess={(lemmaKey) =>
            setLemmaStatus((prev) => ({ ...prev, [lemmaKey]: "ready" }))
          }
          onLemmaFetchError={(lemmaKey) =>
            setLemmaStatus((prev) => {
              const next = { ...prev };
              delete next[lemmaKey];
              return next;
            })
          }
          onSelect={handleTokenSelect}
          onToggleInterest={onToggleInterest}
          language={language}
          lemmaInfo={lemmaInfo}
          interestKeys={interestKeys}
          isKnown={
            activeGlobalKey
              ? profile[activeGlobalKey]?.is_known ?? false
              : false
          }
          onToggleKnown={setActiveKnown}
          memo={activeGlobalKey ? profile[activeGlobalKey]?.memo ?? "" : ""}
          userExamples={userExamples}
          onSaveMemo={setActiveMemo}
          onMemoEditingChange={setIsMemoEditing}
          startMemoEditing={startMemoEditing}
        />
      </div>
    </div>
  );
});

export default Desk;
