package com.solmi.lema;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;

import org.junit.Test;

import java.util.List;

public class EnglishNlpAnalyzerTest {
    @Test
    public void preservesDesktopStyleWhitespaceSurfaces() throws Exception {
        EnglishNlpAnalyzer analyzer = new EnglishNlpAnalyzer(getClass().getClassLoader());

        List<EnglishNlpAnalyzer.Token> tokens = analyzer.analyze("Dogs are running.");

        assertEquals(3, tokens.size());
        assertEquals("Dogs", tokens.get(0).surface);
        assertEquals("are", tokens.get(1).surface);
        assertEquals("running.", tokens.get(2).surface);
        assertEquals("dog", tokens.get(0).lemma);
        assertEquals("run", tokens.get(2).lemma);
        assertEquals("VERB", tokens.get(2).pos);
    }

    @Test
    public void keepsContractionsWholeWhileFilteringStopLemmas() throws Exception {
        EnglishNlpAnalyzer analyzer = new EnglishNlpAnalyzer(getClass().getClassLoader());

        List<EnglishNlpAnalyzer.Token> tokens = analyzer.analyze("I don't know.");

        assertEquals(3, tokens.size());
        assertEquals("don't", tokens.get(1).surface);
        assertNull(tokens.get(1).lemma);
        assertNotNull(tokens.get(1).pos);
    }

    @Test
    public void appliesTheExistingEnglishPackStopwordAdapter() throws Exception {
        EnglishNlpAnalyzer analyzer = new EnglishNlpAnalyzer(getClass().getClassLoader());

        List<EnglishNlpAnalyzer.Token> tokens = analyzer.analyze("The dog is happy.");

        assertEquals(4, tokens.size());
        assertNull(tokens.get(0).lemma);
        assertEquals("dog", tokens.get(1).lemma);
        assertNull(tokens.get(2).lemma);
        assertEquals("happy", tokens.get(3).lemma);
    }
}
