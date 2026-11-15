package com.solmi.lema.nlp;

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

/**
 * Kiwi analyzer shared semantically with Android's KoreanNlpAnalyzer.
 *
 * The model directory is intentionally external to this artifact: it belongs
 * to the installed Korean language pack, not the Electron application bundle.
 */
public final class KoreanKiwiAnalyzer implements AutoCloseable {
    public static final List<String> REQUIRED_MODEL_FILES = Collections.unmodifiableList(Arrays.asList(
        "combiningRule.txt", "cong.mdl", "default.dict", "dialect.dict", "extract.mdl",
        "multi.dict", "nounchr.mdl", "sj.morph", "typo.dict"
    ));
    private static final Pattern SURFACE_PATTERN = Pattern.compile("\\S+");
    private static final int MATCH_OPTIONS = Kiwi.Match.url | Kiwi.Match.email | Kiwi.Match.hashtag
        | Kiwi.Match.mention | Kiwi.Match.serial | Kiwi.Match.emoji | Kiwi.Match.zCoda;
    private static final Set<String> STOP_POS = new HashSet<>(Arrays.asList(
        "ADP", "AUX", "CCONJ", "DET", "PART", "PRON", "SCONJ", "PUNCT", "SYM"
    ));
    private static final Map<String, String> TAG_TO_UPOS = tagMap();

    public static final class Morph {
        public final String surface, lemma, pos;
        Morph(String surface, String lemma, String pos) { this.surface = surface; this.lemma = lemma; this.pos = pos; }
    }
    public static final class Token {
        public final String surface, lemma, pos;
        public final List<Morph> morphs;
        Token(String surface, String lemma, String pos, List<Morph> morphs) {
            this.surface = surface; this.lemma = lemma; this.pos = pos; this.morphs = morphs;
        }
    }
    private static final class RawMorph {
        final String form, tag; final int start, length;
        RawMorph(String form, String tag, int start, int length) { this.form = form; this.tag = tag; this.start = start; this.length = length; }
    }
    private static final class DisplayMorph {
        String surface; final String lemma, pos; int start, end;
        DisplayMorph(String surface, String lemma, String pos, int start, int end) {
            this.surface = surface; this.lemma = lemma; this.pos = pos; this.start = start; this.end = end;
        }
    }

    private final Kiwi kiwi;

    public KoreanKiwiAnalyzer(File modelDirectory) throws Exception {
        if (!modelsAvailable(modelDirectory)) {
            throw new IllegalStateException("Korean Kiwi model is incomplete: " + modelDirectory.getAbsolutePath());
        }
        kiwi = Kiwi.init(modelDirectory.getAbsolutePath());
    }

    public static boolean modelsAvailable(File modelDirectory) {
        if (modelDirectory == null || !modelDirectory.isDirectory()) return false;
        for (String filename : REQUIRED_MODEL_FILES) {
            File file = new File(modelDirectory, filename);
            if (!file.isFile() || file.length() == 0) return false;
        }
        return true;
    }

    public synchronized List<Token> analyze(String rawText) {
        String text = Normalizer.normalize(rawText, Normalizer.Form.NFC);
        Kiwi.Token[] analyzed = kiwi.tokenize(text, new Kiwi.AnalyzeOption(MATCH_OPTIONS));
        List<RawMorph> rawMorphs = new ArrayList<>(analyzed.length);
        for (Kiwi.Token token : analyzed) rawMorphs.add(new RawMorph(
            token.form, Kiwi.POSTag.toString(token.tag), token.position, token.length
        ));
        rawMorphs.sort(Comparator.comparingInt((RawMorph morph) -> morph.start).thenComparingInt(morph -> morph.length));

        List<Token> output = new ArrayList<>();
        Matcher matcher = SURFACE_PATTERN.matcher(text);
        while (matcher.find()) {
            int start = matcher.start(), end = matcher.end();
            List<RawMorph> matched = new ArrayList<>();
            for (RawMorph morph : rawMorphs) {
                if (morph.start >= end) break;
                if (morph.start >= start) matched.add(morph);
            }
            List<Morph> morphs = buildDisplayMorphs(matcher.group(), matched, start);
            Morph representative = representativeMorph(morphs);
            output.add(new Token(matcher.group(), representative == null ? null : representative.lemma,
                representative == null ? null : representative.pos, morphs));
        }
        return output;
    }

