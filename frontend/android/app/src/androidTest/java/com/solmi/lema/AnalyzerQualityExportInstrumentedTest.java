package com.solmi.lema;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.os.Bundle;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

import java.io.BufferedWriter;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStreamWriter;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

@RunWith(AndroidJUnit4.class)
public class AnalyzerQualityExportInstrumentedTest {
    private static final String ENGLISH_LANGUAGE = "en";
    private static final String GERMAN_LANGUAGE = "de";
    private static final String ENGLISH_PACK_ASSET = "packs/en-v1.1.2-lemma.zip";
    private static final String GERMAN_PACK_ASSET = "packs/de-v1.1.2-lemma.zip";
    private static final String ENGLISH_OUTPUT_PATH = "analyzer-quality/en-android.jsonl";
    private static final String GERMAN_OUTPUT_PATH = "analyzer-quality/de-android.jsonl";

    @Test
    public void exportsEnglishCandidateJsonl() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        Bundle arguments = InstrumentationRegistry.getArguments();
        String requestedLanguage = arguments.getString("language", ENGLISH_LANGUAGE);
        int requestedSampleSize = parseSampleSize(arguments.getString("sampleSize", "1000"));

        assertEquals("This export runs the English analyzer", ENGLISH_LANGUAGE, requestedLanguage);
        assertTrue("The export requires the Gradshow language-pack asset", BuildConfig.GRADSHOW_MODE);

        File databaseFile = extractPackDatabase(context, ENGLISH_PACK_ASSET, "english");
        File outputFile = new File(context.getCacheDir(), ENGLISH_OUTPUT_PATH);
        File parent = outputFile.getParentFile();
        assertTrue(parent != null && (parent.isDirectory() || parent.mkdirs()));

