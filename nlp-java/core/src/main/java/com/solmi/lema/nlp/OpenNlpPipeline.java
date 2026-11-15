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
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Shared OpenNLP execution and whitespace-surface alignment. */
final class OpenNlpPipeline {
    interface Adapter { Annotation adapt(String surface, String modelSurface, String lemma, String pos); }
    static final class Annotation { final String lemma; final String pos; Annotation(String lemma, String pos) { this.lemma = lemma; this.pos = pos; } }
    static final class Token { final String surface; final String lemma; final String pos; Token(String surface, String lemma, String pos) { this.surface = surface; this.lemma = lemma; this.pos = pos; } }
    static final class Models { final String sentence, tokens, pos, lemmas; Models(String sentence, String tokens, String pos, String lemmas) { this.sentence = sentence; this.tokens = tokens; this.pos = pos; this.lemmas = lemmas; } }
    private static final Pattern SURFACE_PATTERN = Pattern.compile("\\S+");
    private final SentenceDetectorME sentenceDetector;
    private final TokenizerME tokenizer;
    private final POSTaggerME posTagger;
    private final LemmatizerME lemmatizer;
    private final Adapter adapter;

    OpenNlpPipeline(File directory, Models models, String language, Adapter adapter) throws IOException {
        try (InputStream sentence = require(directory, models.sentence, language); InputStream tokens = require(directory, models.tokens, language); InputStream pos = require(directory, models.pos, language); InputStream lemmas = require(directory, models.lemmas, language)) {
            sentenceDetector = new SentenceDetectorME(new SentenceModel(sentence));
            tokenizer = new TokenizerME(new TokenizerModel(tokens));
            posTagger = new POSTaggerME(new POSModel(pos));
            lemmatizer = new LemmatizerME(new LemmatizerModel(lemmas));
        }
        this.adapter = adapter;
    }

    static boolean modelsAvailable(File directory, Models models) {
        return has(directory, models.sentence) && has(directory, models.tokens) && has(directory, models.pos) && has(directory, models.lemmas);
    }

    synchronized List<Token> analyze(String rawText) {
        String text = Normalizer.normalize(rawText, Normalizer.Form.NFC);
        List<FineToken> fine = new ArrayList<>();
        Span[] sentences = sentenceDetector.sentPosDetect(text);
        if (sentences.length == 0 && !text.trim().isEmpty()) sentences = new Span[] { new Span(0, text.length()) };
        for (Span sentenceSpan : sentences) {
            String sentence = text.substring(sentenceSpan.getStart(), sentenceSpan.getEnd());
            Span[] spans = tokenizer.tokenizePos(sentence);
            String[] words = new String[spans.length];
            for (int i = 0; i < spans.length; i++) words[i] = spans[i].getCoveredText(sentence).toString();
            String[] pos = posTagger.tag(words);
            String[] lemmas = lemmatizer.lemmatize(words, pos);
            for (int i = 0; i < spans.length; i++) fine.add(new FineToken(sentenceSpan.getStart() + spans[i].getStart(), sentenceSpan.getStart() + spans[i].getEnd(), words[i], lemmas[i], pos[i]));
        }
        List<Token> output = new ArrayList<>();
        Matcher surfaces = SURFACE_PATTERN.matcher(text);
        int fineIndex = 0;
        while (surfaces.find()) {
            int start = surfaces.start(), end = surfaces.end();
            while (fineIndex < fine.size() && fine.get(fineIndex).end <= start) fineIndex++;
            FineToken representative = null;
            for (int i = fineIndex; i < fine.size(); i++) { FineToken candidate = fine.get(i); if (candidate.start >= end) break; if (candidate.end > start) { representative = candidate; break; } }
            String surface = surfaces.group();
            Annotation annotation = representative == null ? new Annotation(null, null) : adapter.adapt(surface, representative.surface, representative.lemma, representative.pos);
            output.add(new Token(surface, annotation.lemma, annotation.pos));
        }
        return output;
    }

    private static boolean has(File directory, String name) { File file = directory == null ? null : new File(directory, name); return file != null && file.isFile() && file.length() > 0; }
    private static InputStream require(File directory, String name, String language) throws IOException { if (!has(directory, name)) throw new IOException("Missing " + language + " NLP model: " + new File(directory, name)); return new FileInputStream(new File(directory, name)); }
    private static final class FineToken { final int start, end; final String surface, lemma, pos; FineToken(int start, int end, String surface, String lemma, String pos) { this.start = start; this.end = end; this.surface = surface; this.lemma = lemma; this.pos = pos; } }
}
