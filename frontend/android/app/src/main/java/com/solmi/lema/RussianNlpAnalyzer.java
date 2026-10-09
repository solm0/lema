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

final class RussianNlpAnalyzer {
    static final String SENTENCE_MODEL = "opennlp-ru-ud-gsd-sentence-1.3-2.5.4.bin";
    static final String TOKEN_MODEL = "opennlp-ru-ud-gsd-tokens-1.3-2.5.4.bin";
    static final String POS_MODEL = "opennlp-ru-ud-gsd-pos-1.3-2.5.4.bin";
    static final String LEMMA_MODEL = "opennlp-ru-ud-gsd-lemmas-1.3-2.5.4.bin";

    private static final OpenNlpAnalyzer.Models MODELS = new OpenNlpAnalyzer.Models(
        SENTENCE_MODEL,
        TOKEN_MODEL,
        POS_MODEL,
        LEMMA_MODEL
    );
    private static final Pattern VALID_LEMMA_PATTERN = Pattern.compile("^[а-яё-]+$");
    private static final Pattern EDGE_NON_LETTERS = Pattern.compile("^[^а-яё]+|[^а-яё]+$");
    private static final Pattern INITIAL_UPPERCASE = Pattern.compile("^[^А-ЯЁа-яё]*[А-ЯЁ]");
    private static final Pattern SENTENCE_END = Pattern.compile("[.!?…][\"\u201d»)\\]]*$");
    private static final Set<String> STOP_POS = new HashSet<>(Arrays.asList(
        "PUNCT", "SYM", "SPACE", "DET", "CCONJ", "SCONJ", "PART", "PRON", "ADP"
    ));
    private static final Set<String> STOP_LEMMAS = new HashSet<>(Arrays.asList(
        "быть", "мочь", "сказать", "становиться", "более", "уже", "затем", "однако",
        "тогда", "там", "здесь", "также", "ещё", "еще", "только", "примерно"
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
    private final LemmaKeyLookup lemmaKeyLookup;

    RussianNlpAnalyzer(ClassLoader classLoader) throws IOException {
        this(classLoader, null);
    }

    RussianNlpAnalyzer(ClassLoader classLoader, LemmaKeyLookup lemmaKeyLookup) throws IOException {
        analyzer = new OpenNlpAnalyzer(
            classLoader,
            MODELS,
            "Russian",
            (surface, modelSurface, lemma, pos) ->
                adaptForPack(surface, modelSurface, lemma, pos, lemmaKeyLookup)
        );
        this.lemmaKeyLookup = lemmaKeyLookup;
    }

    RussianNlpAnalyzer(File modelDirectory, LemmaKeyLookup lemmaKeyLookup) throws IOException {
        analyzer = new OpenNlpAnalyzer(
            modelDirectory,
            MODELS,
            "Russian",
            (surface, modelSurface, lemma, pos) ->
                adaptForPack(surface, modelSurface, lemma, pos, lemmaKeyLookup)
        );
        this.lemmaKeyLookup = lemmaKeyLookup;
    }

    static boolean modelsAvailable(ClassLoader classLoader) {
        return OpenNlpAnalyzer.modelsAvailable(classLoader, MODELS);
    }

    static boolean modelsAvailable(File modelDirectory) {
        return OpenNlpAnalyzer.modelsAvailable(modelDirectory, MODELS);
    }

    List<Token> analyze(String rawText) {
        List<Token> output = new ArrayList<>();
        boolean sentenceStart = true;
        for (OpenNlpAnalyzer.Token token : analyzer.analyze(rawText)) {
            String pos = token.pos;
            if (!sentenceStart
                && lemmaKeyLookup != null
                && token.lemma != null
                && "NOUN".equals(pos)
                && INITIAL_UPPERCASE.matcher(token.surface).find()
                && lemmaKeyLookup.contains(token.lemma, "PROPN")) {
                pos = "PROPN";
            }
            output.add(new Token(token.surface, token.lemma, pos));
            sentenceStart = SENTENCE_END.matcher(token.surface).find();
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
        addYoVariants(candidates, normalizedLemma, normalizedPos);

        String normalizedSurface = normalizeSurface(modelSurface);
        if (normalizedSurface == null) normalizedSurface = normalizeSurface(surface);
        if (normalizedSurface != null) {
            addCandidate(candidates, normalizedSurface, normalizedPos);
            if ("PROPN".equals(normalizedPos)) {
                addCandidate(candidates, normalizedSurface, "PROPN");
            }
            addYoVariants(candidates, normalizedSurface, normalizedPos);
        }

        if ("NOUN".equals(normalizedPos)) {
            addCandidate(candidates, normalizedLemma, "PROPN");
            addYoVariants(candidates, normalizedLemma, "PROPN");
        } else if ("PROPN".equals(normalizedPos)) {
            addCandidate(candidates, normalizedLemma, "NOUN");
            addYoVariants(candidates, normalizedLemma, "NOUN");
            if (normalizedSurface != null) {
                addCandidate(candidates, normalizedSurface, "NOUN");
                addYoVariants(candidates, normalizedSurface, "NOUN");
            }
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

    private static void addYoVariants(Set<String> candidates, String lemma, String pos) {
        if (lemma.indexOf('ё') >= 0) addCandidate(candidates, lemma.replace('ё', 'е'), pos);
        for (int index = lemma.indexOf('е'); index >= 0; index = lemma.indexOf('е', index + 1)) {
            addCandidate(
                candidates,
                lemma.substring(0, index) + 'ё' + lemma.substring(index + 1),
                pos
            );
        }
    }

    private static void addCandidate(Set<String> candidates, String lemma, String pos) {
        if (lemma == null
            || pos == null
            || STOP_LEMMAS.contains(lemma)
            || !VALID_LEMMA_PATTERN.matcher(lemma).matches()) return;
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
