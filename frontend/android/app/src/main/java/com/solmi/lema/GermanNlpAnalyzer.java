package com.solmi.lema;

import java.io.File;
import java.io.IOException;
import java.text.Normalizer;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;

final class GermanNlpAnalyzer {
    interface LemmaKeyLookup {
        boolean contains(String lemma, String pos);
    }

    static final String SENTENCE_MODEL = "opennlp-de-ud-gsd-sentence-1.3-2.5.4.bin";
    static final String TOKEN_MODEL = "opennlp-de-ud-gsd-tokens-1.3-2.5.4.bin";
    static final String POS_MODEL = "opennlp-de-ud-gsd-pos-1.3-2.5.4.bin";
    static final String LEMMA_MODEL = "opennlp-de-ud-gsd-lemmas-1.3-2.5.4.bin";

    private static final OpenNlpAnalyzer.Models MODELS = new OpenNlpAnalyzer.Models(
        SENTENCE_MODEL,
        TOKEN_MODEL,
        POS_MODEL,
        LEMMA_MODEL
    );
    private static final Pattern VALID_LEMMA_PATTERN = Pattern.compile("^[a-zäöüß]+$");
    private static final Pattern EDGE_NON_LETTERS = Pattern.compile("^[^a-zäöüß]+|[^a-zäöüß]+$");
    private static final Set<String> STOP_POS = new HashSet<>(Arrays.asList(
        "PUNCT", "SYM", "SPACE", "DET", "CCONJ", "SCONJ", "PART", "PRON", "ADP"
    ));
    private static final Set<String> STOP_LEMMAS = new HashSet<>(Arrays.asList(
        "sein", "haben", "werden", "können", "müssen", "sollen", "wollen", "dürfen", "mögen",
        "mehr", "bereits", "zunächst", "schließlich", "jedoch", "dann", "dort", "hier",
        "auch", "noch", "nur", "etwa", "wohl"
    ));
    private static final List<String> PACK_POS_FALLBACKS = Arrays.asList(
        "ADJ", "ADV", "AUX", "INTJ", "NOUN", "NUM", "PROPN", "VERB", "X"
    );

    static final class Token {
        final String surface;
        final String lemma;
        final String pos;

        Token(String surface, String lemma, String pos) {
            this.surface = surface;
            this.lemma = lemma;
            this.pos = pos;
        }
    }

    private final OpenNlpAnalyzer analyzer;

    GermanNlpAnalyzer(ClassLoader classLoader) throws IOException {
        this(classLoader, null);
    }

    GermanNlpAnalyzer(ClassLoader classLoader, LemmaKeyLookup lemmaKeyLookup) throws IOException {
        analyzer = new OpenNlpAnalyzer(
            classLoader,
            MODELS,
            "German",
            (surface, modelSurface, lemma, pos) ->
                adaptForPack(surface, modelSurface, lemma, pos, lemmaKeyLookup)
        );
    }

    GermanNlpAnalyzer(File modelDirectory, LemmaKeyLookup lemmaKeyLookup) throws IOException {
        analyzer = new OpenNlpAnalyzer(
            modelDirectory,
            MODELS,
            "German",
            (surface, modelSurface, lemma, pos) ->
                adaptForPack(surface, modelSurface, lemma, pos, lemmaKeyLookup)
        );
    }

    static boolean modelsAvailable(ClassLoader classLoader) {
        return OpenNlpAnalyzer.modelsAvailable(classLoader, MODELS);
    }

    static boolean modelsAvailable(File modelDirectory) {
        return OpenNlpAnalyzer.modelsAvailable(modelDirectory, MODELS);
    }

    List<Token> analyze(String rawText) {
        List<Token> output = new ArrayList<>();
        for (OpenNlpAnalyzer.Token token : analyzer.analyze(rawText)) {
            output.add(new Token(token.surface, token.lemma, token.pos));
        }
        return output;
    }

    static OpenNlpAnalyzer.Annotation adaptForPack(
        String surface,
        String modelSurface,
        String lemma,
        String pos,
        LemmaKeyLookup lookup
    ) {
        String normalizedPos = emptyToNull(pos);
        String normalizedLemma = normalizeLemma(lemma);
        if (normalizedLemma == null
            || normalizedPos == null
            || STOP_POS.contains(normalizedPos)
            || STOP_LEMMAS.contains(normalizedLemma)
            || !VALID_LEMMA_PATTERN.matcher(normalizedLemma).matches()) {
            return new OpenNlpAnalyzer.Annotation(null, normalizedPos);
        }

        if (lookup == null || lookup.contains(normalizedLemma, normalizedPos)) {
            return new OpenNlpAnalyzer.Annotation(normalizedLemma, normalizedPos);
        }

        LinkedHashSet<String> candidates = new LinkedHashSet<>();
        addCandidate(candidates, normalizedLemma.replace("ß", "ss"), normalizedPos);
        addPreferredPosCandidates(candidates, normalizedLemma, normalizedPos);

        String normalizedSurface = normalizeSurface(modelSurface);
        if (normalizedSurface == null) normalizedSurface = normalizeSurface(surface);
        if (normalizedSurface != null) {
            addCandidate(candidates, normalizedSurface, normalizedPos);
            addPreferredPosCandidates(candidates, normalizedSurface, normalizedPos);
        }

        for (String fallbackPos : PACK_POS_FALLBACKS) {
            if (!fallbackPos.equals(normalizedPos)) {
                addCandidate(candidates, normalizedLemma, fallbackPos);
            }
        }

        for (String candidate : candidates) {
            int separator = candidate.lastIndexOf('\t');
            String candidateLemma = candidate.substring(0, separator);
            String candidatePos = candidate.substring(separator + 1);
            if (lookup.contains(candidateLemma, candidatePos)) {
                return new OpenNlpAnalyzer.Annotation(candidateLemma, candidatePos);
            }
        }

        return new OpenNlpAnalyzer.Annotation(normalizedLemma, normalizedPos);
    }

    private static void addPreferredPosCandidates(
        Set<String> candidates,
        String lemma,
        String pos
    ) {
        if ("NOUN".equals(pos)) {
            addCandidate(candidates, lemma, "PROPN");
        } else if ("PROPN".equals(pos)) {
            addCandidate(candidates, lemma, "NOUN");
        } else if ("ADJ".equals(pos)) {
            addCandidate(candidates, lemma, "ADV");
            addCandidate(candidates, lemma, "VERB");
        }
    }

    private static void addCandidate(Set<String> candidates, String lemma, String pos) {
        if (lemma == null || pos == null || !VALID_LEMMA_PATTERN.matcher(lemma).matches()) return;
        candidates.add(lemma + '\t' + pos);
    }

    private static String normalizeLemma(String value) {
        String normalized = emptyToNull(value);
        if (normalized == null || "O".equals(normalized)) return null;
        return Normalizer.normalize(normalized, Normalizer.Form.NFC)
            .toLowerCase(Locale.ROOT)
            .trim();
    }

    private static String normalizeSurface(String value) {
        String normalized = normalizeLemma(value);
        if (normalized == null) return null;
        normalized = EDGE_NON_LETTERS.matcher(normalized).replaceAll("");
        return VALID_LEMMA_PATTERN.matcher(normalized).matches() ? normalized : null;
    }

    private static String emptyToNull(String value) {
        if (value == null) return null;
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }
}