    private static List<Morph> buildDisplayMorphs(String surface, List<RawMorph> rawMorphs, int tokenStart) {
        boolean[] occupied = new boolean[surface.length()];
        List<DisplayMorph> display = new ArrayList<>();
        for (RawMorph raw : rawMorphs) {
            int localStart = Math.max(0, raw.start - tokenStart);
            int localEnd = Math.min(surface.length(), localStart + Math.max(0, raw.length));
            StringBuilder shown = new StringBuilder(); int first = -1, last = -1;
            for (int index = localStart; index < localEnd; index++) {
                if (occupied[index]) continue;
                if (first < 0) first = index;
                last = index + 1; shown.append(surface.charAt(index));
            }
            if (first < 0) continue;
            for (int index = first; index < last; index++) if (index >= localStart && index < localEnd) occupied[index] = true;
            String lemma = normalizeLemma(raw.form, raw.tag);
            display.add(new DisplayMorph(shown.toString(), lemma, mapTag(raw.tag, lemma, shown.toString()), first, last));
        }
        if (display.isEmpty()) return Collections.singletonList(new Morph(surface, null, null));
        int index = 0;
        while (index < surface.length()) {
            if (occupied[index]) { index++; continue; }
            int start = index;
            while (index < surface.length() && !occupied[index]) index++;
            String chunk = surface.substring(start, index); DisplayMorph target = null;
            for (DisplayMorph candidate : display) { if (candidate.end <= start) target = candidate; else break; }
            if (target == null) { DisplayMorph first = display.get(0); first.surface = chunk + first.surface; first.start = start; }
            else { target.surface += chunk; target.end = index; }
        }
        List<Morph> output = new ArrayList<>(display.size());
        for (DisplayMorph morph : display) output.add(new Morph(morph.surface, morph.lemma, morph.pos));
        return output;
    }

    private static Morph representativeMorph(List<Morph> morphs) {
        for (Morph morph : morphs) if (morph.lemma != null && morph.pos != null && !"X".equals(morph.pos) && !STOP_POS.contains(morph.pos)) return morph;
        return morphs.isEmpty() ? null : morphs.get(0);
    }
    private static String normalizeLemma(String lemma, String tag) {
        if (lemma == null) return null;
        String normalized = Normalizer.normalize(lemma, Normalizer.Form.NFC).toLowerCase(Locale.ROOT).trim();
        if (!normalized.isEmpty() && predicateTag(tag) && !normalized.endsWith("다")) normalized += "다";
        return normalized.isEmpty() ? null : normalized;
    }
    private static boolean predicateTag(String tag) {
        String value = tag == null ? "" : tag.trim().toUpperCase(Locale.ROOT);
        return Arrays.asList("VV", "VA", "VX", "VCP", "VCN", "PV", "PA").contains(value);
    }
    private static String mapTag(String tag, String lemma, String surface) {
        String value = tag == null ? "" : tag.trim().toUpperCase(Locale.ROOT);
        if ("MAG".equals(value) && "다".equals(lemma) && "다".equals(surface)) return "PART";
        return TAG_TO_UPOS.getOrDefault(value, "X");
    }
    private static Map<String, String> tagMap() {
        Map<String, String> result = new HashMap<>();
        put(result, "NOUN", "NNG", "NNB", "XR", "XSN"); put(result, "PROPN", "NNP"); put(result, "PRON", "NP"); put(result, "NUM", "NR", "SN");
        put(result, "VERB", "VV"); put(result, "ADJ", "VA", "VCN"); put(result, "AUX", "VX", "VCP", "EP", "XSV", "XSA"); put(result, "DET", "MM");
        put(result, "ADV", "MAG"); put(result, "CCONJ", "MAJ", "JC"); put(result, "INTJ", "IC"); put(result, "ADP", "JKS", "JKC", "JKG", "JKO", "JKB", "JKV", "JKQ");
        put(result, "PART", "JX", "EF", "ETN", "ETM", "XPN"); put(result, "SCONJ", "EC"); put(result, "PUNCT", "SF", "SP", "SS", "SSO", "SSC", "SE", "SO");
        put(result, "SYM", "SW", "SB", "W_EMOJI"); put(result, "X", "SL", "SH", "W_URL", "W_EMAIL", "W_MENTION", "W_HASHTAG", "W_SERIAL");
        return Collections.unmodifiableMap(result);
    }
    private static void put(Map<String, String> target, String upos, String... tags) { for (String tag : tags) target.put(tag, upos); }

    @Override public synchronized void close() throws Exception { kiwi.close(); }
}
