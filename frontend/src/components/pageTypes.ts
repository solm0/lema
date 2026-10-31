export type MorphToken = {
  surface: string;
  lemma?: string | null;
  pos: string | null;
};

export type Token = {
  surface: string;
  lemma?: string | null;
  pos: string | null;
  morphs?: MorphToken[];
};

export type TextBlock = {
  text: string;
  timestamp_ms?: number | null;
  tokens?: Token[];
};

export type TextAnalysisResult = {
  text: string;
  blocks: TextBlock[];
  track_ref?: TrackReference | null;
};

export type TrackReference = {
  source: string;
  provider_track_id: string | null;
  uri: string | null;
  isrc: string | null;
  title_normalized: string;
  artists_normalized: string[];
  duration_ms: number | null;
};

export type PageSource = "user" | "chrome" | "lrclib" | string;

export type KwicData = {
  line_id: number;
  match_indices: number[];
  tokens: Token[];
  selection_debug?: {
    score: number;
    coverage: number;
    frequency_prior: number;
    known: number;
    exposed: number;
    interested: number;
    scored_tokens: number;
    length: number;
  };
};

export type LemmaData = {
  key: string;
  furigana?: string | null;
  kwic: KwicData[];
  found?: boolean;
  is_interested: boolean;
  global_key: string;
};

export type UserLemmaExample = {
  id: number;
  lemma_key: string;
  language: string;
  text: string;
  tokens: Token[];
  match_indices: number[];
  created_at: string;
  last_seen_at: string;
};

export type UserLemmaExampleCapture = {
  text: string;
  tokens: Token[];
  match_indices: number[];
};

export type UserLemmaState = {
  key: string;
  exposure_count: number;
  is_known: boolean;
  is_interested: boolean;
  memo: string;
  created_at?: string | null;
  updated_at?: string | null;
  decay?: number;
};

export type UserLemmaDatabaseItem = UserLemmaState & {
  lemma: string;
  pos: string;
  language: string;
  decay: number;
};

export type UserLemmaMilestone = {
  count: number;
  achieved_at: string;
};

export type RecapItem = {
  id: number;
  lemma_key: string;
  position: number;
  status: "pending" | "passed" | "failed" | "expired";
  attempt_count: number;
};

export type RecapState = {
  week_start: string;
  available: boolean;
  state: "warming_up" | "ready" | "daily_complete" | "completed";
  remaining_count: number;
  test_items: RecapItem[];
  showcase_items: RecapItem[];
};

export type RecapQuestion = {
  primary_example: { text: string; tokens?: Token[]; match_indices?: number[] };
  extra_examples?: Array<{ text: string; tokens?: Token[]; match_indices?: number[] }>;
  options: Array<{ key: string; label: string }>;
};

export type AnnotationType = "link" | "memo" | "emoji";

export type AnnotationBase = {
  id?: string;
  user_id?: number;
  page_id: string;
  start_index: number;
  end_index: number;
  created_at?: string;
};

export type LinkAnnotation = AnnotationBase & {
  type: "link";
  content: string;
};

export type MemoAnnotation = AnnotationBase & {
  type: "memo";
  content: string;
};

export type EmojiAnnotation = AnnotationBase & {
  type: "emoji";
  content: string;
};

export type Annotation = LinkAnnotation | MemoAnnotation | EmojiAnnotation;
