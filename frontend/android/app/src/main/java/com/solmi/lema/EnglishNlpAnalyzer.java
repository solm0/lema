package com.solmi.lema;

import java.io.File;
import java.io.IOException;
import java.text.Normalizer;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;

final class EnglishNlpAnalyzer {
    static final String SENTENCE_MODEL = "opennlp-en-ud-ewt-sentence-1.3-2.5.4.bin";
    static final String TOKEN_MODEL = "opennlp-en-ud-ewt-tokens-1.3-2.5.4.bin";
    static final String POS_MODEL = "opennlp-en-ud-ewt-pos-1.3-2.5.4.bin";
    static final String LEMMA_MODEL = "opennlp-en-ud-ewt-lemmas-1.3-2.5.4.bin";

    private static final OpenNlpAnalyzer.Models MODELS = new OpenNlpAnalyzer.Models(
        SENTENCE_MODEL,
        TOKEN_MODEL,
        POS_MODEL,
        LEMMA_MODEL
    );
    private static final Pattern VALID_LEMMA_PATTERN = Pattern.compile("^[a-z]+$");
    private static final Set<String> STOP_POS = new HashSet<>(Arrays.asList(
        "PUNCT", "SYM", "SPACE", "DET", "CCONJ", "SCONJ", "PART", "PRON", "ADP"
    ));
    private static final Set<String> STOP_LEMMAS = new HashSet<>(Arrays.asList(
        "be", "have", "do", "can", "could", "may", "might", "must", "shall",
        "should", "will", "would", "more", "already", "finally", "however",
        "then", "there", "here", "also", "still", "only", "about", "well"
    ));

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

    EnglishNlpAnalyzer(ClassLoader classLoader) throws IOException {
        analyzer = new OpenNlpAnalyzer(classLoader, MODELS, "English", EnglishNlpAnalyzer::adapt);
    }

    EnglishNlpAnalyzer(File modelDirectory) throws IOException {
        analyzer = new OpenNlpAnalyzer(modelDirectory, MODELS, "English", EnglishNlpAnalyzer::adapt);
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

    private static OpenNlpAnalyzer.Annotation adapt(
        String surface,
        String modelSurface,
        String lemma,
        String pos
    ) {
        String normalized = emptyToNull(lemma);
        if (normalized == null || "O".equals(normalized)) {
            return new OpenNlpAnalyzer.Annotation(null, emptyToNull(pos));
        }
        normalized = Normalizer.normalize(normalized, Normalizer.Form.NFC)
            .toLowerCase(Locale.ROOT)
            .trim();
        if (STOP_POS.contains(pos)
            || STOP_LEMMAS.contains(normalized)
            || !VALID_LEMMA_PATTERN.matcher(normalized).matches()) {
            normalized = null;
        }
        return new OpenNlpAnalyzer.Annotation(normalized, emptyToNull(pos));
    }

    private static String emptyToNull(String value) {
        if (value == null) return null;
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }
}
