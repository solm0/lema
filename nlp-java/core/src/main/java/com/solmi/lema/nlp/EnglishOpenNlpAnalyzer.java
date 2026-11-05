package com.solmi.lema.nlp;

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

/**
 * Android and desktop share this English analyzer exactly.  Its output keeps
 * the existing app contract: one token per whitespace-delimited surface with
 * normalized Universal Dependencies lemma/POS annotations.
 */
public final class EnglishOpenNlpAnalyzer {
    public static final String SENTENCE_MODEL = "opennlp-en-ud-ewt-sentence-1.3-2.5.4.bin";
    public static final String TOKEN_MODEL = "opennlp-en-ud-ewt-tokens-1.3-2.5.4.bin";
    public static final String POS_MODEL = "opennlp-en-ud-ewt-pos-1.3-2.5.4.bin";
    public static final String LEMMA_MODEL = "opennlp-en-ud-ewt-lemmas-1.3-2.5.4.bin";

    public static final class Token {
        public final String surface;
        public final String lemma;
        public final String pos;

        public Token(String surface, String lemma, String pos) {
            this.surface = surface;
            this.lemma = lemma;
            this.pos = pos;
        }
    }

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

    public EnglishOpenNlpAnalyzer(File modelDirectory) throws IOException {
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

    public EnglishOpenNlpAnalyzer(ClassLoader classLoader) throws IOException {
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

    public static boolean modelsAvailable(File modelDirectory) {
        return hasFile(modelDirectory, SENTENCE_MODEL)
            && hasFile(modelDirectory, TOKEN_MODEL)
            && hasFile(modelDirectory, POS_MODEL)
            && hasFile(modelDirectory, LEMMA_MODEL);
    }

    public static boolean modelsAvailable(ClassLoader classLoader) {
        return classLoader != null
            && classLoader.getResource(SENTENCE_MODEL) != null
            && classLoader.getResource(TOKEN_MODEL) != null
            && classLoader.getResource(POS_MODEL) != null
            && classLoader.getResource(LEMMA_MODEL) != null;
    }

    public synchronized List<Token> analyze(String rawText) {
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
            for (int index = fineIndex; index < fineTokens.size(); index += 1) {
                FineToken candidate = fineTokens.get(index);
                if (candidate.start >= surfaceEnd) break;
                if (candidate.end > surfaceStart) {
                    representative = candidate;
                    break;
                }
            }

            String surface = surfaceMatcher.group();
            Annotation annotation = representative == null
                ? new Annotation(null, null)
                : adapt(representative.lemma, representative.pos);
            output.add(new Token(surface, annotation.lemma, annotation.pos));
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
                    lemmas[index], posTags[index]
                ));
            }
        }
        return result;
    }

    private static Annotation adapt(String lemma, String pos) {
        String normalized = emptyToNull(lemma);
        String normalizedPos = emptyToNull(pos);
        if (normalized == null || "O".equals(normalized)) {
            return new Annotation(null, normalizedPos);
        }
        normalized = Normalizer.normalize(normalized, Normalizer.Form.NFC)
            .toLowerCase(Locale.ROOT).trim();
        if (STOP_POS.contains(normalizedPos)
            || STOP_LEMMAS.contains(normalized)
            || !VALID_LEMMA_PATTERN.matcher(normalized).matches()) {
            normalized = null;
        }
        return new Annotation(normalized, normalizedPos);
    }

    private static boolean hasFile(File directory, String name) {
        File file = directory == null ? null : new File(directory, name);
        return file != null && file.isFile() && file.length() > 0;
    }

    private static InputStream requireFile(File directory, String name) throws IOException {
        File file = directory == null ? null : new File(directory, name);
        if (file == null || !hasFile(directory, name)) {
            throw new IOException("Missing English NLP model: " + file);
        }
        return new FileInputStream(file);
    }

    private static InputStream requireResource(ClassLoader classLoader, String name) throws IOException {
        InputStream stream = classLoader == null ? null : classLoader.getResourceAsStream(name);
        if (stream == null) throw new IOException("Missing English NLP model: " + name);
        return stream;
    }

    private static String emptyToNull(String value) {
        if (value == null) return null;
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }

    private static final class Annotation {
        final String lemma;
        final String pos;

        Annotation(String lemma, String pos) {
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
}
