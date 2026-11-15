package com.solmi.lema.nlp;

import java.io.File;
import java.io.IOException;
import java.text.Normalizer;
import java.util.Arrays;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.ArrayList;
import java.util.regex.Pattern;

/** Shared German/Russian analyzer rules, including existing-pack fallbacks. */
final class PackOpenNlpAnalyzer {
    interface LemmaKeyLookup { boolean contains(String lemma, String pos); }
    static final class Token { final String surface, lemma, pos; Token(String surface, String lemma, String pos) { this.surface = surface; this.lemma = lemma; this.pos = pos; } }
    private static final Set<String> STOP_POS = new HashSet<>(Arrays.asList("PUNCT", "SYM", "SPACE", "DET", "CCONJ", "SCONJ", "PART", "PRON", "ADP"));
    private static final List<String> FALLBACK_POS = Arrays.asList("ADJ", "ADV", "AUX", "INTJ", "NOUN", "NUM", "PROPN", "VERB", "X");
    private final boolean russian;
    private final Pattern valid, edge, uppercase, sentenceEnd;
    private final Set<String> stopLemmas;
    private final LemmaKeyLookup lookup;
    private final OpenNlpPipeline pipeline;

    PackOpenNlpAnalyzer(File models, OpenNlpPipeline.Models names, boolean russian, LemmaKeyLookup lookup) throws IOException {
        this.russian = russian;
        this.lookup = lookup;
        valid = Pattern.compile(russian ? "^[а-яё-]+$" : "^[a-zäöüß]+$");
        edge = Pattern.compile(russian ? "^[^а-яё]+|[^а-яё]+$" : "^[^a-zäöüß]+|[^a-zäöüß]+$");
        uppercase = Pattern.compile("^[^А-ЯЁа-яё]*[А-ЯЁ]");
        sentenceEnd = Pattern.compile("[.!?…][\"\u201d»)\\]]*$");
        stopLemmas = new HashSet<>(Arrays.asList((russian
            ? "быть,мочь,сказать,становиться,более,уже,затем,однако,тогда,там,здесь,также,ещё,еще,только,примерно"
            : "sein,haben,werden,können,müssen,sollen,wollen,dürfen,mögen,mehr,bereits,zunächst,schließlich,jedoch,dann,dort,hier,auch,noch,nur,etwa,wohl").split(",")));
        pipeline = new OpenNlpPipeline(models, names, russian ? "Russian" : "German", this::adapt);
    }

    static boolean modelsAvailable(File directory, OpenNlpPipeline.Models models) { return OpenNlpPipeline.modelsAvailable(directory, models); }

    List<Token> analyze(String rawText) {
        List<Token> result = new ArrayList<>();
        boolean sentenceStart = true;
        for (OpenNlpPipeline.Token token : pipeline.analyze(rawText)) {
            String pos = token.pos;
            if (russian && !sentenceStart && lookup != null && token.lemma != null && "NOUN".equals(pos) && uppercase.matcher(token.surface).find() && lookup.contains(token.lemma, "PROPN")) pos = "PROPN";
            result.add(new Token(token.surface, token.lemma, pos));
            sentenceStart = sentenceEnd.matcher(token.surface).find();
        }
        return result;
    }

    private OpenNlpPipeline.Annotation adapt(String surface, String modelSurface, String lemma, String pos) {
        String normalizedPos = nonEmpty(pos), normalizedLemma = normalize(lemma);
        if (normalizedLemma == null || normalizedPos == null || STOP_POS.contains(normalizedPos) || stopLemmas.contains(normalizedLemma) || !valid.matcher(normalizedLemma).matches()) return new OpenNlpPipeline.Annotation(null, normalizedPos);
        if (lookup == null || lookup.contains(normalizedLemma, normalizedPos)) return new OpenNlpPipeline.Annotation(normalizedLemma, normalizedPos);
        LinkedHashSet<String> candidates = new LinkedHashSet<>();
        if (russian) addYo(candidates, normalizedLemma, normalizedPos); else add(candidates, normalizedLemma.replace("ß", "ss"), normalizedPos);
        if (!russian) preferred(candidates, normalizedLemma, normalizedPos);
        String normalizedSurface = normalizeSurface(modelSurface);
        if (normalizedSurface == null) normalizedSurface = normalizeSurface(surface);
        if (normalizedSurface != null) {
            add(candidates, normalizedSurface, normalizedPos);
            if (russian) { if ("PROPN".equals(normalizedPos)) add(candidates, normalizedSurface, "PROPN"); addYo(candidates, normalizedSurface, normalizedPos); } else preferred(candidates, normalizedSurface, normalizedPos);
        }
        if (russian) {
            if ("NOUN".equals(normalizedPos)) { add(candidates, normalizedLemma, "PROPN"); addYo(candidates, normalizedLemma, "PROPN"); }
            else if ("PROPN".equals(normalizedPos)) { add(candidates, normalizedLemma, "NOUN"); addYo(candidates, normalizedLemma, "NOUN"); if (normalizedSurface != null) { add(candidates, normalizedSurface, "NOUN"); addYo(candidates, normalizedSurface, "NOUN"); } }
        }
        for (String fallback : FALLBACK_POS) if (!fallback.equals(normalizedPos)) add(candidates, normalizedLemma, fallback);
        for (String candidate : candidates) { int separator = candidate.lastIndexOf('\t'); if (lookup.contains(candidate.substring(0, separator), candidate.substring(separator + 1))) return new OpenNlpPipeline.Annotation(candidate.substring(0, separator), candidate.substring(separator + 1)); }
        return new OpenNlpPipeline.Annotation(normalizedLemma, normalizedPos);
    }

    private void preferred(Set<String> candidates, String lemma, String pos) { if ("NOUN".equals(pos)) add(candidates, lemma, "PROPN"); else if ("PROPN".equals(pos)) add(candidates, lemma, "NOUN"); else if ("ADJ".equals(pos)) { add(candidates, lemma, "ADV"); add(candidates, lemma, "VERB"); } }
    private void addYo(Set<String> candidates, String lemma, String pos) { if (lemma.indexOf('ё') >= 0) add(candidates, lemma.replace('ё', 'е'), pos); for (int i = lemma.indexOf('е'); i >= 0; i = lemma.indexOf('е', i + 1)) add(candidates, lemma.substring(0, i) + 'ё' + lemma.substring(i + 1), pos); }
    private void add(Set<String> candidates, String lemma, String pos) { if (lemma != null && pos != null && !stopLemmas.contains(lemma) && valid.matcher(lemma).matches()) candidates.add(lemma + '\t' + pos); }
    private String normalizeSurface(String value) { String normalized = normalize(value); if (normalized == null) return null; normalized = edge.matcher(normalized).replaceAll(""); return valid.matcher(normalized).matches() ? normalized : null; }
    private static String normalize(String value) { String normalized = nonEmpty(value); return normalized == null || "O".equals(normalized) ? null : Normalizer.normalize(normalized, Normalizer.Form.NFC).toLowerCase(Locale.ROOT).trim(); }
    private static String nonEmpty(String value) { if (value == null) return null; String trimmed = value.trim(); return trimmed.isEmpty() ? null : trimmed; }
}
