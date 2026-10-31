import { useState, type ReactNode } from "react";
import { answerLemmaRecapQuestion, getLemmaProfile, getUserLemmaExamples, lemmaLookupOne, saveLemmaRecapQuestion, startLemmaRecapSession } from "../../api";
import type { KwicData, RecapItem, RecapQuestion, Token } from "../pageTypes";
import { useI18n } from "../../i18n";

type Example = { text: string; tokens?: Token[]; match_indices?: number[] };
type Phase = "question" | "result";
type RevealState = { stage: "circle" | "typing" | "typed"; exampleIndex: number; characters: number; tone?: "green" | "red" };
const keyParts = (key: string) => key.split("/");
const labelFor = (key: string) => keyParts(key)[0] || key;

function targetSurface(example: Example) {
  const index = example.match_indices?.[0];
  return index === undefined ? "" : example.tokens?.[index]?.surface || "";
}

function ExampleLine({ example, exampleIndex, reveal, insertedWord }: { example: Example; exampleIndex: number; reveal: RevealState | null; insertedWord: string }) {
  const surface = targetSurface(example);
  const [before, after] = surface ? example.text.split(surface, 2) : [example.text, ""];
  const isCurrent = reveal?.exampleIndex === exampleIndex;
  const typed = reveal?.stage === "typing" && isCurrent ? insertedWord.slice(0, reveal.characters) : reveal?.stage === "typed" || (reveal?.stage === "typing" && reveal.exampleIndex > exampleIndex) ? insertedWord : "";
  const circle = reveal?.stage === "circle" || (reveal?.stage === "typing" && !typed);
  const tone = reveal?.stage === "typed" ? reveal.tone : undefined;
  return <p className="max-w-[50em] font-body text-xl font-semibold leading-8">
    {before}
    <span
      style={tone === "green" ? { backgroundColor: "var(--app-green-500)" } : tone === "red" ? { backgroundColor: "var(--app-red-500)" } : undefined}
      className={`inline-flex h-9 min-w-24 items-center justify-center rounded-full bg-neutral-300 px-3 text-xl font-body font-semibold text-neutral-700 transition-all duration-500 ${!reveal ? "text-transparent" : ""} ${circle ? "min-w-0 w-9 px-0 text-transparent" : ""}`}
    >
      {typed || "\u00a0"}
    </span>
    {after}
  </p>;
}

async function makeQuestion(item: RecapItem): Promise<RecapQuestion & { answer_key: string }> {
  const [lemma, pos, language] = keyParts(item.lemma_key);
  const userExamples = await getUserLemmaExamples(item.lemma_key);
  let examples: Example[] = userExamples.map((example) => ({ text: example.text, tokens: example.tokens, match_indices: example.match_indices }));
  if (!examples.length) {
    const lookup = await lemmaLookupOne({ lemma, pos }, language);
    examples = (lookup.kwic as KwicData[]).slice(0, 3).map((kwic: KwicData) => ({
      text: kwic.tokens.map((token: Token) => token.surface).join(" "), tokens: kwic.tokens, match_indices: kwic.match_indices,
    }));
  }
  if (!examples.length) throw new Error("recap_example_unavailable");
  const profile = await getLemmaProfile();
  const distractors = Object.keys(profile).filter((key) => {
    const [, candidatePos, candidateLanguage] = keyParts(key);
    return key !== item.lemma_key && candidatePos === pos && candidateLanguage === language;
  }).sort(() => Math.random() - 0.5).slice(0, 3);
  if (distractors.length < 3) throw new Error("recap_distractors_unavailable");
  return {
    answer_key: item.lemma_key,
    primary_example: examples[0],
    extra_examples: examples.slice(1, 3),
    options: [item.lemma_key, ...distractors].sort(() => Math.random() - 0.5).map((key) => ({ key, label: labelFor(key) })),
  };
}

