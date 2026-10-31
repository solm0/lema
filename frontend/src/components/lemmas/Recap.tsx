import { useState } from "react";
import {
  answerLemmaRecapQuestion,
  getLemmaProfile,
  getUserLemmaExamples,
  lemmaLookupOne,
  saveLemmaRecapQuestion,
  startLemmaRecapSession,
} from "../../api";
import type { KwicData, RecapItem, RecapQuestion, Token } from "../pageTypes";
import { ResponsiveModal } from "../util/ResponsiveModal";

type Example = { text: string; tokens?: Token[]; match_indices?: number[] };

const keyParts = (key: string) => key.split("/");
const labelFor = (key: string) => keyParts(key)[0] || key;

function maskExample(example: Example) {
  const index = example.match_indices?.[0];
  const surface = index === undefined ? "" : example.tokens?.[index]?.surface || "";
  return surface ? example.text.replace(surface, "____") : example.text;
}

async function makeQuestion(item: RecapItem): Promise<RecapQuestion & { answer_key: string }> {
  const [lemma, pos, language] = keyParts(item.lemma_key);
  const userExamples = await getUserLemmaExamples(item.lemma_key);
  let examples: Example[] = userExamples.map((example) => ({
    text: example.text,
    tokens: example.tokens,
    match_indices: example.match_indices,
  }));
  if (!examples.length) {
    const lookup = await lemmaLookupOne({ lemma, pos }, language);
    examples = (lookup.kwic as KwicData[]).slice(0, 3).map((kwic: KwicData) => ({
      text: kwic.tokens.map((token: Token) => token.surface).join(" "),
      tokens: kwic.tokens,
      match_indices: kwic.match_indices,
    }));
  }
  if (!examples.length) throw new Error("recap_example_unavailable");

  const profile = await getLemmaProfile();
  const distractors = Object.keys(profile)
    .filter((key) => {
      const [, candidatePos, candidateLanguage] = keyParts(key);
      return key !== item.lemma_key && candidatePos === pos && candidateLanguage === language;
    })
    .sort(() => Math.random() - 0.5)
    .slice(0, 3);
  if (distractors.length < 3) throw new Error("recap_distractors_unavailable");
  const options = [item.lemma_key, ...distractors]
    .sort(() => Math.random() - 0.5)
    .map((key) => ({ key, label: labelFor(key) }));
  return {
    answer_key: item.lemma_key,
    primary_example: examples[0],
    extra_examples: examples.slice(1, 3),
    options,
  };
}

export function Recap({ onFinished }: { onFinished: () => void }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<RecapItem[]>([]);
  const [index, setIndex] = useState(0);
  const [question, setQuestion] = useState<RecapQuestion | null>(null);
  const [disabled, setDisabled] = useState<string[]>([]);
  const [feedback, setFeedback] = useState<"passed" | "failed" | null>(null);
  const [extraShown, setExtraShown] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const loadQuestion = async (nextItem: RecapItem) => {
    setLoading(true);
    setError("");
    setQuestion(null);
    setDisabled([]);
    setFeedback(null);
    setExtraShown(0);
    try {
      const saved = await saveLemmaRecapQuestion(nextItem.id, await makeQuestion(nextItem));
      setQuestion(saved);
    } catch {
      setError("리캡 문제를 준비하지 못했어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      setLoading(false);
    }
  };

  const start = async () => {
    setLoading(true);
    setError("");
    try {
      const session = await startLemmaRecapSession();
      setItems(session.items);
      setIndex(0);
      setOpen(true);
      await loadQuestion(session.items[0]);
    } catch {
      setError("오늘의 리캡은 이미 완료했거나 아직 준비 중이에요.");
    } finally {
      setLoading(false);
    }
  };

  const answer = async (choiceKey: string) => {
    if (!question || feedback || disabled.includes(choiceKey)) return;
    const result = await answerLemmaRecapQuestion(items[index].id, choiceKey);
    if (result.correct) setFeedback("passed");
    else if (result.retry_available) setDisabled((current) => [...current, choiceKey]);
    else setFeedback("failed");
  };

  const next = async () => {
    const nextIndex = index + 1;
    if (nextIndex >= items.length) {
      setOpen(false);
      onFinished();
      return;
    }
    setIndex(nextIndex);
    await loadQuestion(items[nextIndex]);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => void start()}
        disabled={loading}
        className="rounded-full bg-neutral-900 px-4 py-2 text-sm text-white disabled:opacity-50"
      >
        Lemma Revival 시작하기
      </button>
      {error && !open && <p className="mt-2 text-sm text-neutral-400">{error}</p>}
      <ResponsiveModal open={open} onClose={() => setOpen(false)}>
        <div className="flex max-w-lg flex-col gap-5 p-2">
          <div>
            <p className="text-xs text-neutral-400">오늘의 Lemma Revival · {index + 1}/{items.length}</p>
            <h3 className="mt-1">빈칸에 들어갈 단어를 골라 주세요</h3>
          </div>
          {loading && <p className="text-sm text-neutral-400">문제를 준비하고 있어요.</p>}
          {error && <p className="text-sm text-red-500">{error}</p>}
          {question && !loading && <>
            <p className="rounded-xl bg-neutral-100 p-4 leading-7">{maskExample(question.primary_example)}</p>
            {(disabled.length > 0 || extraShown > 0) && question.extra_examples?.slice(0, Math.max(1, extraShown)).map((example, extraIndex) => (
              <p key={extraIndex} className="rounded-xl bg-neutral-100 p-4 leading-7">{maskExample(example)}</p>
            ))}
            {!feedback && question.extra_examples?.[extraShown] && (
              <button type="button" onClick={() => setExtraShown((current) => current + 1)}
                className="self-start text-sm text-neutral-500 underline underline-offset-4">
                다른 예문 보기
              </button>
            )}
            <div className="grid grid-cols-2 gap-2">
              {question.options.map((option) => (
                <button key={option.key} type="button" disabled={disabled.includes(option.key) || !!feedback}
                  onClick={() => void answer(option.key)}
                  className="rounded-lg border border-neutral-200 px-3 py-3 text-left disabled:opacity-35">
                  {option.label}
                </button>
              ))}
            </div>
            {feedback && <div className="flex flex-col gap-3">
              <p className={feedback === "passed" ? "text-accent" : "text-neutral-500"}>
                {feedback === "passed" ? "되살렸어요." : `정답은 ${labelFor(items[index].lemma_key)}예요.`}
              </p>
              {feedback === "passed" && question.extra_examples?.map((example, extraIndex) => (
                <p key={extraIndex} className="rounded-xl bg-neutral-100 p-3 text-sm">{example.text}</p>
              ))}
              <button type="button" onClick={() => void next()} className="self-end rounded-full bg-neutral-900 px-4 py-2 text-sm text-white">
                {index + 1 === items.length ? "오늘의 리캡 완료" : "다음 단어"}
              </button>
            </div>}
          </>}
        </div>
      </ResponsiveModal>
    </>
  );
}
