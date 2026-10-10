package com.solmi.lema;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import org.junit.Test;

import java.util.Arrays;
import java.util.Collections;
import java.util.List;

public class KoreanNlpAnalyzerTest {
    @Test
    public void emitsDesktopCompatibleMorphsInsideWhitespaceTokens() throws Exception {
        KoreanNlpAnalyzer analyzer = new KoreanNlpAnalyzer(analyzerReturning(
            new KoreanNlpAnalyzer.RawMorph("유명", "NNG", 0, 2),
            new KoreanNlpAnalyzer.RawMorph("하", "XSA", 2, 1),
            new KoreanNlpAnalyzer.RawMorph("다", "EF", 3, 1),
            new KoreanNlpAnalyzer.RawMorph(".", "SF", 4, 1)
        ));

        List<KoreanNlpAnalyzer.Token> tokens = analyzer.analyze("유명하다.");

        assertEquals(1, tokens.size());
        KoreanNlpAnalyzer.Token token = tokens.get(0);
        assertEquals("유명하다.", token.surface);
        assertEquals("유명", token.lemma);
        assertEquals("NOUN", token.pos);
        assertEquals(4, token.morphs.size());
        assertEquals("유명", token.morphs.get(0).surface);
        assertEquals("AUX", token.morphs.get(1).pos);
        assertEquals("PART", token.morphs.get(2).pos);
        assertEquals("PUNCT", token.morphs.get(3).pos);
    }

    @Test
    public void preservesUncoveredCharactersLikeDesktopAdapter() {
        List<KoreanNlpAnalyzer.Morph> morphs = KoreanNlpAnalyzer.buildDisplayMorphs(
            "사찰,",
            Collections.singletonList(new KoreanNlpAnalyzer.RawMorph("사찰", "NNG", 0, 2)),
            0
        );

        assertEquals(1, morphs.size());
        assertEquals("사찰,", morphs.get(0).surface);
        assertEquals("사찰", morphs.get(0).lemma);
        assertEquals("NOUN", morphs.get(0).pos);
    }

    @Test
    public void dropsOverlappingMorphSurfaceLikeDesktopAdapter() {
        List<KoreanNlpAnalyzer.Morph> morphs = KoreanNlpAnalyzer.buildDisplayMorphs(
            "할",
            Arrays.asList(
                new KoreanNlpAnalyzer.RawMorph("하", "XSV", 0, 1),
                new KoreanNlpAnalyzer.RawMorph("ᆯ", "ETM", 0, 1)
            ),
            0
        );

        assertEquals(1, morphs.size());
        assertEquals("할", morphs.get(0).surface);
        assertEquals("하", morphs.get(0).lemma);
    }

    @Test
    public void usesFirstContentMorphAsRepresentative() throws Exception {
        KoreanNlpAnalyzer analyzer = new KoreanNlpAnalyzer(analyzerReturning(
            new KoreanNlpAnalyzer.RawMorph("반", "XPN", 0, 1),
            new KoreanNlpAnalyzer.RawMorph("민주", "NNG", 1, 2),
            new KoreanNlpAnalyzer.RawMorph("적", "XSN", 3, 1)
        ));

        KoreanNlpAnalyzer.Token token = analyzer.analyze("반민주적").get(0);

        assertEquals("민주", token.lemma);
        assertEquals("NOUN", token.pos);
    }

    @Test
    public void restoresDictionaryEndingForKiwiPredicateTags() throws Exception {
        KoreanNlpAnalyzer analyzer = new KoreanNlpAnalyzer(analyzerReturning(
            new KoreanNlpAnalyzer.RawMorph("하", "VV", 0, 1),
            new KoreanNlpAnalyzer.RawMorph("는", "ETM", 1, 1)
        ));

        KoreanNlpAnalyzer.Token token = analyzer.analyze("하는").get(0);

        assertEquals("하다", token.lemma);
        assertEquals("하다", token.morphs.get(0).lemma);
        assertEquals("VERB", token.pos);
    }

    @Test
    public void keepsUnknownTagButDoesNotSelectItAsRepresentative() throws Exception {
        KoreanNlpAnalyzer analyzer = new KoreanNlpAnalyzer(analyzerReturning(
            new KoreanNlpAnalyzer.RawMorph("abc", "UNKNOWN", 0, 3)
        ));

        KoreanNlpAnalyzer.Token token = analyzer.analyze("abc").get(0);

        assertEquals("abc", token.lemma);
        assertEquals("X", token.pos);
        assertEquals("X", token.morphs.get(0).pos);
    }

    @Test
    public void returnsNullAnnotationWhenKiwiHasNoMorph() throws Exception {
        KoreanNlpAnalyzer analyzer = new KoreanNlpAnalyzer(analyzerReturning());

        KoreanNlpAnalyzer.Token token = analyzer.analyze("테스트").get(0);

        assertNull(token.lemma);
        assertNull(token.pos);
        assertEquals("테스트", token.morphs.get(0).surface);
    }

    private static KoreanNlpAnalyzer.MorphAnalyzer analyzerReturning(
        KoreanNlpAnalyzer.RawMorph... morphs
    ) {
        return new KoreanNlpAnalyzer.MorphAnalyzer() {
            @Override
            public List<KoreanNlpAnalyzer.RawMorph> analyze(String text) {
                return Arrays.asList(morphs);
            }

            @Override
            public void close() {}
        };
    }
}
