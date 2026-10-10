package com.solmi.lema;

import kr.pe.bab2min.Kiwi;

import java.io.File;
import java.text.Normalizer;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Korean analyzer backed by Kiwi's Android Java binding. */
final class KoreanNlpAnalyzer implements AutoCloseable {
    static final String MODEL_DIRECTORY = "kiwi";
    static final List<String> REQUIRED_MODEL_FILES = Collections.unmodifiableList(Arrays.asList(
        "combiningRule.txt",
        "cong.mdl",
        "default.dict",
        "dialect.dict",
        "extract.mdl",
        "multi.dict",
        "nounchr.mdl",
        "sj.morph",
        "typo.dict"
    ));

    private static final Pattern SURFACE_PATTERN = Pattern.compile("\\S+");
    // Mirrors kiwipiepy Kiwi.tokenize() defaults used by backend/language_config/ko.py:
    // Match.ALL plus z_coda, without coda normalization or complex splitting.
    private static final int DESKTOP_MATCH_OPTIONS = Kiwi.Match.url
        | Kiwi.Match.email
        | Kiwi.Match.hashtag
        | Kiwi.Match.mention
        | Kiwi.Match.serial
        | Kiwi.Match.emoji
        | Kiwi.Match.zCoda;
    private static final Set<String> STOP_POS = new HashSet<>(Arrays.asList(
        "ADP", "AUX", "CCONJ", "DET", "PART", "PRON", "SCONJ", "PUNCT", "SYM"
    ));
    private static final Map<String, String> TAG_TO_UPOS = buildTagMap();

    static final class Morph {
        final String surface;
        final String lemma;
        final String pos;

        Morph(String surface, String lemma, String pos) {
            this.surface = surface;
            this.lemma = lemma;
            this.pos = pos;
        }
    }

    static final class Token {
        final String surface;
        final String lemma;
        final String pos;
        final List<Morph> morphs;

        Token(String surface, String lemma, String pos, List<Morph> morphs) {
            this.surface = surface;
            this.lemma = lemma;
            this.pos = pos;
            this.morphs = morphs;
        }
    }

    static final class RawMorph {
        final String form;
        final String tag;
        final int start;
        final int length;

        RawMorph(String form, String tag, int start, int length) {
            this.form = form;
            this.tag = tag;
            this.start = start;
            this.length = length;
        }
    }

    interface MorphAnalyzer extends AutoCloseable {
        List<RawMorph> analyze(String text) throws Exception;

        @Override
        void close() throws Exception;
    }

    private static final class KiwiMorphAnalyzer implements MorphAnalyzer {
        private final Kiwi kiwi;

        KiwiMorphAnalyzer(File modelDirectory) throws Exception {
            kiwi = Kiwi.init(modelDirectory.getAbsolutePath());
        }

        @Override
        public List<RawMorph> analyze(String text) {
            Kiwi.Token[] analyzed = kiwi.tokenize(
                text,
                new Kiwi.AnalyzeOption(DESKTOP_MATCH_OPTIONS)
            );
            List<RawMorph> output = new ArrayList<>(analyzed.length);
            for (Kiwi.Token token : analyzed) {
                output.add(new RawMorph(
                    token.form,
                    Kiwi.POSTag.toString(token.tag),
                    token.position,
                    token.length
                ));
            }
            return output;
        }

        @Override
        public void close() throws Exception {
            kiwi.close();
        }
    }

    private final MorphAnalyzer morphAnalyzer;

    KoreanNlpAnalyzer(File modelDirectory) throws Exception {
        if (!modelsAvailable(modelDirectory)) {
            throw new IllegalStateException(
                "Korean Kiwi model is incomplete: " + modelDirectory.getAbsolutePath()
            );
        }
        morphAnalyzer = new KiwiMorphAnalyzer(modelDirectory);
    }

    KoreanNlpAnalyzer(MorphAnalyzer morphAnalyzer) {
        this.morphAnalyzer = morphAnalyzer;
    }

    static boolean modelsAvailable(File modelDirectory) {
        if (modelDirectory == null || !modelDirectory.isDirectory()) return false;
        for (String filename : REQUIRED_MODEL_FILES) {
            File model = new File(modelDirectory, filename);
            if (!model.isFile() || model.length() == 0) return false;
        }
        return true;
    }

    synchronized List<Token> analyze(String rawText) throws Exception {
        String text = Normalizer.normalize(rawText, Normalizer.Form.NFC);
        List<RawMorph> rawMorphs = new ArrayList<>(morphAnalyzer.analyze(text));
        rawMorphs.sort(Comparator.comparingInt((RawMorph morph) -> morph.start)
            .thenComparingInt(morph -> morph.length));

        List<Token> output = new ArrayList<>();
        Matcher surfaceMatcher = SURFACE_PATTERN.matcher(text);
        while (surfaceMatcher.find()) {
            int start = surfaceMatcher.start();
            int end = surfaceMatcher.end();
            List<RawMorph> matched = new ArrayList<>();
            for (RawMorph morph : rawMorphs) {
                if (morph.start >= end) break;
                if (morph.start >= start) matched.add(morph);
            }
            List<Morph> morphs = buildDisplayMorphs(
                surfaceMatcher.group(),
                matched,
                start
            );
            Morph representative = representativeMorph(morphs);
            output.add(new Token(
                surfaceMatcher.group(),
                representative != null ? representative.lemma : null,
                representative != null ? representative.pos : null,
                morphs
            ));
        }
        return output;
    }

