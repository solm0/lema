package com.solmi.lema;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import org.junit.Test;

import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

public class GermanNlpAnalyzerTest {
    @Test
    public void preservesDesktopStyleWhitespaceSurfaces() throws Exception {
        GermanNlpAnalyzer analyzer = new GermanNlpAnalyzer(getClass().getClassLoader());

        List<GermanNlpAnalyzer.Token> tokens = analyzer.analyze("Die Hunde laufen schnell.");

        assertEquals(4, tokens.size());
        assertEquals("Die", tokens.get(0).surface);
        assertEquals("Hunde", tokens.get(1).surface);
        assertEquals("schnell.", tokens.get(3).surface);
        assertEquals("hund", tokens.get(1).lemma);
        assertEquals("NOUN", tokens.get(1).pos);
        assertEquals("laufen", tokens.get(2).lemma);
    }

    @Test
    public void keepsExistingPackKeyBeforeTryingPosAlternatives() {
        LemmaKeyLookup lookup = keys("schnell_ADJ", "schnell_ADV");

        OpenNlpAnalyzer.Annotation result = GermanNlpAnalyzer.adaptForPack(
            "schnell", "schnell", "schnell", "ADJ", lookup
        );

        assertEquals("schnell", result.lemma);
        assertEquals("ADJ", result.pos);
    }

    @Test
    public void reconcilesGermanPackPosOnlyWhenModelKeyIsMissing() {
        LemmaKeyLookup lookup = keys(
            "schnell_ADV",
            "volksstimme_NOUN"
        );

        OpenNlpAnalyzer.Annotation adjective = GermanNlpAnalyzer.adaptForPack(
            "schnell", "schnell", "schnell", "ADJ", lookup
        );
        OpenNlpAnalyzer.Annotation properNoun = GermanNlpAnalyzer.adaptForPack(
            "Volksstimme", "Volksstimme", "Volksstimme", "PROPN", lookup
        );

        assertEquals("ADV", adjective.pos);
        assertEquals("volksstimme", properNoun.lemma);
        assertEquals("NOUN", properNoun.pos);
    }

    @Test
    public void supportsModernSsFallbackAndGermanLetters() {
        LemmaKeyLookup lookup = keys("anlass_NOUN", "münchen_PROPN");

        OpenNlpAnalyzer.Annotation spelling = GermanNlpAnalyzer.adaptForPack(
            "Anlass", "Anlass", "Anlaß", "NOUN", lookup
        );
        OpenNlpAnalyzer.Annotation umlaut = GermanNlpAnalyzer.adaptForPack(
            "München", "München", "München", "PROPN", lookup
        );

        assertEquals("anlass", spelling.lemma);
        assertEquals("münchen", umlaut.lemma);
    }

    @Test
    public void appliesExistingGermanStopwordPolicy() {
        OpenNlpAnalyzer.Annotation result = GermanNlpAnalyzer.adaptForPack(
            "werden", "werden", "werden", "AUX", keys()
        );

        assertNull(result.lemma);
        assertEquals("AUX", result.pos);
    }

    private static LemmaKeyLookup keys(String... values) {
        Set<String> keys = new HashSet<>(Arrays.asList(values));
        return (lemma, pos) -> keys.contains(lemma + "_" + pos);
    }
}
