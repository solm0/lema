package com.solmi.lema.sidecar;

import com.solmi.lema.nlp.EnglishOpenNlpAnalyzer;

import java.io.BufferedReader;
import java.io.File;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.List;

/** Line-oriented local helper. Requests are base64 UTF-8 text; responses are JSON. */
public final class Main {
    private Main() { }

    public static void main(String[] args) throws Exception {
        if (args.length != 2 || !"--model-dir".equals(args[0])) {
            throw new IllegalArgumentException("usage: --model-dir <directory>");
        }
        EnglishOpenNlpAnalyzer analyzer = new EnglishOpenNlpAnalyzer(new File(args[1]));
        try (BufferedReader input = new BufferedReader(
            new InputStreamReader(System.in, StandardCharsets.UTF_8)
        )) {
            String encoded;
            while ((encoded = input.readLine()) != null) {
                try {
                    String text = new String(Base64.getDecoder().decode(encoded), StandardCharsets.UTF_8);
                    System.out.println(tokensJson(analyzer.analyze(text)));
                } catch (Exception error) {
                    System.out.println("{\"error\":\"" + escape(error.getMessage()) + "\"}");
                }
                System.out.flush();
            }
        }
    }

    private static String tokensJson(List<EnglishOpenNlpAnalyzer.Token> tokens) {
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

    private static String nullable(String value) {
        return value == null ? "null" : "\"" + escape(value) + "\"";
    }

    private static String escape(String value) {
        if (value == null) return "unknown sidecar error";
        return value.replace("\\", "\\\\").replace("\"", "\\\"")
            .replace("\n", "\\n").replace("\r", "\\r").replace("\t", "\\t");
    }
}
