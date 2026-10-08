package com.solmi.lema;

import opennlp.tools.lemmatizer.LemmatizerME;
import opennlp.tools.lemmatizer.LemmatizerModel;
import opennlp.tools.postag.POSModel;
import opennlp.tools.postag.POSTaggerME;
import opennlp.tools.sentdetect.SentenceDetectorME;
import opennlp.tools.sentdetect.SentenceModel;
import opennlp.tools.tokenize.TokenizerME;
import opennlp.tools.tokenize.TokenizerModel;
import opennlp.tools.util.Span;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.text.Normalizer;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

final class EnglishNlpAnalyzer {
    static final String SENTENCE_MODEL = "opennlp-en-ud-ewt-sentence-1.3-2.5.4.bin";
    static final String TOKEN_MODEL = "opennlp-en-ud-ewt-tokens-1.3-2.5.4.bin";
    static final String POS_MODEL = "opennlp-en-ud-ewt-pos-1.3-2.5.4.bin";
    static final String LEMMA_MODEL = "opennlp-en-ud-ewt-lemmas-1.3-2.5.4.bin";

    private static final Pattern SURFACE_PATTERN = Pattern.compile("\\S+");
    private static final Pattern VALID_LEMMA_PATTERN = Pattern.compile("^[a-z]+$");
    private static final Set<String> STOP_POS = new HashSet<>(Arrays.asList(
        "PUNCT", "SYM", "SPACE", "DET", "CCONJ", "SCONJ", "PART", "PRON", "ADP"
    ));
    private static final Set<String> STOP_LEMMAS = new HashSet<>(Arrays.asList(
        "be", "have", "do", "can", "could", "may", "might", "must", "shall",
        "should", "will", "would", "more", "already", "finally", "however",
        "then", "there", "here", "also", "still", "only", "about", "well"
    ));

    private final SentenceDetectorME sentenceDetector;
    private final TokenizerME tokenizer;
    private final POSTaggerME posTagger;
    private final LemmatizerME lemmatizer;

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

    private static final class FineToken {
        final int start;
        final int end;
        final String lemma;
        final String pos;

        FineToken(int start, int end, String lemma, String pos) {
            this.start = start;
            this.end = end;
            this.lemma = lemma;
            this.pos = pos;
        }
    }

    EnglishNlpAnalyzer(ClassLoader classLoader) throws IOException {
        try (
            InputStream sentenceStream = requireResource(classLoader, SENTENCE_MODEL);
            InputStream tokenStream = requireResource(classLoader, TOKEN_MODEL);
            InputStream posStream = requireResource(classLoader, POS_MODEL);
            InputStream lemmaStream = requireResource(classLoader, LEMMA_MODEL)
        ) {
            sentenceDetector = new SentenceDetectorME(new SentenceModel(sentenceStream));
            tokenizer = new TokenizerME(new TokenizerModel(tokenStream));
            posTagger = new POSTaggerME(new POSModel(posStream));
            lemmatizer = new LemmatizerME(new LemmatizerModel(lemmaStream));
        }
    }

    EnglishNlpAnalyzer(File modelDirectory) throws IOException {
        try (
            InputStream sentenceStream = requireFile(modelDirectory, SENTENCE_MODEL);
            InputStream tokenStream = requireFile(modelDirectory, TOKEN_MODEL);
            InputStream posStream = requireFile(modelDirectory, POS_MODEL);
            InputStream lemmaStream = requireFile(modelDirectory, LEMMA_MODEL)
        ) {
            sentenceDetector = new SentenceDetectorME(new SentenceModel(sentenceStream));
            tokenizer = new TokenizerME(new TokenizerModel(tokenStream));
            posTagger = new POSTaggerME(new POSModel(posStream));
            lemmatizer = new LemmatizerME(new LemmatizerModel(lemmaStream));
        }
    }

    static boolean modelsAvailable(ClassLoader classLoader) {
        return hasResource(classLoader, SENTENCE_MODEL)
            && hasResource(classLoader, TOKEN_MODEL)
            && hasResource(classLoader, POS_MODEL)
            && hasResource(classLoader, LEMMA_MODEL);
    }

