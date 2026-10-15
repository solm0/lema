package com.solmi.lema;

import static org.junit.Assert.assertTrue;

import android.content.Context;
import android.os.Bundle;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/** Device benchmark. The Gradshow build receives the dictionary through -PsudachiDictionaryArchive. */
@RunWith(AndroidJUnit4.class)
public class JapaneseNlpAnalyzerInstrumentedTest {
    private static final String DICTIONARY_ASSET = "models/sudachi-dictionary-core.zip";
    private static final String OUTPUT_PATH = "analyzer-quality/ja-android-performance.json";
    private static final String BENCHMARK_TEXT = "好奇心旺盛な犬たちは庭を走り、飼い主はその姿を注意深く見守った。";

    @Test
    public void loadsModelsAndAnalyzesOnAndroidRuntime() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        Bundle arguments = InstrumentationRegistry.getArguments();
        int iterations = Integer.parseInt(arguments.getString("iterations", "100"));
        assertTrue(iterations > 0);
        File dictionaryDirectory = extractDictionary(context);

        Runtime runtime = Runtime.getRuntime();
        runtime.gc();
        long before = runtime.totalMemory() - runtime.freeMemory();
        long started = System.nanoTime();
        JapaneseNlpAnalyzer analyzer = new JapaneseNlpAnalyzer(dictionaryDirectory, null);
        double loadMillis = (System.nanoTime() - started) / 1_000_000.0;
        runtime.gc();
        long retained = Math.max(0, runtime.totalMemory() - runtime.freeMemory() - before);

        long analysisStarted = System.nanoTime();
        List<JapaneseNlpAnalyzer.Token> tokens = null;
        for (int index = 0; index < iterations; index += 1) tokens = analyzer.analyze(BENCHMARK_TEXT);
        double analysisMillis = (System.nanoTime() - analysisStarted) / 1_000_000.0;
        assertTrue(tokens != null && !tokens.isEmpty());

        JSONObject report = new JSONObject();
        report.put("language", "ja");
        report.put("sentence", BENCHMARK_TEXT);
        report.put("token_count", tokens.size());
        report.put("iterations", iterations);
        report.put("cold_model_load_ms", loadMillis);
        report.put("retained_heap_bytes", retained);
        report.put("retained_heap_mb", retained / (1024.0 * 1024.0));
        report.put("analysis_total_ms", analysisMillis);
        report.put("analysis_average_ms", analysisMillis / iterations);
        writeReport(context, report);
    }

    static File extractDictionary(Context context) throws Exception {
        File directory = new File(context.getCacheDir(), "analyzer-quality/sudachi");
        if (JapaneseNlpAnalyzer.modelsAvailable(directory)) return directory;
        if (!directory.isDirectory() && !directory.mkdirs()) throw new IllegalStateException("Cannot create cache directory");
        File dictionary = new File(directory, JapaneseNlpAnalyzer.SYSTEM_DICTIONARY);
        boolean found = false;
        try (InputStream input = new BufferedInputStream(context.getAssets().open(DICTIONARY_ASSET));
             ZipInputStream zip = new ZipInputStream(input)) {
            ZipEntry entry;
            while ((entry = zip.getNextEntry()) != null) {
                if (!entry.isDirectory() && JapaneseNlpAnalyzer.SYSTEM_DICTIONARY.equals(new File(entry.getName()).getName())) {
                    try (FileOutputStream output = new FileOutputStream(dictionary)) {
                        byte[] buffer = new byte[64 * 1024];
                        int read;
                        while ((read = zip.read(buffer)) != -1) output.write(buffer, 0, read);
                    }
                    found = true;
                    break;
                }
            }
        }
        assertTrue("Sudachi core dictionary is missing from the Gradshow asset", found);
        assertTrue(JapaneseNlpAnalyzer.modelsAvailable(directory));
        return directory;
    }

    private static void writeReport(Context context, JSONObject report) throws Exception {
        File output = new File(context.getCacheDir(), OUTPUT_PATH);
        File parent = output.getParentFile();
        assertTrue(parent != null && (parent.isDirectory() || parent.mkdirs()));
        try (Writer writer = new OutputStreamWriter(new FileOutputStream(output), StandardCharsets.UTF_8)) {
            writer.write(report.toString());
            writer.write('\n');
        }
    }
}