export function Recap({ onFinished, languages = [], renderTrigger }: {
  onFinished: () => void;
  languages?: string[];
  renderTrigger?: (props: { start: () => void; loading: boolean }) => ReactNode;
}) {
  const { t } = useI18n();
  const [active, setActive] = useState(false);
  const [items, setItems] = useState<RecapItem[]>([]);
  const [index, setIndex] = useState(0);
  const [question, setQuestion] = useState<RecapQuestion | null>(null);
  const [disabled, setDisabled] = useState<string[]>([]);
  const [wrongChoice, setWrongChoice] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<"passed" | "failed" | null>(null);
  const [reveal, setReveal] = useState<RevealState | null>(null);
  const [insertedWord, setInsertedWord] = useState("");
  const [checking, setChecking] = useState(false);
  const [fadeQuestion, setFadeQuestion] = useState(false);
  const [phase, setPhase] = useState<Phase>("question");
  const [extraShown, setExtraShown] = useState(0);
  const [loading, setLoading] = useState(false);
  const [moving, setMoving] = useState<"in" | "out" | null>(null);
  const [error, setError] = useState("");

  const loadQuestion = async (nextItem: RecapItem) => {
    setLoading(true); setError(""); setQuestion(null); setDisabled([]); setWrongChoice(null); setFeedback(null); setReveal(null); setInsertedWord(""); setChecking(false); setFadeQuestion(false); setPhase("question"); setExtraShown(0);
    try {
      setQuestion(await saveLemmaRecapQuestion(nextItem.id, await makeQuestion(nextItem)));
    } catch {
      setError(t("Could not prepare this Revival question. Try again shortly."));
    } finally { setLoading(false); }
  };

  const start = async () => {
    setLoading(true); setError("");
    try {
      const session = await startLemmaRecapSession(languages);
      const firstPendingIndex = session.items.findIndex((item) => item.status === "pending");
      if (firstPendingIndex < 0) throw new Error("recap_session_complete");
      setItems(session.items); setIndex(firstPendingIndex); setActive(true);
      await loadQuestion(session.items[firstPendingIndex]);
    } catch { setError(t("Today's Revival is unavailable right now.")); }
    finally { setLoading(false); }
  };

  const revealResult = (result: "passed" | "failed") => {
    setFeedback(result);
    setFadeQuestion(true);
    window.setTimeout(() => setPhase("result"), 300);
  };
  const revealAnswer = async (result: "passed" | "failed", choiceKey: string, retryAvailable: boolean) => {
    if (!question) return;
    const examples = [question.primary_example, ...(question.extra_examples ?? [])];
    const answerIndex = examples.findIndex((example) => targetSurface(example));
    setChecking(true);
    setInsertedWord(labelFor(choiceKey));
    setExtraShown(question.extra_examples?.length ?? 0);
    setReveal({ stage: "circle", exampleIndex: Math.max(0, answerIndex), characters: 0 });
    await new Promise((resolve) => window.setTimeout(resolve, 250));
    for (let exampleIndex = 0; exampleIndex < examples.length; exampleIndex += 1) {
      const word = labelFor(choiceKey);
      for (let characters = 0; characters <= word.length; characters += 1) {
        setReveal({ stage: "typing", exampleIndex, characters });
        await new Promise((resolve) => window.setTimeout(resolve, 90));
      }
    }
    setReveal({ stage: "typed", exampleIndex: examples.length - 1, characters: 0, tone: result === "passed" ? "green" : "red" });
    if (result === "failed") {
      setDisabled((current) => [...current, choiceKey]);
      await new Promise((resolve) => window.setTimeout(resolve, 1000));
      setWrongChoice(choiceKey);
      await new Promise((resolve) => window.setTimeout(resolve, 1000));
      setWrongChoice(null);
    } else {
      await new Promise((resolve) => window.setTimeout(resolve, 1000));
    }
    if (retryAvailable) {
      setReveal(null);
      setChecking(false);
      return;
    }
    setChecking(false);
    revealResult(result);
  };
  const answer = async (choiceKey: string) => {
    if (!question || feedback || disabled.includes(choiceKey) || loading || checking) return;
    const result = await answerLemmaRecapQuestion(items[index].id, choiceKey, disabled.length > 0);
    await revealAnswer(result.correct ? "passed" : "failed", choiceKey, result.retry_available);
  };
  const next = async () => {
    const nextIndex = index + 1;
    if (nextIndex >= items.length) { setActive(false); onFinished(); return; }
    setMoving("out");
    window.setTimeout(async () => {
      setIndex(nextIndex); setMoving("in"); await loadQuestion(items[nextIndex]);
      window.setTimeout(() => setMoving(null), 240);
    }, 220);
  };

  if (!active) return <>
    {renderTrigger ? renderTrigger({ start: () => void start(), loading }) : (
      <button type="button" onClick={() => void start()} disabled={loading} className="rounded-full bg-neutral-900 px-4 py-2 text-sm text-white disabled:opacity-50">{t("Start Revival")}</button>
    )}
    {error && <p className="mt-2 text-sm text-neutral-400">{error}</p>}
  </>;

  const contentMotion = moving === "out" ? "-translate-x-8 opacity-0" : moving === "in" ? "translate-x-8 opacity-0" : "translate-x-0 opacity-100";
  return <div className="w-full rounded-3xl bg-neutral-200 p-7">
    <div className="flex flex-col gap-14">
      <div className="flex h-2 w-full gap-2">
        {items.map((item, itemIndex) => <span key={item.id} className={`h-full flex-1 rounded-full transition-colors duration-300 ${itemIndex === index ? "bg-accent" : "bg-neutral-300"}`} />)}
      </div>
      <div className={`flex flex-col gap-14 transition-all duration-200 ${contentMotion}`}>
      {loading && <p className="text-neutral-700 text-xl font-semibold">{t("Preparing question...")}</p>}
      {error && <p className="text-red-100">{error}</p>}
      {question && !loading && phase === "question" && (
        <div className={`flex flex-col gap-14 transition-opacity duration-300 ${fadeQuestion ? "opacity-0" : "opacity-100"}`}>
          <div className="flex flex-col gap-4">
            <ExampleLine example={question.primary_example} exampleIndex={0} reveal={reveal} insertedWord={insertedWord} />
            {extraShown > 0 && question.extra_examples?.slice(0, extraShown).map((example, extraIndex) => <ExampleLine key={extraIndex} example={example} exampleIndex={extraIndex + 1} reveal={reveal} insertedWord={insertedWord} />)}
            {question.extra_examples?.[extraShown] && <button type="button" onClick={() => setExtraShown((current) => current + 1)} className="self-start text-sm text-neutral-500 opacity-80 hover:opacity-100 font-medium transition-opacity">{t("See another example")}</button>}
          </div>
          <div className="flex flex-wrap gap-2">
            {question.options.map((option) => {
              const wrong = disabled.includes(option.key);
              return <button key={option.key} type="button" disabled={wrong || feedback !== null || checking} onClick={() => void answer(option.key)} className={`h-9 w-auto rounded-full border-3 border-neutral-700 px-4 pb-1 text-xl font-body font-semibold transition-colors duration-300 hover:bg-neutral-700 hover:text-neutral-100 disabled:pointer-events-none ${wrong ? "recap-wrong" : ""} ${wrongChoice === option.key ? "recap-shake" : ""}`}>{option.label}</button>;
            })}
          </div>
        </div>
      )}
      {phase === "result" && <div className="flex flex-col gap-7">
        <div className="flex flex-col gap-2 text-neutral-50">
          <p className="text-2xl font-semibold text-neutral-700">{feedback === "passed" ? t("Revived!") : t("Not this time.")}</p>
          <p className="text-neutral-700/80">{feedback === "passed" ? t("That lemma is fresh again.") : t("The answer was {lemma}.", { lemma: labelFor(items[index].lemma_key) })}</p>
        </div>
        <button type="button" onClick={() => void next()} className="self-end rounded-full bg-neutral-50 px-5 py-2 text-xl font-semibold">{index + 1 === items.length ? t("Finish today's Revival") : t("Next lemma")}</button>
      </div>}
      </div>
    </div>
  </div>;
}
