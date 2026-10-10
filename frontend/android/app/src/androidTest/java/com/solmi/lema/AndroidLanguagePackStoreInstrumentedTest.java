package com.solmi.lema;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import android.content.Context;
import android.os.Bundle;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import com.getcapacitor.JSArray;

import org.junit.Assume;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.json.JSONObject;

import java.io.File;

@RunWith(AndroidJUnit4.class)
public class AndroidLanguagePackStoreInstrumentedTest {
    private static final String GERMAN_PACK_URL =
        "https://huggingface.co/datasets/solm0/nautilus-releases/resolve/main/"
            + "language-packs/de/1.1.2/de-v1.1.2-lemma.zip";
    private static final String ENGLISH_PACK_URL =
        "https://huggingface.co/datasets/solm0/nautilus-releases/resolve/main/"
            + "language-packs/en/1.1.2/en-v1.1.2-lemma.zip";
    private static final String RUSSIAN_PACK_URL =
        "https://huggingface.co/datasets/solm0/nautilus-releases/resolve/main/"
            + "language-packs/ru/1.1.2/ru-v1.1.2-lemma.zip";
    private static final String KOREAN_PACK_URL =
        "https://huggingface.co/datasets/solm0/nautilus-releases/resolve/main/"
            + "language-packs/ko/1.1.2/ko-v1.1.2-lemma.zip";

    @Test
    public void downloadsReadsAndDeletesEnglishPackWhenExplicitlyRequested() throws Exception {
        Bundle arguments = InstrumentationRegistry.getArguments();
        Assume.assumeTrue("true".equals(arguments.getString("runLanguagePackDownloadTest")));

        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        AndroidLanguagePackStore store = new AndroidLanguagePackStore(context);
        store.uninstall("en", "1.1.2");

        store.install(
            "en",
            "1.1.2",
            "en-v1.1.2-lemma.zip",
            ENGLISH_PACK_URL,
            (progress, status, detail, modelPercent) -> { }
        );

        File installed = store.latestReadyDirectory("en");
        assertNotNull(installed);
        assertEquals("1.1.2", installed.getName());
        assertEquals(true, new File(installed, "lemma_pack.db").isFile());
        assertEquals(true, EnglishNlpAnalyzer.modelsAvailable(new File(installed, "models")));

        JSArray packs = store.installedPacks();
        assertEquals(1, packs.length());
        JSONObject state = packs.getJSONObject(0);
        assertEquals(true, state.getBoolean("installed"));

        store.uninstall("en", "1.1.2");
        assertNull(store.latestReadyDirectory("en"));
    }

    @Test
    public void downloadsReadsAndDeletesGermanPackWhenExplicitlyRequested() throws Exception {
        Bundle arguments = InstrumentationRegistry.getArguments();
        Assume.assumeTrue("true".equals(arguments.getString("runGermanLanguagePackDownloadTest")));

        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        AndroidLanguagePackStore store = new AndroidLanguagePackStore(context);
        store.uninstall("de", "1.1.2");

        store.install(
            "de",
            "1.1.2",
            "de-v1.1.2-lemma.zip",
            GERMAN_PACK_URL,
            (progress, status, detail, modelPercent) -> { }
        );

        File installed = store.latestReadyDirectory("de");
        assertNotNull(installed);
        assertEquals("1.1.2", installed.getName());
        assertTrue(new File(installed, "lemma_pack.db").isFile());
        assertTrue(GermanNlpAnalyzer.modelsAvailable(new File(installed, "models")));

        JSArray packs = store.installedPacks();
        JSONObject germanState = null;
        for (int index = 0; index < packs.length(); index += 1) {
            JSONObject state = packs.getJSONObject(index);
            if ("de".equals(state.optString("lang"))
                && "1.1.2".equals(state.optString("version"))) {
                germanState = state;
                break;
            }
        }
        assertNotNull(germanState);
        assertTrue(germanState.getBoolean("installed"));

        store.uninstall("de", "1.1.2");
        assertNull(store.latestReadyDirectory("de"));
    }

    @Test
    public void downloadsReadsAndDeletesRussianPackWhenExplicitlyRequested() throws Exception {
        Bundle arguments = InstrumentationRegistry.getArguments();
        Assume.assumeTrue("true".equals(arguments.getString("runRussianLanguagePackDownloadTest")));

        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        AndroidLanguagePackStore store = new AndroidLanguagePackStore(context);
        store.uninstall("ru", "1.1.2");

        store.install(
            "ru",
            "1.1.2",
            "ru-v1.1.2-lemma.zip",
            RUSSIAN_PACK_URL,
            (progress, status, detail, modelPercent) -> { }
        );

        File installed = store.latestReadyDirectory("ru");
        assertNotNull(installed);
        assertEquals("1.1.2", installed.getName());
        assertTrue(new File(installed, "lemma_pack.db").isFile());
        assertTrue(RussianNlpAnalyzer.modelsAvailable(new File(installed, "models")));

        JSArray packs = store.installedPacks();
        JSONObject russianState = null;
        for (int index = 0; index < packs.length(); index += 1) {
            JSONObject state = packs.getJSONObject(index);
            if ("ru".equals(state.optString("lang"))
                && "1.1.2".equals(state.optString("version"))) {
                russianState = state;
                break;
            }
        }
        assertNotNull(russianState);
        assertTrue(russianState.getBoolean("installed"));

        store.uninstall("ru", "1.1.2");
        assertNull(store.latestReadyDirectory("ru"));
    }

    @Test
    public void downloadsReadsAndDeletesKoreanPackWhenExplicitlyRequested() throws Exception {
        Bundle arguments = InstrumentationRegistry.getArguments();
        Assume.assumeTrue("true".equals(arguments.getString("runKoreanLanguagePackDownloadTest")));

        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        AndroidLanguagePackStore store = new AndroidLanguagePackStore(context);
        store.uninstall("ko", "1.1.2");

        store.install(
            "ko",
            "1.1.2",
            "ko-v1.1.2-lemma.zip",
            KOREAN_PACK_URL,
            (progress, status, detail, modelPercent) -> { }
        );

        File installed = store.latestReadyDirectory("ko");
        assertNotNull(installed);
        assertEquals("1.1.2", installed.getName());
        assertTrue(new File(installed, "lemma_pack.db").isFile());
        assertTrue(KoreanNlpAnalyzer.modelsAvailable(
            new File(new File(installed, "models"), KoreanNlpAnalyzer.MODEL_DIRECTORY)
        ));

        JSArray packs = store.installedPacks();
        JSONObject koreanState = null;
        for (int index = 0; index < packs.length(); index += 1) {
            JSONObject state = packs.getJSONObject(index);
            if ("ko".equals(state.optString("lang"))
                && "1.1.2".equals(state.optString("version"))) {
                koreanState = state;
                break;
            }
        }
        assertNotNull(koreanState);
        assertTrue(koreanState.getBoolean("installed"));

        store.uninstall("ko", "1.1.2");
        assertNull(store.latestReadyDirectory("ko"));
    }
}
