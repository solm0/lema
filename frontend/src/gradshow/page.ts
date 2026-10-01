import type { TextAnalysisResult } from "../components/pageTypes";
import { GRADSHOW_PAGE_ID } from "./mode";

const blocks: TextAnalysisResult["blocks"] = [
  ["If I could go back to a time before now", 39390, [["If", "if", "SCONJ"], ["I", "i", "PRON"], ["could", "could", "AUX"], ["go", "go", "VERB"], ["back", "back", "ADV"], ["to", "to", "ADP"], ["a", "a", "DET"], ["time", "time", "NOUN"], ["before", "before", "ADV"], ["now", "now", "ADV"]]],
  ["Before I ever fell down", 47790, [["Before", "before", "SCONJ"], ["I", "i", "PRON"], ["ever", "ever", "ADV"], ["fell", "fall", "VERB"], ["down", "down", "ADP"]]],
  ["Go back to a time when I was just a girl", 53090, [["Go", "go", "VERB"], ["back", "back", "ADV"], ["to", "to", "ADP"], ["a", "a", "DET"], ["time", "time", "NOUN"], ["when", "when", "ADV"], ["I", "i", "PRON"], ["was", "be", "AUX"], ["just", "just", "ADV"], ["a", "a", "DET"], ["girl", "girl", "NOUN"]]],
  ["", null, []],
  ["When I had the whole world", 62220, [["When", "when", "ADV"], ["I", "i", "PRON"], ["had", "have", "VERB"], ["the", "the", "DET"], ["whole", "whole", "ADJ"], ["world", "world", "NOUN"]]],
  ["Gently wrapped around me", 66440, [["Gently", "gently", "ADV"], ["wrapped", "wrap", "VERB"], ["around", "around", "ADP"], ["me", "i", "PRON"]]],
  ["And no good thing could be taken away", 75080, [["And", "and", "CCONJ"], ["no", "no", "DET"], ["good", "good", "ADJ"], ["thing", "thing", "NOUN"], ["could", "could", "AUX"], ["be", "be", "AUX"], ["taken", "take", "VERB"], ["away", "away", "ADV"]]],
  ["If I still believe that hearts don't lie", 81650, [["If", "if", "SCONJ"], ["I", "i", "PRON"], ["still", "still", "ADV"], ["believe", "believe", "VERB"], ["that", "that", "SCONJ"], ["hearts", "heart", "NOUN"], ["don't", "do", "AUX"], ["lie", "lie", "VERB"]]],
  ["You're gonna be just fine", 89240, [["You're", "you", "PRON"], ["gonna", "go", "VERB"], ["be", "be", "AUX"], ["just", "just", "ADV"], ["fine", "fine", "ADJ"]]],
  ["But, babe", 95900, [["But,", "but", "CCONJ"], ["babe", "babe", "NOUN"]]],
  ["A lot's gonna change", 102190, [["A", "a", "DET"], ["lot's", "lot", "NOUN"], ["gonna", "go", "VERB"], ["change", "change", "VERB"]]],
  ["In your lifetime", 106620, [["In", "in", "ADP"], ["your", "your", "PRON"], ["lifetime", "lifetime", "NOUN"]]],
  ["", null, []],
  ["Try to leave it all behind", 118780, [["Try", "try", "VERB"], ["to", "to", "PART"], ["leave", "leave", "VERB"], ["it", "it", "PRON"], ["all", "all", "DET"], ["behind", "behind", "ADP"]]],
  ["In your lifetime", 124250, [["In", "in", "ADP"], ["your", "your", "PRON"], ["lifetime", "lifetime", "NOUN"]]],
  ["", null, []],
  ["Born in a century lost to memories", 147820, [["Born", "bear", "VERB"], ["in", "in", "ADP"], ["a", "a", "DET"], ["century", "century", "NOUN"], ["lost", "lose", "VERB"], ["to", "to", "ADP"], ["memories", "memory", "NOUN"]]],
  ["Falling trees, get off your knees", 154610, [["Falling", "fall", "VERB"], ["trees,", "tree", "NOUN"], ["get", "get", "VERB"], ["off", "off", "ADP"], ["your", "your", "PRON"], ["knees", "knee", "NOUN"]]],
  ["No one can keep you down", 160220, [["No", "no", "DET"], ["one", "one", "PRON"], ["can", "can", "AUX"], ["keep", "keep", "VERB"], ["you", "you", "PRON"], ["down", "down", "ADP"]]],
  ["If your friends and your family", 164690, [["If", "if", "SCONJ"], ["your", "your", "PRON"], ["friends", "friend", "NOUN"], ["and", "and", "CCONJ"], ["your", "your", "PRON"], ["family", "family", "NOUN"]]],
  ["Sadly don't stick around", 170170, [["Sadly", "sadly", "ADV"], ["don't", "do", "AUX"], ["stick", "stick", "VERB"], ["around", "around", "ADV"]]],
  ["It's high time you'll learn to get by", 174550, [["It's", "it", "PRON"], ["high", "high", "ADJ"], ["time", "time", "NOUN"], ["you'll", "you", "PRON"], ["learn", "learn", "VERB"], ["to", "to", "PART"], ["get", "get", "VERB"], ["by", "by", "ADP"]]],
  ["", null, []],
  ["'Cause you got what it takes", 187440, [["'Cause", "'", "PUNCT"], ["you", "you", "PRON"], ["got", "get", "VERB"], ["what", "what", "PRON"], ["it", "it", "PRON"], ["takes", "take", "VERB"]]],
  ["In your lifetime", 195810, [["In", "in", "ADP"], ["your", "your", "PRON"], ["lifetime", "lifetime", "NOUN"]]],
  ["", null, []],
  ["Try to leave it all behind", 207850, [["Try", "try", "VERB"], ["to", "to", "PART"], ["leave", "leave", "VERB"], ["it", "it", "PRON"], ["all", "all", "DET"], ["behind", "behind", "ADP"]]],
  ["In your lifetime", 212400, [["In", "in", "ADP"], ["your", "your", "PRON"], ["lifetime", "lifetime", "NOUN"]]],
  ["", null, []],
  ["Let me change my words", 241880, [["Let", "let", "VERB"], ["me", "i", "PRON"], ["change", "change", "VERB"], ["my", "my", "PRON"], ["words", "word", "NOUN"]]],
  ["Show me where it hurts", 247560, [["Show", "show", "VERB"], ["me", "i", "PRON"], ["where", "where", "ADV"], ["it", "it", "PRON"], ["hurts", "hurt", "VERB"]]],
].map(([text, timestamp_ms, tokens]) => ({
  text: text as string,
  ...(timestamp_ms == null ? {} : { timestamp_ms: timestamp_ms as number }),
  tokens: (tokens as string[][]).map(([surface, lemma, pos]) => ({ surface, lemma, pos })),
}));

const result: TextAnalysisResult = {
  text: blocks.map((block) => block.text).join("\n"),
  blocks,
  track_ref: {
    source: "Spotify",
    provider_track_id: null,
    uri: null,
    isrc: null,
    title_normalized: "a lot s gonna change",
    artists_normalized: ["weyes blood"],
    duration_ms: 261947,
  },
};

export const GRADSHOW_PAGE = {
  id: GRADSHOW_PAGE_ID,
  name: "Weyes Blood - A Lot's Gonna Change",
  result,
  notebook_id: null,
  language: "en",
  source: "lrclib",
  metadata: ["A Lot's Gonna Change"],
  created_at: "2026-09-15T02:38:48.037378+00:00",
  updated_at: "2026-09-15T02:38:48.037378+00:00",
};
