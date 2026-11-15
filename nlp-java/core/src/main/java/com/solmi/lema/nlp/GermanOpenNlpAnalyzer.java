package com.solmi.lema.nlp;

import java.io.File;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

public final class GermanOpenNlpAnalyzer {
    public static final String SENTENCE_MODEL = "opennlp-de-ud-gsd-sentence-1.3-2.5.4.bin";
    public static final String TOKEN_MODEL = "opennlp-de-ud-gsd-tokens-1.3-2.5.4.bin";
    public static final String POS_MODEL = "opennlp-de-ud-gsd-pos-1.3-2.5.4.bin";
    public static final String LEMMA_MODEL = "opennlp-de-ud-gsd-lemmas-1.3-2.5.4.bin";
    public interface LemmaKeyLookup { boolean contains(String lemma, String pos); }
    public static final class Token { public final String surface, lemma, pos; Token(String surface, String lemma, String pos) { this.surface = surface; this.lemma = lemma; this.pos = pos; } }
    private static final OpenNlpPipeline.Models MODELS = new OpenNlpPipeline.Models(SENTENCE_MODEL, TOKEN_MODEL, POS_MODEL, LEMMA_MODEL);
    private final PackOpenNlpAnalyzer analyzer;
    public GermanOpenNlpAnalyzer(File directory) throws IOException { this(directory, null); }
    public GermanOpenNlpAnalyzer(File directory, LemmaKeyLookup lookup) throws IOException { analyzer = new PackOpenNlpAnalyzer(directory, MODELS, false, lookup == null ? null : lookup::contains); }
    public static boolean modelsAvailable(File directory) { return PackOpenNlpAnalyzer.modelsAvailable(directory, MODELS); }
    public List<Token> analyze(String text) { List<Token> out = new ArrayList<>(); for (PackOpenNlpAnalyzer.Token token : analyzer.analyze(text)) out.add(new Token(token.surface, token.lemma, token.pos)); return out; }
}
