package com.solmi.lema;

import com.worksap.nlp.sudachi.Dictionary;
import com.worksap.nlp.sudachi.DictionaryFactory;
import com.worksap.nlp.sudachi.Morpheme;
import com.worksap.nlp.sudachi.Tokenizer;

import java.io.File;
import java.text.Normalizer;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/** Japanese analyzer backed by a pack-owned Sudachi core dictionary. */
final class JapaneseNlpAnalyzer {
    static final String MODEL_DIRECTORY = "sudachi";
    static final String SYSTEM_DICTIONARY = "system_core.dic";

    private static final Set<String> STOP_POS = new HashSet<>(Arrays.asList(
        "ADP", "AUX", "CCONJ", "DET", "PART", "PRON", "SCONJ", "PUNCT", "SYM"
    ));
    private static final List<String> PACK_POS_FALLBACKS = Arrays.asList(
        "NOUN", "PROPN", "VERB", "ADJ", "ADV", "NUM", "AUX", "INTJ", "X"
    );

    static final class Morph {
        final String surface;
        final String lemma;
        final String pos;

        Morph(String surface, String lemma, String pos) {
            this.surface = surface;
            this.lemma = lemma;
            this.pos = pos;
        }
    }

    static final class Token {
        final String surface;
        final String lemma;
        final String pos;
        final List<Morph> morphs;

        Token(String surface, String lemma, String pos, List<Morph> morphs) {
            this.surface = surface;
            this.lemma = lemma;
            this.pos = pos;
            this.morphs = morphs;
        }
    }

    private final Tokenizer tokenizer;
    private final LemmaKeyLookup lemmaKeyLookup;

    private static final class Annotation {
        final String lemma;
        final String pos;

        Annotation(String lemma, String pos) {
            this.lemma = lemma;
            this.pos = pos;
        }
    }

    JapaneseNlpAnalyzer(File modelDirectory, LemmaKeyLookup lemmaKeyLookup) throws Exception {
        if (!modelsAvailable(modelDirectory)) {
            throw new IllegalStateException(
                "Japanese Sudachi dictionary is incomplete: " + modelDirectory.getAbsolutePath()
            );
        }
        // The legacy String overload remains available in Sudachi 0.7.x and
        // avoids requiring java.nio.file APIs below this app's API 24 minimum.
        Dictionary dictionary = new DictionaryFactory().create(
            modelDirectory.getAbsolutePath(),
            "{\"systemDict\":\"" + SYSTEM_DICTIONARY + "\"}",
            true
        );
        tokenizer = dictionary.create();
        this.lemmaKeyLookup = lemmaKeyLookup;
    }

    static boolean modelsAvailable(File modelDirectory) {
        File dictionary = modelDirectory == null ? null : new File(modelDirectory, SYSTEM_DICTIONARY);
        return dictionary != null && dictionary.isFile() && dictionary.length() > 0;
    }

    synchronized List<Token> analyze(String rawText) {
        String text = Normalizer.normalize(rawText, Normalizer.Form.NFC);
        List<Token> output = new ArrayList<>();
        // The pack was generated from Stanza's word-level tokens.  Sudachi's
        // A mode is its coarsest word boundary and is consequently the closest
        // equivalent; C mode exposes smaller dictionary components instead.
        List<Morpheme> morphemes = tokenizer.tokenize(Tokenizer.SplitMode.A, text);
        for (int index = 0; index < morphemes.size(); index++) {
            Morpheme morpheme = morphemes.get(index);
            String surface = morpheme.surface();
            // The quality fixture separates source tokens with spaces.  Spaces
            // are not lexical tokens in the desktop/server analyzer and must
            // not leak into the Android result either.
            if (surface.trim().isEmpty()) continue;
            String dictionaryForm = morpheme.dictionaryForm();
            String pos = mapPos(morpheme.partOfSpeech());
            String dictionaryLemma = normalize(dictionaryForm);
            if ("NOUN".equals(pos)
                && followsSahenAuxiliary(morphemes, index)
                && dictionaryLemma != null
                && lemmaKeyLookup != null
                && lemmaKeyLookup.contains(dictionaryLemma, "VERB")) {
                // Stanza annotates a サ変 noun immediately followed by する as
                // a verb.  Preserve that pack convention when its verb key is
                // actually present, rather than globally reclassifying nouns.
                pos = "VERB";
            }
            Annotation annotation = reconcile(
                dictionaryForm, morpheme.normalizedForm(), surface, pos
            );
            List<Morph> morphs = new ArrayList<>(1);
            morphs.add(new Morph(surface, annotation.lemma, annotation.pos));
            output.add(new Token(surface, annotation.lemma, annotation.pos, morphs));
        }
        return output;
    }

