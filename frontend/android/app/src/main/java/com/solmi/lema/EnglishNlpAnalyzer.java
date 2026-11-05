package com.solmi.lema;

import com.solmi.lema.nlp.EnglishOpenNlpAnalyzer;

import java.io.File;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

final class EnglishNlpAnalyzer {
    static final String SENTENCE_MODEL = EnglishOpenNlpAnalyzer.SENTENCE_MODEL;
    static final String TOKEN_MODEL = EnglishOpenNlpAnalyzer.TOKEN_MODEL;
    static final String POS_MODEL = EnglishOpenNlpAnalyzer.POS_MODEL;
    static final String LEMMA_MODEL = EnglishOpenNlpAnalyzer.LEMMA_MODEL;

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

    private final EnglishOpenNlpAnalyzer analyzer;

    EnglishNlpAnalyzer(ClassLoader classLoader) throws IOException {
        analyzer = new EnglishOpenNlpAnalyzer(classLoader);
    }

    EnglishNlpAnalyzer(File modelDirectory) throws IOException {
        analyzer = new EnglishOpenNlpAnalyzer(modelDirectory);
    }

    static boolean modelsAvailable(ClassLoader classLoader) {
        return EnglishOpenNlpAnalyzer.modelsAvailable(classLoader);
    }

    static boolean modelsAvailable(File modelDirectory) {
        return EnglishOpenNlpAnalyzer.modelsAvailable(modelDirectory);
    }

    List<Token> analyze(String rawText) {
        List<Token> output = new ArrayList<>();
        for (EnglishOpenNlpAnalyzer.Token token : analyzer.analyze(rawText)) {
            output.add(new Token(token.surface, token.lemma, token.pos));
        }
        return output;
    }
}
