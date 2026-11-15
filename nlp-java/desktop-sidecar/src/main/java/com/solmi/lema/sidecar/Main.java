package com.solmi.lema.sidecar;

import com.solmi.lema.nlp.EnglishOpenNlpAnalyzer;
import com.solmi.lema.nlp.GermanOpenNlpAnalyzer;
import com.solmi.lema.nlp.RussianOpenNlpAnalyzer;
import com.solmi.lema.nlp.JapaneseSudachiAnalyzer;
import com.solmi.lema.nlp.KoreanKiwiAnalyzer;

import java.io.BufferedReader;
import java.io.File;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashSet;
import java.util.Set;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.List;

/** Line-oriented local helper. Requests are base64 UTF-8 text; responses are JSON. */
public final class Main {
    private Main() { }

    public static void main(String[] args) throws Exception {
        if ((args.length != 4 && args.length != 6) || !"--language".equals(args[0]) || !"--model-dir".equals(args[2]) || (args.length == 6 && !"--lemma-keys".equals(args[4]))) {
            throw new IllegalArgumentException("usage: --language <en|de|ja|ko|ru> --model-dir <directory> [--lemma-keys <file>]");
        }
        String language = args[1];
        File modelDirectory = new File(args[3]);
        EnglishOpenNlpAnalyzer english = "en".equals(language) ? new EnglishOpenNlpAnalyzer(modelDirectory) : null;
        Set<String> lemmaKeys = args.length == 6 ? new HashSet<>(Files.readAllLines(Path.of(args[5]), StandardCharsets.UTF_8)) : null;
        GermanOpenNlpAnalyzer.LemmaKeyLookup germanLookup = lemmaKeys == null ? null : (lemma, pos) -> lemmaKeys.contains(lemma + "_" + pos);
        RussianOpenNlpAnalyzer.LemmaKeyLookup russianLookup = lemmaKeys == null ? null : (lemma, pos) -> lemmaKeys.contains(lemma + "_" + pos);
        JapaneseSudachiAnalyzer.LemmaKeyLookup japaneseLookup = lemmaKeys == null ? null : (lemma, pos) -> lemmaKeys.contains(lemma + "_" + pos);
        GermanOpenNlpAnalyzer german = "de".equals(language) ? new GermanOpenNlpAnalyzer(modelDirectory, germanLookup) : null;
        RussianOpenNlpAnalyzer russian = "ru".equals(language) ? new RussianOpenNlpAnalyzer(modelDirectory, russianLookup) : null;
        JapaneseSudachiAnalyzer japanese = "ja".equals(language) ? new JapaneseSudachiAnalyzer(modelDirectory, japaneseLookup) : null;
        KoreanKiwiAnalyzer korean = "ko".equals(language) ? new KoreanKiwiAnalyzer(modelDirectory) : null;
        if (english == null && german == null && russian == null && japanese == null && korean == null) throw new IllegalArgumentException("Unsupported language: " + language);
        try (BufferedReader input = new BufferedReader(
            new InputStreamReader(System.in, StandardCharsets.UTF_8)
        )) {
            String encoded;
            while ((encoded = input.readLine()) != null) {
                try {
                    String text = new String(Base64.getDecoder().decode(encoded), StandardCharsets.UTF_8);
                    if (english != null) System.out.println(englishTokensJson(english.analyze(text)));
                    else if (german != null) System.out.println(germanTokensJson(german.analyze(text)));
                    else if (russian != null) System.out.println(russianTokensJson(russian.analyze(text)));
                    else if (japanese != null) System.out.println(japaneseTokensJson(japanese.analyze(text)));
                    else System.out.println(koreanTokensJson(korean.analyze(text)));
                } catch (Exception error) {
                    System.out.println("{\"error\":\"" + escape(error.getMessage()) + "\"}");
                }
                System.out.flush();
            }
        }
    }

