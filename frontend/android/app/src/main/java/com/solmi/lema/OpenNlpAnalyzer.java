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
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Shared OpenNLP execution and whitespace-token alignment for Android analyzers. */
final class OpenNlpAnalyzer {
    interface AnnotationAdapter {
        Annotation adapt(String surface, String modelSurface, String lemma, String pos);
    }

    static final class Annotation {
        final String lemma;
        final String pos;

        Annotation(String lemma, String pos) {
            this.lemma = lemma;
            this.pos = pos;
        }
    }

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

    static final class Models {
        final String sentence;
        final String tokens;
        final String pos;
        final String lemmas;

        Models(String sentence, String tokens, String pos, String lemmas) {
            this.sentence = sentence;
            this.tokens = tokens;
            this.pos = pos;
            this.lemmas = lemmas;
        }
    }

    private static final Pattern SURFACE_PATTERN = Pattern.compile("\\S+");

    private static final class FineToken {
        final int start;
        final int end;
        final String surface;
        final String lemma;
        final String pos;

        FineToken(int start, int end, String surface, String lemma, String pos) {
            this.start = start;
            this.end = end;
            this.surface = surface;
            this.lemma = lemma;
            this.pos = pos;
        }
    }

    private final SentenceDetectorME sentenceDetector;
    private final TokenizerME tokenizer;
    private final POSTaggerME posTagger;
    private final LemmatizerME lemmatizer;
    private final AnnotationAdapter adapter;

    OpenNlpAnalyzer(
        ClassLoader classLoader,
        Models models,
        String languageName,
        AnnotationAdapter adapter
    ) throws IOException {
        try (
            InputStream sentenceStream = requireResource(classLoader, models.sentence, languageName);
            InputStream tokenStream = requireResource(classLoader, models.tokens, languageName);
            InputStream posStream = requireResource(classLoader, models.pos, languageName);
            InputStream lemmaStream = requireResource(classLoader, models.lemmas, languageName)
        ) {
            sentenceDetector = new SentenceDetectorME(new SentenceModel(sentenceStream));
            tokenizer = new TokenizerME(new TokenizerModel(tokenStream));
            posTagger = new POSTaggerME(new POSModel(posStream));
            lemmatizer = new LemmatizerME(new LemmatizerModel(lemmaStream));
        }
        this.adapter = adapter;
    }

    OpenNlpAnalyzer(
        File modelDirectory,
        Models models,
        String languageName,
        AnnotationAdapter adapter
    ) throws IOException {
        try (
            InputStream sentenceStream = requireFile(modelDirectory, models.sentence, languageName);
            InputStream tokenStream = requireFile(modelDirectory, models.tokens, languageName);
            InputStream posStream = requireFile(modelDirectory, models.pos, languageName);
            InputStream lemmaStream = requireFile(modelDirectory, models.lemmas, languageName)
        ) {
            sentenceDetector = new SentenceDetectorME(new SentenceModel(sentenceStream));
            tokenizer = new TokenizerME(new TokenizerModel(tokenStream));
            posTagger = new POSTaggerME(new POSModel(posStream));
            lemmatizer = new LemmatizerME(new LemmatizerModel(lemmaStream));
        }
        this.adapter = adapter;
    }

    static boolean modelsAvailable(ClassLoader classLoader, Models models) {
        return hasResource(classLoader, models.sentence)
            && hasResource(classLoader, models.tokens)
            && hasResource(classLoader, models.pos)
            && hasResource(classLoader, models.lemmas);
    }

    static boolean modelsAvailable(File modelDirectory, Models models) {
        return hasFile(modelDirectory, models.sentence)
            && hasFile(modelDirectory, models.tokens)
            && hasFile(modelDirectory, models.pos)
            && hasFile(modelDirectory, models.lemmas);
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

            String surface = surfaceMatcher.group();
            Annotation annotation = representative != null
                ? adapter.adapt(
                    surface,
                    representative.surface,
                    representative.lemma,
                    representative.pos
                )
                : new Annotation(null, null);
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
                    tokens[index],
                    lemmas[index],
                    posTags[index]
                ));
            }
        }

        return result;
    }

    private static boolean hasResource(ClassLoader classLoader, String name) {
        return classLoader != null && classLoader.getResource(name) != null;
    }

    private static InputStream requireResource(
        ClassLoader classLoader,
        String name,
        String languageName
    ) throws IOException {
        InputStream stream = classLoader != null ? classLoader.getResourceAsStream(name) : null;
        if (stream == null) throw new IOException("Missing " + languageName + " NLP model: " + name);
        return stream;
    }

    private static boolean hasFile(File directory, String name) {
        if (directory == null) return false;
        File file = new File(directory, name);
        return file.isFile() && file.length() > 0;
    }

    private static InputStream requireFile(
        File directory,
        String name,
        String languageName
    ) throws IOException {
        File file = new File(directory, name);
        if (!hasFile(directory, name)) {
            throw new IOException("Missing " + languageName + " NLP model: " + file.getAbsolutePath());
        }
        return new FileInputStream(file);
    }
}
