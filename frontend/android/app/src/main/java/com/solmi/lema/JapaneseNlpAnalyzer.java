package com.solmi.lema;

import com.solmi.lema.nlp.JapaneseSudachiAnalyzer;

import java.io.File;
import java.util.ArrayList;
import java.util.List;

/** Android-only compatibility façade for the shared Japanese analyzer. */
final class JapaneseNlpAnalyzer {
    static final String MODEL_DIRECTORY = JapaneseSudachiAnalyzer.MODEL_DIRECTORY;
    static final String SYSTEM_DICTIONARY = JapaneseSudachiAnalyzer.SYSTEM_DICTIONARY;

    static final class Morph {
        final String surface;
        final String lemma;
        final String pos;

        Morph(JapaneseSudachiAnalyzer.Morph source) {
            surface = source.surface;
            lemma = source.lemma;
            pos = source.pos;
        }
    }

    static final class Token {
        final String surface;
        final String lemma;
        final String pos;
        final List<Morph> morphs;

        Token(JapaneseSudachiAnalyzer.Token source) {
            surface = source.surface;
            lemma = source.lemma;
            pos = source.pos;
            morphs = new ArrayList<>();
            for (JapaneseSudachiAnalyzer.Morph morph : source.morphs) morphs.add(new Morph(morph));
        }
    }

    private final JapaneseSudachiAnalyzer delegate;

    JapaneseNlpAnalyzer(File modelDirectory, LemmaKeyLookup lookup) throws Exception {
        delegate = new JapaneseSudachiAnalyzer(modelDirectory, lookup::contains);
    }

    static boolean modelsAvailable(File modelDirectory) {
        return JapaneseSudachiAnalyzer.modelsAvailable(modelDirectory);
    }

    synchronized List<Token> analyze(String text) {
        List<Token> output = new ArrayList<>();
        for (JapaneseSudachiAnalyzer.Token token : delegate.analyze(text)) output.add(new Token(token));
        return output;
    }
}
