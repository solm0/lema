package com.solmi.lema;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import org.junit.Test;

import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

public class RussianNlpAnalyzerTest {
    @Test
    public void preservesDesktopStyleWhitespaceSurfaces() throws Exception {
        RussianNlpAnalyzer analyzer = new RussianNlpAnalyzer(getClass().getClassLoader());

        List<RussianNlpAnalyzer.Token> tokens = analyzer.analyze(
            "Любознательные собаки бегут быстро."
        );

        assertEquals(4, tokens.size());
        assertEquals("Любознательные", tokens.get(0).surface);
        assertEquals("быстро.", tokens.get(3).surface);
        assertEquals("любознательный", tokens.get(0).lemma);
        assertEquals("ADJ", tokens.get(0).pos);
        assertEquals("NOUN", tokens.get(1).pos);
        assertEquals("VERB", tokens.get(2).pos);
    }

    @Test
    public void keepsExactPackKeyBeforeTryingFallbacks() {
        LemmaKeyLookup lookup = keys("всё_ADJ", "все_ADJ");

        OpenNlpAnalyzer.Annotation result = RussianNlpAnalyzer.adaptForPack(
            "всё", "всё", "всё", "ADJ", lookup
        );

        assertEquals("всё", result.lemma);
        assertEquals("ADJ", result.pos);
    }

    @Test
    public void reconcilesYoAndProperNounSurfaceOnlyWhenPackContainsCandidate() {
        LemmaKeyLookup lookup = keys("актер_NOUN", "берёза_NOUN", "москву_PROPN");

        OpenNlpAnalyzer.Annotation spelling = RussianNlpAnalyzer.adaptForPack(
            "Актер", "Актер", "актёр", "NOUN", lookup
        );
        OpenNlpAnalyzer.Annotation properNoun = RussianNlpAnalyzer.adaptForPack(
            "Москву", "Москву", "москва", "PROPN", lookup
        );
        OpenNlpAnalyzer.Annotation insertedYo = RussianNlpAnalyzer.adaptForPack(
            "берёза", "берёза", "береза", "NOUN", lookup
        );

        assertEquals("актер", spelling.lemma);
        assertEquals("берёза", insertedYo.lemma);
        assertEquals("москву", properNoun.lemma);
        assertEquals("PROPN", properNoun.pos);
    }

    @Test
    public void appliesExistingRussianStopwordPolicy() {
        OpenNlpAnalyzer.Annotation result = RussianNlpAnalyzer.adaptForPack(
            "быть", "быть", "быть", "AUX", keys()
        );

        assertNull(result.lemma);
        assertEquals("AUX", result.pos);
    }

    @Test
    public void usesPackBackedSurfaceAndPosFallbacksWhenModelKeyIsMissing() {
        LemmaKeyLookup lookup = keys("дискотека_NOUN", "подходящий_ADJ");

        OpenNlpAnalyzer.Annotation surface = RussianNlpAnalyzer.adaptForPack(
            "Дискотека", "Дискотека", "дискотек", "NOUN", lookup
        );
        OpenNlpAnalyzer.Annotation pos = RussianNlpAnalyzer.adaptForPack(
            "подходящий", "подходящий", "подходящий", "NOUN", lookup
        );

        assertEquals("дискотека", surface.lemma);
        assertEquals("NOUN", surface.pos);
        assertEquals("подходящий", pos.lemma);
        assertEquals("ADJ", pos.pos);
    }

    @Test
    public void prefersPackProperNounForSentenceInternalCapitalizedNoun() throws Exception {
        RussianNlpAnalyzer analyzer = new RussianNlpAnalyzer(
            getClass().getClassLoader(),
            keys("автоколонна_NOUN", "автоколонна_PROPN")
        );

        List<RussianNlpAnalyzer.Token> tokens = analyzer.analyze("Это Автоколонна.");

        assertEquals("PROPN", tokens.get(1).pos);
    }

    private static LemmaKeyLookup keys(String... values) {
        Set<String> keys = new HashSet<>(Arrays.asList(values));
        return (lemma, pos) -> keys.contains(lemma + "_" + pos);
    }
}