    static List<Morph> buildDisplayMorphs(
        String surface,
        List<RawMorph> rawMorphs,
        int tokenStart
    ) {
        boolean[] occupied = new boolean[surface.length()];
        List<DisplayMorph> displayMorphs = new ArrayList<>();

        List<RawMorph> ordered = new ArrayList<>(rawMorphs);
        ordered.sort(Comparator.comparingInt((RawMorph morph) -> morph.start)
            .thenComparingInt(morph -> morph.length));

        for (RawMorph rawMorph : ordered) {
            int localStart = Math.max(0, rawMorph.start - tokenStart);
            int localEnd = Math.min(surface.length(), localStart + Math.max(0, rawMorph.length));
            StringBuilder displaySurface = new StringBuilder();
            int first = -1;
            int last = -1;
            for (int index = localStart; index < localEnd; index += 1) {
                if (occupied[index]) continue;
                if (first < 0) first = index;
                last = index + 1;
                displaySurface.append(surface.charAt(index));
            }
            if (first < 0) continue;
            for (int index = first; index < last; index += 1) {
                if (index >= localStart && index < localEnd) occupied[index] = true;
            }

            String lemma = normalizeLemma(rawMorph.form, rawMorph.tag);
            String pos = mapTag(rawMorph.tag, lemma, displaySurface.toString());
            displayMorphs.add(new DisplayMorph(
                displaySurface.toString(), lemma, pos, first, last
            ));
        }

        if (displayMorphs.isEmpty()) {
            return Collections.singletonList(new Morph(surface, null, null));
        }

        int index = 0;
        while (index < surface.length()) {
            if (occupied[index]) {
                index += 1;
                continue;
            }
            int start = index;
            while (index < surface.length() && !occupied[index]) index += 1;
            String chunk = surface.substring(start, index);

            DisplayMorph target = null;
            for (DisplayMorph candidate : displayMorphs) {
                if (candidate.end <= start) target = candidate;
                else break;
            }
            if (target == null) {
                DisplayMorph first = displayMorphs.get(0);
                first.surface = chunk + first.surface;
                first.start = start;
            } else {
                target.surface += chunk;
                target.end = index;
            }
        }

        List<Morph> output = new ArrayList<>(displayMorphs.size());
        for (DisplayMorph morph : displayMorphs) {
            output.add(new Morph(morph.surface, morph.lemma, morph.pos));
        }
        return output;
    }

    static String mapTag(String tag, String lemma, String surface) {
        String normalizedTag = tag == null ? "" : tag.trim().toUpperCase(Locale.ROOT);
        if ("MAG".equals(normalizedTag) && "다".equals(lemma) && "다".equals(surface)) {
            return "PART";
        }
        return TAG_TO_UPOS.getOrDefault(normalizedTag, "X");
    }

    private static Morph representativeMorph(List<Morph> morphs) {
        for (Morph morph : morphs) {
            if (morph.lemma != null
                && morph.pos != null
                && !"X".equals(morph.pos)
                && !STOP_POS.contains(morph.pos)) {
                return morph;
            }
        }
        return morphs.isEmpty() ? null : morphs.get(0);
    }

    private static String normalizeLemma(String lemma, String tag) {
        if (lemma == null) return null;
        String normalized = Normalizer.normalize(lemma, Normalizer.Form.NFC)
            .toLowerCase(Locale.ROOT)
            .trim();
        String normalizedTag = tag == null ? "" : tag.trim().toUpperCase(Locale.ROOT);
        if (!normalized.isEmpty() && isPredicateTag(normalizedTag) && !normalized.endsWith("다")) {
            normalized += "다";
        }
        return normalized.isEmpty() ? null : normalized;
    }

    private static boolean isPredicateTag(String tag) {
        return "VV".equals(tag)
            || "VA".equals(tag)
            || "VX".equals(tag)
            || "VCP".equals(tag)
            || "VCN".equals(tag)
            || "PV".equals(tag)
            || "PA".equals(tag);
    }

    private static Map<String, String> buildTagMap() {
        Map<String, String> result = new HashMap<>();
        putTags(result, "NOUN", "NNG", "NNB", "XR", "XSN");
        putTags(result, "PROPN", "NNP");
        putTags(result, "PRON", "NP");
        putTags(result, "NUM", "NR", "SN");
        putTags(result, "VERB", "VV");
        putTags(result, "ADJ", "VA", "VCN");
        putTags(result, "AUX", "VX", "VCP", "EP", "XSV", "XSA");
        putTags(result, "DET", "MM");
        putTags(result, "ADV", "MAG");
        putTags(result, "CCONJ", "MAJ", "JC");
        putTags(result, "INTJ", "IC");
        putTags(result, "ADP", "JKS", "JKC", "JKG", "JKO", "JKB", "JKV", "JKQ");
        putTags(result, "PART", "JX", "EF", "ETN", "ETM", "XPN");
        putTags(result, "SCONJ", "EC");
        putTags(result, "PUNCT", "SF", "SP", "SS", "SSO", "SSC", "SE", "SO");
        putTags(result, "SYM", "SW", "SB", "W_EMOJI");
        putTags(result, "X", "SL", "SH", "W_URL", "W_EMAIL", "W_MENTION", "W_HASHTAG", "W_SERIAL");
        return Collections.unmodifiableMap(result);
    }

    private static void putTags(Map<String, String> target, String upos, String... tags) {
        for (String tag : tags) target.put(tag, upos);
    }

    @Override
    public synchronized void close() throws Exception {
        morphAnalyzer.close();
    }

    private static final class DisplayMorph {
        String surface;
        final String lemma;
        final String pos;
        int start;
        int end;

        DisplayMorph(String surface, String lemma, String pos, int start, int end) {
            this.surface = surface;
            this.lemma = lemma;
            this.pos = pos;
            this.start = start;
            this.end = end;
        }
    }
}