    private static String englishTokensJson(List<EnglishOpenNlpAnalyzer.Token> tokens) {
        StringBuilder output = new StringBuilder("{\"tokens\":[");
        for (int index = 0; index < tokens.size(); index += 1) {
            if (index > 0) output.append(',');
            EnglishOpenNlpAnalyzer.Token token = tokens.get(index);
            output.append("{\"surface\":\"").append(escape(token.surface)).append("\",");
            output.append("\"lemma\":").append(nullable(token.lemma)).append(',');
            output.append("\"pos\":").append(nullable(token.pos)).append('}');
        }
        return output.append("]}").toString();
    }

    private static String germanTokensJson(List<GermanOpenNlpAnalyzer.Token> tokens) {
        StringBuilder output = new StringBuilder("{\"tokens\":[");
        for (int index = 0; index < tokens.size(); index += 1) { if (index > 0) output.append(','); GermanOpenNlpAnalyzer.Token token = tokens.get(index); appendToken(output, token.surface, token.lemma, token.pos); }
        return output.append("]}").toString();
    }

    private static String russianTokensJson(List<RussianOpenNlpAnalyzer.Token> tokens) {
        StringBuilder output = new StringBuilder("{\"tokens\":[");
        for (int index = 0; index < tokens.size(); index += 1) { if (index > 0) output.append(','); RussianOpenNlpAnalyzer.Token token = tokens.get(index); appendToken(output, token.surface, token.lemma, token.pos); }
        return output.append("]}").toString();
    }

    private static String japaneseTokensJson(List<JapaneseSudachiAnalyzer.Token> tokens) {
        StringBuilder output = new StringBuilder("{\"tokens\":[");
        for (int index = 0; index < tokens.size(); index += 1) {
            if (index > 0) output.append(',');
            JapaneseSudachiAnalyzer.Token token = tokens.get(index);
            appendToken(output, token.surface, token.lemma, token.pos);
            output.setLength(output.length() - 1);
            output.append(",\"morphs\":[");
            for (int morphIndex = 0; morphIndex < token.morphs.size(); morphIndex += 1) {
                if (morphIndex > 0) output.append(',');
                JapaneseSudachiAnalyzer.Morph morph = token.morphs.get(morphIndex);
                appendToken(output, morph.surface, morph.lemma, morph.pos);
            }
            output.append("]}");
        }
        return output.append("]}").toString();
    }

    private static String koreanTokensJson(List<KoreanKiwiAnalyzer.Token> tokens) {
        StringBuilder output = new StringBuilder("{\"tokens\":[");
        for (int index = 0; index < tokens.size(); index += 1) {
            if (index > 0) output.append(',');
            KoreanKiwiAnalyzer.Token token = tokens.get(index);
            appendToken(output, token.surface, token.lemma, token.pos);
            output.setLength(output.length() - 1);
            output.append(",\"morphs\":[");
            for (int morphIndex = 0; morphIndex < token.morphs.size(); morphIndex += 1) {
                if (morphIndex > 0) output.append(',');
                KoreanKiwiAnalyzer.Morph morph = token.morphs.get(morphIndex);
                appendToken(output, morph.surface, morph.lemma, morph.pos);
            }
            output.append("]}");
        }
        return output.append("]}").toString();
    }

    private static void appendToken(StringBuilder output, String surface, String lemma, String pos) {
        output.append("{\"surface\":\"").append(escape(surface)).append("\",");
        output.append("\"lemma\":").append(nullable(lemma)).append(',');
        output.append("\"pos\":").append(nullable(pos)).append('}');
    }

    private static String nullable(String value) {
        return value == null ? "null" : "\"" + escape(value) + "\"";
    }

    private static String escape(String value) {
        if (value == null) return "unknown sidecar error";
        return value.replace("\\", "\\\\").replace("\"", "\\\"")
            .replace("\n", "\\n").replace("\r", "\\r").replace("\t", "\\t");
    }
}
