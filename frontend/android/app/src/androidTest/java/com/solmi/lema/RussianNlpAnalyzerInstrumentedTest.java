package com.solmi.lema;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import android.content.Context;
import android.os.Bundle;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.util.List;

@RunWith(AndroidJUnit4.class)
public class RussianNlpAnalyzerInstrumentedTest {
    private static final String OUTPUT_PATH = "analyzer-quality/ru-android-performance.json";
    private static final String BENCHMARK_TEXT =
        "Любознательные собаки бежали по саду, пока их хозяин внимательно наблюдал за ними.";

    @Test
    public void loadsModelsAndAnalyzesOnAndroidRuntime() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        Bundle arguments = InstrumentationRegistry.getArguments();
        int iterations = parsePositiveInteger(arguments.getString("iterations", "100"), "iterations");
        ClassLoader classLoader = context.getClassLoader();
        assertTrue(RussianNlpAnalyzer.modelsAvailable(classLoader));

        Runtime runtime = Runtime.getRuntime();
        forceGc(runtime);
        long heapBefore = runtime.totalMemory() - runtime.freeMemory();
        long loadStarted = System.nanoTime();
        RussianNlpAnalyzer analyzer = new RussianNlpAnalyzer(classLoader);
        double loadMillis = (System.nanoTime() - loadStarted) / 1_000_000.0;
        forceGc(runtime);
        long retainedHeapBytes = Math.max(
            0,
            runtime.totalMemory() - runtime.freeMemory() - heapBefore
        );

        long analysisStarted = System.nanoTime();
        List<RussianNlpAnalyzer.Token> tokens = null;
        for (int index = 0; index < iterations; index += 1) {
            tokens = analyzer.analyze(BENCHMARK_TEXT);
        }
        double analysisMillis = (System.nanoTime() - analysisStarted) / 1_000_000.0;

        assertTrue(tokens != null && !tokens.isEmpty());
        assertEquals(12, tokens.size());
        assertEquals("NOUN", tokens.get(1).pos);
        JSONObject report = new JSONObject();
        report.put("language", "ru");
        report.put("sentence", BENCHMARK_TEXT);
        report.put("token_count", tokens.size());
        report.put("iterations", iterations);
        report.put("cold_model_load_ms", loadMillis);
        report.put("retained_heap_bytes", retainedHeapBytes);
        report.put("retained_heap_mb", retainedHeapBytes / (1024.0 * 1024.0));
        report.put("analysis_total_ms", analysisMillis);
        report.put("analysis_average_ms", analysisMillis / iterations);
        writeReport(context, report);
        System.out.printf(
            "LEMA_NLP_DEVICE language=ru load_ms=%.2f retained_heap_mb=%.2f "
                + "analyze_total_ms=%.2f avg_ms=%.2f tokens=%d%n",
            loadMillis,
            retainedHeapBytes / (1024.0 * 1024.0),
            analysisMillis,
            analysisMillis / (double) iterations,
            tokens.size()
        );
    }

    private static int parsePositiveInteger(String value, String name) {
        int parsed;
        try {
            parsed = Integer.parseInt(value);
        } catch (NumberFormatException error) {
            throw new IllegalArgumentException(name + " must be an integer", error);
        }
        if (parsed <= 0) throw new IllegalArgumentException(name + " must be positive");
        return parsed;
    }

    private static void forceGc(Runtime runtime) throws InterruptedException {
        runtime.gc();
        runtime.runFinalization();
        Thread.sleep(100);
        runtime.gc();
        Thread.sleep(100);
    }

    private static void writeReport(Context context, JSONObject report) throws Exception {
        File output = new File(context.getCacheDir(), OUTPUT_PATH);
        File parent = output.getParentFile();
        assertTrue(parent != null && (parent.isDirectory() || parent.mkdirs()));
        try (Writer writer = new OutputStreamWriter(
            new FileOutputStream(output),
            StandardCharsets.UTF_8
        )) {
            writer.write(report.toString());
            writer.write('\n');
        }
    }
}