        SQLiteDatabase database = null;
        try {
            database = SQLiteDatabase.openDatabase(
                databaseFile.getAbsolutePath(),
                null,
                SQLiteDatabase.OPEN_READONLY
            );
            List<Long> lineIds = evenlySpacedLineIds(database, requestedSampleSize);
            EnglishNlpAnalyzer analyzer = new EnglishNlpAnalyzer(context.getClassLoader());

            try (BufferedWriter writer = new BufferedWriter(new OutputStreamWriter(
                new FileOutputStream(outputFile),
                StandardCharsets.UTF_8
            ))) {
                for (long lineId : lineIds) {
                    JSONObject reference = readLine(database, lineId);
                    String input = reconstructInput(reference.getJSONArray("tokens"));
                    List<EnglishNlpAnalyzer.Token> analyzed = analyzer.analyze(input);
                    writer.write(candidateRecord(lineId, analyzed).toString());
                    writer.newLine();
                }
            }

            assertEquals(lineIds.size(), countLines(outputFile));
            System.out.printf(
                "LEMA_QUALITY_EXPORT language=%s samples=%d path=%s%n",
                ENGLISH_LANGUAGE,
                lineIds.size(),
                outputFile.getAbsolutePath()
            );
        } finally {
            if (database != null) database.close();
            databaseFile.delete();
        }
    }

    @Test
    public void exportsGermanCandidateJsonl() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        Bundle arguments = InstrumentationRegistry.getArguments();
        String requestedLanguage = arguments.getString("language", GERMAN_LANGUAGE);
        int requestedSampleSize = parseSampleSize(arguments.getString("sampleSize", "1000"));

        assertEquals("This export runs the German analyzer", GERMAN_LANGUAGE, requestedLanguage);
        assertTrue("The export requires the Gradshow language-pack asset", BuildConfig.GRADSHOW_MODE);

        File databaseFile = extractPackDatabase(context, GERMAN_PACK_ASSET, "german");
        File outputFile = new File(context.getCacheDir(), GERMAN_OUTPUT_PATH);
        File parent = outputFile.getParentFile();
        assertTrue(parent != null && (parent.isDirectory() || parent.mkdirs()));

        SQLiteDatabase database = null;
        try {
            database = SQLiteDatabase.openDatabase(
                databaseFile.getAbsolutePath(),
                null,
                SQLiteDatabase.OPEN_READONLY
            );
            List<Long> lineIds = evenlySpacedLineIds(database, requestedSampleSize);
            GermanNlpAnalyzer analyzer = new GermanNlpAnalyzer(
                context.getClassLoader(),
                new SqliteLemmaKeyLookup(database)
            );

            try (BufferedWriter writer = new BufferedWriter(new OutputStreamWriter(
                new FileOutputStream(outputFile),
                StandardCharsets.UTF_8
            ))) {
                for (long lineId : lineIds) {
                    JSONObject reference = readLine(database, lineId);
                    String input = reconstructInput(reference.getJSONArray("tokens"));
                    List<GermanNlpAnalyzer.Token> analyzed = analyzer.analyze(input);
                    writer.write(germanCandidateRecord(lineId, analyzed).toString());
                    writer.newLine();
                }
            }

            assertEquals(lineIds.size(), countLines(outputFile));
            System.out.printf(
                "LEMA_QUALITY_EXPORT language=%s samples=%d path=%s%n",
                GERMAN_LANGUAGE,
                lineIds.size(),
                outputFile.getAbsolutePath()
            );
        } finally {
            if (database != null) database.close();
            databaseFile.delete();
        }
    }

    private static int parseSampleSize(String value) {
        int parsed;
        try {
            parsed = Integer.parseInt(value);
        } catch (NumberFormatException error) {
            throw new IllegalArgumentException("sampleSize must be an integer", error);
        }
        if (parsed <= 0) throw new IllegalArgumentException("sampleSize must be positive");
        return parsed;
    }

    private static File extractPackDatabase(
        Context context,
        String packAsset,
        String filePrefix
    ) throws Exception {
        File databaseFile = File.createTempFile(
            filePrefix + "-quality-reference-",
            ".db",
            context.getCacheDir()
        );
        boolean found = false;
        try (
            InputStream input = context.getAssets().open(packAsset);
            ZipInputStream zip = new ZipInputStream(input)
        ) {
            ZipEntry entry;
            while ((entry = zip.getNextEntry()) != null) {
                if (entry.isDirectory() || !"lemma_pack.db".equals(new File(entry.getName()).getName())) {
                    continue;
                }
                try (FileOutputStream output = new FileOutputStream(databaseFile)) {
                    byte[] buffer = new byte[64 * 1024];
                    int read;
                    while ((read = zip.read(buffer)) != -1) output.write(buffer, 0, read);
                }
                found = true;
                break;
            }
        }
        assertTrue("lemma_pack.db is missing from the Gradshow pack", found);
        return databaseFile;
    }

    private static List<Long> evenlySpacedLineIds(SQLiteDatabase database, int requestedSize) {
        try (Cursor cursor = database.rawQuery("SELECT line_id FROM lines ORDER BY line_id", null)) {
            int total = cursor.getCount();
            int sampleSize = Math.min(requestedSize, total);
            Set<Integer> positions = new LinkedHashSet<>();

            if (sampleSize == 1) {
                positions.add(0);
            } else {
                for (int index = 0; index < sampleSize; index += 1) {
                    positions.add((int) Math.round(index * (total - 1.0) / (sampleSize - 1.0)));
                }
            }

            List<Long> lineIds = new ArrayList<>(positions.size());
            for (int position : positions) {
                assertTrue(cursor.moveToPosition(position));
                lineIds.add(cursor.getLong(0));
            }
            return lineIds;
        }
    }

    private static JSONObject readLine(SQLiteDatabase database, long lineId) throws Exception {
        try (Cursor cursor = database.rawQuery(
            "SELECT payload FROM lines WHERE line_id = ? LIMIT 1",
            new String[] { Long.toString(lineId) }
        )) {
            assertTrue("Missing reference line " + lineId, cursor.moveToFirst());
            return new JSONObject(cursor.getString(0));
        }
    }

    private static String reconstructInput(JSONArray tokens) {
        StringBuilder text = new StringBuilder();
        for (int index = 0; index < tokens.length(); index += 1) {
            if (index > 0) text.append(' ');
            text.append(tokens.optJSONObject(index).optString("surface", ""));
        }
        return text.toString();
    }

    private static JSONObject candidateRecord(
        long lineId,
        List<EnglishNlpAnalyzer.Token> tokens
    ) throws Exception {
        JSONArray outputTokens = new JSONArray();
        for (EnglishNlpAnalyzer.Token token : tokens) {
            JSONObject outputToken = new JSONObject();
            outputToken.put("surface", token.surface);
            if (token.lemma != null) outputToken.put("lemma", token.lemma);
            if (token.pos != null) outputToken.put("pos", token.pos);
            outputTokens.put(outputToken);
        }
        JSONObject output = new JSONObject();
        output.put("id", lineId);
        output.put("tokens", outputTokens);
        return output;
    }

    private static JSONObject germanCandidateRecord(
        long lineId,
        List<GermanNlpAnalyzer.Token> tokens
    ) throws Exception {
        JSONArray outputTokens = new JSONArray();
        for (GermanNlpAnalyzer.Token token : tokens) {
            JSONObject outputToken = new JSONObject();
            outputToken.put("surface", token.surface);
            if (token.lemma != null) outputToken.put("lemma", token.lemma);
            if (token.pos != null) outputToken.put("pos", token.pos);
            outputTokens.put(outputToken);
        }
        JSONObject output = new JSONObject();
        output.put("id", lineId);
        output.put("tokens", outputTokens);
        return output;
    }

    private static int countLines(File file) throws Exception {
        int count = 0;
        try (InputStream input = new java.io.FileInputStream(file)) {
            byte[] buffer = new byte[64 * 1024];
            int read;
            while ((read = input.read(buffer)) != -1) {
                for (int index = 0; index < read; index += 1) {
                    if (buffer[index] == '\n') count += 1;
                }
            }
        }
        return count;
    }
}