    private Annotation reconcile(
        String dictionaryForm, String normalizedForm, String surface, String pos
    ) {
        String lemma = normalize(dictionaryForm);
        if (lemma == null || pos == null || STOP_POS.contains(pos)) return new Annotation(null, pos);
        if (lemmaKeyLookup == null || lemmaKeyLookup.contains(lemma, pos)) {
            return new Annotation(lemma, pos);
        }

        LinkedHashSet<String> candidates = new LinkedHashSet<>();
        addCandidate(candidates, normalizedForm, pos);
        addCandidate(candidates, surface, pos);
        for (String fallback : PACK_POS_FALLBACKS) addCandidate(candidates, normalizedForm, fallback);
        if ("NOUN".equals(pos)) addCandidate(candidates, lemma, "PROPN");
        if ("PROPN".equals(pos)) addCandidate(candidates, lemma, "NOUN");
        for (String fallback : PACK_POS_FALLBACKS) addCandidate(candidates, lemma, fallback);
        for (String candidate : candidates) {
            int separator = candidate.lastIndexOf('\t');
            String candidateLemma = candidate.substring(0, separator);
            String candidatePos = candidate.substring(separator + 1);
            if (lemmaKeyLookup.contains(candidateLemma, candidatePos)) {
                return new Annotation(candidateLemma, candidatePos);
            }
        }
        return new Annotation(lemma, pos);
    }

    private static void addCandidate(Set<String> candidates, String lemma, String pos) {
        String normalized = normalize(lemma);
        if (normalized != null && pos != null && !STOP_POS.contains(pos)) {
            candidates.add(normalized + '\t' + pos);
        }
    }

    private static String mapPos(List<String> parts) {
        String major = parts == null || parts.isEmpty() ? "" : parts.get(0);
        String detail = parts != null && parts.size() > 1 ? parts.get(1) : "";
        if ("数詞".equals(detail)) return "NUM";
        if ("名詞".equals(major)) return "固有名詞".equals(detail) ? "PROPN" : "NOUN";
        if ("動詞".equals(major)) return "VERB";
        if ("形容詞".equals(major)) return "ADJ";
        if ("副詞".equals(major)) return "ADV";
        if ("連体詞".equals(major)) return "DET";
        if ("代名詞".equals(major)) return "PRON";
        if ("助詞".equals(major)) return "格助詞".equals(detail) ? "ADP" : "PART";
        if ("助動詞".equals(major)) return "AUX";
        if ("接続詞".equals(major)) return "SCONJ";
        if ("感動詞".equals(major)) return "INTJ";
        if ("補助記号".equals(major) || "記号".equals(major)) return "PUNCT";
        if ("数詞".equals(major)) return "NUM";
        return "X";
    }

    private static boolean followsSahenAuxiliary(List<Morpheme> morphemes, int index) {
        int next = index + 1;
        // Test/bridge callers may use whitespace between tokens.  Sudachi
        // returns that whitespace as a morpheme, whereas Stanza ignores it.
        while (next < morphemes.size() && morphemes.get(next).surface().trim().isEmpty()) next++;
        if (next >= morphemes.size()) return false;
        String surface = morphemes.get(next).surface();
        return "する".equals(surface) || "し".equals(surface) || "せ".equals(surface)
            || "さ".equals(surface) || "すれ".equals(surface) || "しよ".equals(surface);
    }

    private static String normalize(String value) {
        if (value == null || "*".equals(value.trim())) return null;
        String normalized = Normalizer.normalize(value, Normalizer.Form.NFC).trim();
        return normalized.isEmpty() ? null : normalized;
    }
}