    static boolean modelsAvailable(File modelDirectory) {
        return hasFile(modelDirectory, SENTENCE_MODEL)
            && hasFile(modelDirectory, TOKEN_MODEL)
            && hasFile(modelDirectory, POS_MODEL)
            && hasFile(modelDirectory, LEMMA_MODEL);
    }

    private static boolean hasResource(ClassLoader classLoader, String name) {
        return classLoader != null && classLoader.getResource(name) != null;
    }

    private static InputStream requireResource(ClassLoader classLoader, String name) throws IOException {
        InputStream stream = classLoader != null ? classLoader.getResourceAsStream(name) : null;
        if (stream == null) throw new IOException("Missing English NLP model: " + name);
        return stream;
    }

    private static boolean hasFile(File directory, String name) {
        if (directory == null) return false;
        File file = new File(directory, name);
        return file.isFile() && file.length() > 0;
    }

    private static InputStream requireFile(File directory, String name) throws IOException {
        File file = new File(directory, name);
        if (!hasFile(directory, name)) {
            throw new IOException("Missing English NLP model: " + file.getAbsolutePath());
        }
        return new FileInputStream(file);
    }

    synchronized List<Token> analyze(String rawText) {
        String text = Normalizer.normalize(rawText, Normalizer.Form.NFC);
        List<FineToken> fineTokens = analyzeFineTokens(text);
        List<Token> output = new ArrayList<>();
        Matcher surfaceMatcher = SURFACE_PATTERN.matcher(text);
        int fineIndex = 0;

        while (surfaceMatcher.find()) {
            int surfaceStart = surfaceMatcher.start();
            int surfaceEnd = surfaceMatcher.end();

            while (fineIndex < fineTokens.size() && fineTokens.get(fineIndex).end <= surfaceStart) {
                fineIndex += 1;
            }

            FineToken representative = null;
            int candidateIndex = fineIndex;
            while (candidateIndex < fineTokens.size()) {
                FineToken candidate = fineTokens.get(candidateIndex);
                if (candidate.start >= surfaceEnd) break;
                if (candidate.end > surfaceStart) {
                    representative = candidate;
                    break;
                }
                candidateIndex += 1;
            }

            output.add(new Token(
                surfaceMatcher.group(),
                representative != null ? representative.lemma : null,
                representative != null ? representative.pos : null
            ));
        }

        return output;
    }

    private List<FineToken> analyzeFineTokens(String text) {
        List<FineToken> result = new ArrayList<>();
        Span[] sentenceSpans = sentenceDetector.sentPosDetect(text);
        if (sentenceSpans.length == 0 && !text.trim().isEmpty()) {
            sentenceSpans = new Span[] { new Span(0, text.length()) };
        }

        for (Span sentenceSpan : sentenceSpans) {
            String sentence = text.substring(sentenceSpan.getStart(), sentenceSpan.getEnd());
            Span[] tokenSpans = tokenizer.tokenizePos(sentence);
            String[] tokens = new String[tokenSpans.length];

            for (int index = 0; index < tokenSpans.length; index += 1) {
                tokens[index] = tokenSpans[index].getCoveredText(sentence).toString();
            }

            String[] posTags = posTagger.tag(tokens);
            String[] lemmas = lemmatizer.lemmatize(tokens, posTags);

            for (int index = 0; index < tokenSpans.length; index += 1) {
                Span tokenSpan = tokenSpans[index];
                result.add(new FineToken(
                    sentenceSpan.getStart() + tokenSpan.getStart(),
                    sentenceSpan.getStart() + tokenSpan.getEnd(),
                    normalizeLemma(lemmas[index], posTags[index]),
                    emptyToNull(posTags[index])
                ));
            }
        }

        return result;
    }

    private static String normalizeLemma(String lemma, String pos) {
        String normalized = emptyToNull(lemma);
        if (normalized == null || "O".equals(normalized)) return null;
        normalized = Normalizer.normalize(normalized, Normalizer.Form.NFC)
            .toLowerCase(Locale.ROOT)
            .trim();
        if (STOP_POS.contains(pos)
            || STOP_LEMMAS.contains(normalized)
            || !VALID_LEMMA_PATTERN.matcher(normalized).matches()) {
            return null;
        }
        return normalized;
    }

    private static String emptyToNull(String value) {
        if (value == null) return null;
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }
}
