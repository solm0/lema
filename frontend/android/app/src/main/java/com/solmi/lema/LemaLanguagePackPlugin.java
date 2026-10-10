package com.solmi.lema;

import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
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
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

@CapacitorPlugin(name = "LemaLanguagePack")
public class LemaLanguagePackPlugin extends Plugin {
    private static final String GRADSHOW_PACK_VERSION = "1.1.2";
    private static final int MAX_ANALYZE_BLOCKS = 100;
    private static final int MAX_ANALYZE_CHARS = 50_000;
    private static final int MAX_LOOKUP_ITEMS = 100;
    private static final int EXAMPLE_LIMIT = 12;
    private static final double SIMILARITY_THRESHOLD = 0.85;
    private static final long KOREAN_ANALYZER_IDLE_SECONDS = 30;
    private static final Set<String> IGNORED_POS =
        new HashSet<>(Arrays.asList("PUNCT", "SPACE", "SYM"));

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final ScheduledExecutorService analyzerCleanupExecutor =
        Executors.newSingleThreadScheduledExecutor();
    private final Map<String, JSObject> installProgress = new ConcurrentHashMap<>();
    private AndroidLanguagePackStore packStore;
    private final Map<String, SQLiteDatabase> databases = new HashMap<>();
    private final Map<String, File> openPackDirectories = new HashMap<>();
    private EnglishNlpAnalyzer englishAnalyzer;
    private File openEnglishAnalyzerDirectory;
    private GermanNlpAnalyzer germanAnalyzer;
    private File openGermanAnalyzerDirectory;
    private KoreanNlpAnalyzer koreanAnalyzer;
    private File openKoreanAnalyzerDirectory;
    private long koreanAnalyzerGeneration;
    private RussianNlpAnalyzer russianAnalyzer;
    private File openRussianAnalyzerDirectory;

    @PluginMethod
    public void getSupportedLanguages(PluginCall call) {
        JSObject response = new JSObject();
        response.put("languages", packStore().supportedLanguages());
        call.resolve(response);
    }

    @PluginMethod
    public void getInstalledPacks(PluginCall call) {
        JSObject response = new JSObject();
        response.put("packs", packStore().installedPacks());
        call.resolve(response);
    }

    @PluginMethod
    public void install(PluginCall call) {
        String language = call.getString("lang", "");
        String version = call.getString("version", "");
        String filename = call.getString("filename", "");
        String downloadUrl = call.getString("download_url", "");
        String taskId = UUID.randomUUID().toString();
        setInstallProgress(taskId, 0.0, "downloading_pack", null, null);

        executor.execute(() -> {
            try {
                closeOpenPack();
                packStore().install(
                    language,
                    version,
                    filename,
                    downloadUrl,
                    (progress, status, detail, modelPercent) ->
                        setInstallProgress(taskId, progress, status, detail, modelPercent)
                );
            } catch (Exception error) {
                JSObject state = new JSObject();
                state.put("progress", 0);
                state.put("status", "error");
                state.put("error", error.getMessage() != null ? error.getMessage() : "Installation failed");
                installProgress.put(taskId, state);
            }
        });

        JSObject response = new JSObject();
        response.put("task_id", taskId);
        call.resolve(response);
    }

    @PluginMethod
    public void getInstallProgress(PluginCall call) {
        String taskId = call.getString("task_id", "");
        JSObject state = installProgress.get(taskId);
        if (state == null) {
            state = new JSObject();
            state.put("progress", 0);
            state.put("status", "unknown");
        }
        call.resolve(state);
    }

    @PluginMethod
    public void uninstall(PluginCall call) {
        String language = call.getString("lang", "");
        String version = call.getString("version", "");
        executor.execute(() -> {
            try {
                closeOpenPack();
                packStore().uninstall(language, version);
                call.resolve();
            } catch (Exception error) {
                call.reject(
                    error.getMessage() != null ? error.getMessage() : "Could not uninstall language pack",
                    error
                );
            }
        });
    }

    @PluginMethod
    public void getCapabilities(PluginCall call) {
        JSArray analysisLanguages = new JSArray();
        JSArray lookupLanguages = new JSArray();

        for (String language : packStore().supportedLanguageCodes()) {
            File installed = packStore().latestReadyDirectory(language);
            boolean gradshowReady = BuildConfig.GRADSHOW_MODE
                && bundledModelsAvailable(language)
                && hasPackSource(language);
            if (installed != null || gradshowReady) {
                analysisLanguages.put(language);
                lookupLanguages.put(language);
            }
        }

        JSObject response = new JSObject();
        response.put("analysisLanguages", analysisLanguages);
        response.put("lookupLanguages", lookupLanguages);
        call.resolve(response);
    }

    private AndroidLanguagePackStore packStore() {
        if (packStore == null) packStore = new AndroidLanguagePackStore(getContext());
        return packStore;
    }

    private void setInstallProgress(
        String taskId,
        double progress,
        String status,
        String detail,
        Integer modelPercent
    ) {
        JSObject state = new JSObject();
        state.put("progress", Math.max(0.0, Math.min(1.0, progress)));
        state.put("status", status);
        if (detail != null) {
            state.put("detail", detail);
            if ("installing_model".equals(status)) state.put("model_name", detail);
        }
        if (modelPercent != null) state.put("model_percent", modelPercent);
        installProgress.put(taskId, state);
    }

    @PluginMethod
    public void analyze(PluginCall call) {
        JSArray blocks = call.getArray("blocks", new JSArray());
        String language = call.getString("language", "en");

        executor.execute(() -> {
            try {
                if (!packStore().supportedLanguageCodes().contains(language)) {
                    throw new IllegalArgumentException("Unsupported local analysis language: " + language);
                }
                if (blocks.length() > MAX_ANALYZE_BLOCKS) {
                    throw new IllegalArgumentException("Analysis input exceeds " + MAX_ANALYZE_BLOCKS + " blocks");
                }

                int totalChars = 0;
                for (int index = 0; index < blocks.length(); index += 1) {
                    JSONObject block = blocks.optJSONObject(index);
                    if (block != null) totalChars += block.optString("text", "").length();
                }
                if (totalChars > MAX_ANALYZE_CHARS) {
                    throw new IllegalArgumentException("Analysis input exceeds " + MAX_ANALYZE_CHARS + " characters");
                }

                EnglishNlpAnalyzer selectedEnglishAnalyzer = "en".equals(language)
                    ? openEnglishAnalyzer()
                    : null;
                GermanNlpAnalyzer selectedGermanAnalyzer = "de".equals(language)
                    ? openGermanAnalyzer()
                    : null;
                KoreanNlpAnalyzer selectedKoreanAnalyzer = "ko".equals(language)
                    ? openKoreanAnalyzer()
                    : null;
                RussianNlpAnalyzer selectedRussianAnalyzer = "ru".equals(language)
                    ? openRussianAnalyzer()
                    : null;
                JSArray analyzedBlocks = new JSArray();

                for (int index = 0; index < blocks.length(); index += 1) {
                    JSONObject block = blocks.optJSONObject(index);
                    String originalText = block != null ? block.optString("text", "") : "";
                    String text = originalText.trim();
                    JSArray tokens = new JSArray();

                    if (!text.isEmpty() && selectedEnglishAnalyzer != null) {
                        for (EnglishNlpAnalyzer.Token token : selectedEnglishAnalyzer.analyze(text)) {
                            JSObject outputToken = new JSObject();
                            outputToken.put("surface", token.surface);
                            outputToken.put("lemma", token.lemma != null ? token.lemma : JSONObject.NULL);
                            outputToken.put("pos", token.pos != null ? token.pos : JSONObject.NULL);
                            tokens.put(outputToken);
                        }
                    } else if (!text.isEmpty() && selectedGermanAnalyzer != null) {
                        for (GermanNlpAnalyzer.Token token : selectedGermanAnalyzer.analyze(text)) {
                            JSObject outputToken = new JSObject();
                            outputToken.put("surface", token.surface);
                            outputToken.put("lemma", token.lemma != null ? token.lemma : JSONObject.NULL);
                            outputToken.put("pos", token.pos != null ? token.pos : JSONObject.NULL);
                            tokens.put(outputToken);
                        }
                    } else if (!text.isEmpty() && selectedKoreanAnalyzer != null) {
                        for (KoreanNlpAnalyzer.Token token : selectedKoreanAnalyzer.analyze(text)) {
                            JSObject outputToken = new JSObject();
                            outputToken.put("surface", token.surface);
                            outputToken.put("lemma", token.lemma != null ? token.lemma : JSONObject.NULL);
                            outputToken.put("pos", token.pos != null ? token.pos : JSONObject.NULL);
                            JSArray morphs = new JSArray();
                            for (KoreanNlpAnalyzer.Morph morph : token.morphs) {
                                JSObject outputMorph = new JSObject();
                                outputMorph.put("surface", morph.surface);
                                outputMorph.put(
                                    "lemma",
                                    morph.lemma != null ? morph.lemma : JSONObject.NULL
                                );
                                outputMorph.put("pos", morph.pos != null ? morph.pos : JSONObject.NULL);
                                morphs.put(outputMorph);
                            }
                            outputToken.put("morphs", morphs);
                            tokens.put(outputToken);
                        }
                    } else if (!text.isEmpty() && selectedRussianAnalyzer != null) {
                        for (RussianNlpAnalyzer.Token token : selectedRussianAnalyzer.analyze(text)) {
                            JSObject outputToken = new JSObject();
                            outputToken.put("surface", token.surface);
                            outputToken.put("lemma", token.lemma != null ? token.lemma : JSONObject.NULL);
                            outputToken.put("pos", token.pos != null ? token.pos : JSONObject.NULL);
                            tokens.put(outputToken);
                        }
                    }

                    JSObject outputBlock = new JSObject();
                    outputBlock.put("text", originalText);
                    outputBlock.put("tokens", tokens);
                    analyzedBlocks.put(outputBlock);
                }

                JSObject response = new JSObject();
                response.put("blocks", analyzedBlocks);
                call.resolve(response);
            } catch (Exception error) {
                call.reject(
                    error.getMessage() != null ? error.getMessage() : "Could not analyze text locally",
                    error
                );
            } finally {
                if ("ko".equals(language)) scheduleKoreanAnalyzerClose();
            }
        });
    }

    @PluginMethod
    public void lookup(PluginCall call) {
        String lemma = call.getString("lemma", "").trim();
        String pos = call.getString("pos", "").trim();
        String language = call.getString("language", "en");
        JSObject profile = call.getObject("profile", new JSObject());

        executor.execute(() -> {
            try {
                if (!packStore().supportedLanguageCodes().contains(language)) {
                    throw new IllegalArgumentException("Unsupported local lookup language: " + language);
                }
                JSONObject result = lookupEntry(openDatabase(language), lemma, pos, language, profile);
                call.resolve(result != null
                    ? JSObject.fromJSONObject(result)
                    : JSObject.fromJSONObject(missingLookupResult(lemma, pos, language, profile))
                );
            } catch (Exception error) {
                call.reject(
                    error.getMessage() != null ? error.getMessage() : "Could not query local language pack",
                    error
                );
            }
        });
    }

    @PluginMethod
    public void lookupBatch(PluginCall call) {
        JSArray items = call.getArray("items", new JSArray());
        String language = call.getString("language", "en");
        JSObject profile = call.getObject("profile", new JSObject());

        executor.execute(() -> {
            try {
                if (!packStore().supportedLanguageCodes().contains(language)) {
                    JSObject response = new JSObject();
                    response.put("items", new JSObject());
                    call.resolve(response);
                    return;
                }

                SQLiteDatabase db = openDatabase(language);
                JSObject output = new JSObject();
                int count = Math.min(items.length(), MAX_LOOKUP_ITEMS);

                for (int index = 0; index < count; index += 1) {
                    JSONObject item = items.optJSONObject(index);
                    if (item == null) continue;
                    String lemma = item.optString("lemma", "").trim();
                    String pos = item.optString("pos", "").trim();
                    if (lemma.isEmpty() || pos.isEmpty()) continue;

                    JSONObject result = lookupEntry(db, lemma, pos, language, profile);
                    if (result != null) output.put(lemma + "_" + pos, result);
                }

                JSObject response = new JSObject();
                response.put("items", output);
                call.resolve(response);
            } catch (Exception error) {
                call.reject(
                    error.getMessage() != null ? error.getMessage() : "Could not query bundled language pack",
                    error
                );
            }
        });
    }

    private synchronized SQLiteDatabase openDatabase(String language) throws Exception {
        File packDirectory = getReadablePackDirectory(language);
        SQLiteDatabase existing = databases.get(language);
        File existingDirectory = openPackDirectories.get(language);
        if (existing != null
            && existing.isOpen()
            && packDirectory.equals(existingDirectory)) {
            return existing;
        }
        if (existing != null) existing.close();
        File packDatabase = new File(packDirectory, "lemma_pack.db");
        if (!packDatabase.exists() || packDatabase.length() == 0) {
            if (!BuildConfig.GRADSHOW_MODE) {
                throw new IllegalStateException(language + " language pack is not installed");
            }
            extractPack(language, packDirectory, packDatabase);
        }
        SQLiteDatabase database = SQLiteDatabase.openDatabase(
            packDatabase.getAbsolutePath(),
            null,
            SQLiteDatabase.OPEN_READONLY
        );
        databases.put(language, database);
        openPackDirectories.put(language, packDirectory);
        return database;
    }

    private void extractPack(
        String language,
        File packDirectory,
        File packDatabase
    ) throws Exception {
        if (!packDirectory.exists() && !packDirectory.mkdirs()) {
            throw new IllegalStateException("Could not create language pack directory");
        }

        File temporary = new File(packDirectory, "lemma_pack.db.extracting");
        if (temporary.exists() && !temporary.delete()) {
            throw new IllegalStateException("Could not clear incomplete language pack");
        }

        boolean found = false;
        try (
            InputStream asset = getContext().getAssets().open(packAsset(language));
            ZipInputStream zip = new ZipInputStream(asset)
        ) {
            ZipEntry entry;
            while ((entry = zip.getNextEntry()) != null) {
                if (!entry.isDirectory() && "lemma_pack.db".equals(new File(entry.getName()).getName())) {
                    try (FileOutputStream output = new FileOutputStream(temporary)) {
                        byte[] buffer = new byte[64 * 1024];
                        int read;
                        while ((read = zip.read(buffer)) != -1) output.write(buffer, 0, read);
                        output.getFD().sync();
                    }
                    found = true;
                    break;
                }
                zip.closeEntry();
            }
        } catch (Exception error) {
            temporary.delete();
            throw error;
        }

        if (!found || temporary.length() == 0) {
            temporary.delete();
            throw new IllegalStateException("Bundled " + language + " language pack is invalid");
        }
        if (packDatabase.exists() && !packDatabase.delete()) {
            temporary.delete();
            throw new IllegalStateException("Could not replace bundled language pack");
        }
        if (!temporary.renameTo(packDatabase)) {
            temporary.delete();
            throw new IllegalStateException("Could not finish language pack extraction");
        }
    }

    private synchronized EnglishNlpAnalyzer openEnglishAnalyzer() throws Exception {
        File installedDirectory = packStore().latestReadyDirectory("en");
        if (installedDirectory != null) {
            File modelDirectory = new File(installedDirectory, "models");
            if (englishAnalyzer == null || !modelDirectory.equals(openEnglishAnalyzerDirectory)) {
                englishAnalyzer = new EnglishNlpAnalyzer(modelDirectory);
                openEnglishAnalyzerDirectory = modelDirectory;
            }
            return englishAnalyzer;
        }
        if (!BuildConfig.GRADSHOW_MODE) {
            throw new IllegalStateException("English language pack is not installed");
        }
        if (englishAnalyzer == null || openEnglishAnalyzerDirectory != null) {
            englishAnalyzer = new EnglishNlpAnalyzer(getClass().getClassLoader());
            openEnglishAnalyzerDirectory = null;
        }
        return englishAnalyzer;
    }

    private synchronized GermanNlpAnalyzer openGermanAnalyzer() throws Exception {
        File installedDirectory = packStore().latestReadyDirectory("de");
        if (installedDirectory != null) {
            File modelDirectory = new File(installedDirectory, "models");
            if (germanAnalyzer == null || !modelDirectory.equals(openGermanAnalyzerDirectory)) {
                germanAnalyzer = new GermanNlpAnalyzer(
                    modelDirectory,
                    new SqliteLemmaKeyLookup(openDatabase("de"))
                );
                openGermanAnalyzerDirectory = modelDirectory;
            }
            return germanAnalyzer;
        }
        if (!BuildConfig.GRADSHOW_MODE) {
            throw new IllegalStateException("German language pack is not installed");
        }
        if (germanAnalyzer == null || openGermanAnalyzerDirectory != null) {
            germanAnalyzer = new GermanNlpAnalyzer(
                getClass().getClassLoader(),
                new SqliteLemmaKeyLookup(openDatabase("de"))
            );
            openGermanAnalyzerDirectory = null;
        }
        return germanAnalyzer;
    }

    private synchronized RussianNlpAnalyzer openRussianAnalyzer() throws Exception {
        File installedDirectory = packStore().latestReadyDirectory("ru");
        if (installedDirectory != null) {
            File modelDirectory = new File(installedDirectory, "models");
            if (russianAnalyzer == null || !modelDirectory.equals(openRussianAnalyzerDirectory)) {
                russianAnalyzer = new RussianNlpAnalyzer(
                    modelDirectory,
                    new SqliteLemmaKeyLookup(openDatabase("ru"))
                );
                openRussianAnalyzerDirectory = modelDirectory;
            }
            return russianAnalyzer;
        }
        if (!BuildConfig.GRADSHOW_MODE) {
            throw new IllegalStateException("Russian language pack is not installed");
        }
        if (russianAnalyzer == null || openRussianAnalyzerDirectory != null) {
            russianAnalyzer = new RussianNlpAnalyzer(
                getClass().getClassLoader(),
                new SqliteLemmaKeyLookup(openDatabase("ru"))
            );
            openRussianAnalyzerDirectory = null;
        }
        return russianAnalyzer;
    }

    private synchronized KoreanNlpAnalyzer openKoreanAnalyzer() throws Exception {
        File installedDirectory = packStore().latestReadyDirectory("ko");
        if (installedDirectory == null) {
            throw new IllegalStateException("Korean language pack is not installed");
        }

        File modelDirectory = new File(
            new File(installedDirectory, "models"),
            KoreanNlpAnalyzer.MODEL_DIRECTORY
        );
        if (koreanAnalyzer == null || !modelDirectory.equals(openKoreanAnalyzerDirectory)) {
            if (koreanAnalyzer != null) koreanAnalyzer.close();
            koreanAnalyzer = new KoreanNlpAnalyzer(modelDirectory);
            openKoreanAnalyzerDirectory = modelDirectory;
        }
        return koreanAnalyzer;
    }

    private synchronized void scheduleKoreanAnalyzerClose() {
        long generation = ++koreanAnalyzerGeneration;
        analyzerCleanupExecutor.schedule(
            () -> executor.execute(() -> closeKoreanAnalyzerIfIdle(generation)),
            KOREAN_ANALYZER_IDLE_SECONDS,
            TimeUnit.SECONDS
        );
    }

    private synchronized void closeKoreanAnalyzerIfIdle(long generation) {
        if (generation != koreanAnalyzerGeneration) return;
        closeKoreanAnalyzer();
    }

    private synchronized void closeKoreanAnalyzer() {
        if (koreanAnalyzer != null) {
            try {
                koreanAnalyzer.close();
            } catch (Exception ignored) {
                // Closing is best effort; the analyzer will not be reused.
            }
        }
        koreanAnalyzer = null;
        openKoreanAnalyzerDirectory = null;
    }

    private File getGradshowPackDirectory(String language) {
        return new File(
            getContext().getFilesDir(),
            "gradshow-language-packs/" + language + "-v" + GRADSHOW_PACK_VERSION
        );
    }

    private File getReadablePackDirectory(String language) {
        File installed = packStore().latestReadyDirectory(language);
        if (installed != null) return installed;
        return getGradshowPackDirectory(language);
    }

    private boolean hasUsableDatabase(File directory) {
        File installedDatabase = new File(directory, "lemma_pack.db");
        return installedDatabase.isFile() && installedDatabase.length() > 0;
    }

    private boolean hasPackSource(String language) {
        if (packStore().latestReadyDirectory(language) != null) return true;
        if (hasUsableDatabase(getGradshowPackDirectory(language))) return true;

        try (InputStream ignored = getContext().getAssets().open(packAsset(language))) {
            return true;
        } catch (Exception ignored) {
            return false;
        }
    }

    private boolean bundledModelsAvailable(String language) {
        if ("de".equals(language)) {
            return GermanNlpAnalyzer.modelsAvailable(getClass().getClassLoader());
        }
        if ("en".equals(language)) {
            return EnglishNlpAnalyzer.modelsAvailable(getClass().getClassLoader());
        }
        if ("ru".equals(language)) {
            return RussianNlpAnalyzer.modelsAvailable(getClass().getClassLoader());
        }
        return false;
    }

    private String packAsset(String language) {
        return "packs/" + language + "-v" + GRADSHOW_PACK_VERSION + "-lemma.zip";
    }

    private synchronized void closeOpenPack() {
        for (SQLiteDatabase database : databases.values()) {
            if (database != null && database.isOpen()) database.close();
        }
        databases.clear();
        openPackDirectories.clear();
        englishAnalyzer = null;
        openEnglishAnalyzerDirectory = null;
        germanAnalyzer = null;
        openGermanAnalyzerDirectory = null;
        koreanAnalyzerGeneration += 1;
        closeKoreanAnalyzer();
        russianAnalyzer = null;
        openRussianAnalyzerDirectory = null;
    }

    private JSONObject missingLookupResult(
        String lemma,
        String pos,
        String language,
        JSONObject profile
    ) throws Exception {
        String localKey = lemma + "_" + pos;
        String globalKey = lemma + "/" + pos + "/" + language;
        JSONObject state = profile.optJSONObject(globalKey);
        boolean interested = state != null && state.optBoolean("is_interested", false);
        JSONObject result = new JSONObject();
        result.put("key", localKey);
        result.put("global_key", globalKey);
        result.put("found", false);
        result.put("kwic", new JSONArray());
        result.put("furigana", JSONObject.NULL);
        result.put("is_interested", interested);
        result.put("is_favorite", interested);
        return result;
    }

    private JSONObject lookupEntry(
        SQLiteDatabase db,
        String lemma,
        String pos,
        String language,
        JSONObject profile
    ) throws Exception {
        String localKey = lemma + "_" + pos;
        String globalKey = lemma + "/" + pos + "/" + language;
        JSONObject stats = readPayload(db, "lemma_stats", "lemma_key", localKey);
        if (stats == null) return null;

        List<Long> lineIds = jsonLongs(stats.optJSONArray("lines"));
        List<JSONObject> candidates = loadCandidateLines(db, lineIds, lemma, pos);
        Map<String, Integer> frequencies = loadFrequencies(db, collectLemmaKeys(candidates));
        Map<String, Double> ranks = frequencyRanks(frequencies);

        for (JSONObject candidate : candidates) {
            candidate.put(
                "selection_debug",
                metrics(candidate, localKey, language, profile, ranks)
            );
        }

        candidates.sort((left, right) -> {
            int lengthOrder = Integer.compare(
                left.optJSONArray("tokens") != null ? left.optJSONArray("tokens").length() : 0,
                right.optJSONArray("tokens") != null ? right.optJSONArray("tokens").length() : 0
            );
            if (lengthOrder != 0) return lengthOrder;
            return Long.compare(left.optLong("line_id"), right.optLong("line_id"));
        });

        JSONArray kwic = new JSONArray();
        List<List<String>> signatures = new ArrayList<>();
        for (JSONObject candidate : candidates) {
            List<String> signature = signature(candidate, lemma, pos);
            boolean duplicate = false;
            for (List<String> selected : signatures) {
                if (sequenceSimilarity(signature, selected) >= SIMILARITY_THRESHOLD) {
                    duplicate = true;
                    break;
                }
            }
            if (duplicate) continue;
            kwic.put(candidate);
            signatures.add(signature);
            if (kwic.length() >= EXAMPLE_LIMIT) break;
        }

        JSONObject userState = profile.optJSONObject(globalKey);
        boolean interested = userState != null && userState.optBoolean("is_interested", false);
        JSONObject result = new JSONObject();
        result.put("key", localKey);
        result.put("global_key", globalKey);
        result.put("found", true);
        result.put("kwic", kwic);
        result.put("furigana", stats.optString("furigana", null));
        result.put("is_interested", interested);
        result.put("is_favorite", interested);
        return result;
    }

    private JSONObject readPayload(SQLiteDatabase db, String table, String column, String key) {
        try (Cursor cursor = db.query(
            table,
            new String[] { "payload" },
            column + " = ?",
            new String[] { key },
            null,
            null,
            null,
            "1"
        )) {
            if (!cursor.moveToFirst()) return null;
            return new JSONObject(cursor.getString(0));
        } catch (Exception ignored) {
            return null;
        }
    }

    private List<Long> jsonLongs(JSONArray array) {
        List<Long> result = new ArrayList<>();
        if (array == null) return result;
        for (int index = 0; index < array.length(); index += 1) {
            long value = array.optLong(index, Long.MIN_VALUE);
            if (value != Long.MIN_VALUE) result.add(value);
        }
        return result;
    }

    private List<JSONObject> loadCandidateLines(
        SQLiteDatabase db,
        List<Long> lineIds,
        String lemma,
        String pos
    ) throws Exception {
        List<JSONObject> result = new ArrayList<>();
        for (int start = 0; start < lineIds.size(); start += 800) {
            List<Long> chunk = lineIds.subList(start, Math.min(start + 800, lineIds.size()));
            StringBuilder placeholders = new StringBuilder();
            String[] arguments = new String[chunk.size()];
            for (int index = 0; index < chunk.size(); index += 1) {
                if (index > 0) placeholders.append(',');
                placeholders.append('?');
                arguments[index] = String.valueOf(chunk.get(index));
            }
            try (Cursor cursor = db.rawQuery(
                "SELECT line_id, payload FROM lines WHERE line_id IN (" + placeholders + ")",
                arguments
            )) {
                while (cursor.moveToNext()) {
                    JSONObject line = new JSONObject(cursor.getString(1));
                    if (!line.has("line_id")) line.put("line_id", cursor.getLong(0));
                    JSONArray matches = matchIndices(line.optJSONArray("tokens"), lemma, pos);
                    if (matches.length() == 0) continue;
                    line.put("match_indices", matches);
                    result.add(line);
                }
            }
        }
        return result;
    }

    private JSONArray matchIndices(JSONArray tokens, String lemma, String pos) {
        JSONArray result = new JSONArray();
        if (tokens == null) return result;
        for (int index = 0; index < tokens.length(); index += 1) {
            JSONObject token = tokens.optJSONObject(index);
            if (token == null) continue;
            if (matches(token, lemma, pos)) {
                result.put(index);
                continue;
            }
            JSONArray morphs = token.optJSONArray("morphs");
            if (morphs == null) continue;
            for (int morphIndex = 0; morphIndex < morphs.length(); morphIndex += 1) {
                if (matches(morphs.optJSONObject(morphIndex), lemma, pos)) {
                    result.put(index);
                    break;
                }
            }
        }
        return result;
    }

    private boolean matches(JSONObject token, String lemma, String pos) {
        return token != null
            && lemma.equals(value(token, "lemma"))
            && pos.equals(value(token, "pos"));
    }

    private String value(JSONObject object, String key) {
        return object == null || object.isNull(key) ? "" : object.optString(key, "");
    }

    private List<JSONObject> units(JSONObject token) {
        List<JSONObject> result = new ArrayList<>();
        JSONArray morphs = token.optJSONArray("morphs");
        if (morphs != null) {
            for (int index = 0; index < morphs.length(); index += 1) {
                JSONObject morph = morphs.optJSONObject(index);
                if (validUnit(morph)) result.add(morph);
            }
        }
        if (result.isEmpty() && validUnit(token)) result.add(token);
        return result;
    }

    private boolean validUnit(JSONObject unit) {
        return unit != null
            && !value(unit, "lemma").isEmpty()
            && !value(unit, "pos").isEmpty();
    }

    private Set<String> collectLemmaKeys(List<JSONObject> lines) {
        Set<String> keys = new HashSet<>();
        for (JSONObject line : lines) {
            JSONArray tokens = line.optJSONArray("tokens");
            if (tokens == null) continue;
            for (int tokenIndex = 0; tokenIndex < tokens.length(); tokenIndex += 1) {
                JSONObject token = tokens.optJSONObject(tokenIndex);
                if (token == null) continue;
                for (JSONObject unit : units(token)) {
                    keys.add(value(unit, "lemma") + "_" + value(unit, "pos"));
                }
            }
        }
        return keys;
    }

    private Map<String, Integer> loadFrequencies(SQLiteDatabase db, Set<String> keys) {
        Map<String, Integer> result = new HashMap<>();
        List<String> values = new ArrayList<>(keys);
        for (int start = 0; start < values.size(); start += 800) {
            List<String> chunk = values.subList(start, Math.min(start + 800, values.size()));
            StringBuilder placeholders = new StringBuilder();
            String[] arguments = new String[chunk.size()];
            for (int index = 0; index < chunk.size(); index += 1) {
                if (index > 0) placeholders.append(',');
                placeholders.append('?');
                arguments[index] = chunk.get(index);
            }
            try (Cursor cursor = db.rawQuery(
                "SELECT lemma_key, payload FROM lemma_stats WHERE lemma_key IN (" + placeholders + ")",
                arguments
            )) {
                while (cursor.moveToNext()) {
                    try {
                        int frequency = new JSONObject(cursor.getString(1)).optInt("freq", 0);
                        if (frequency > 0) result.put(cursor.getString(0), frequency);
                    } catch (Exception ignored) {
                        // Ignore an individual malformed statistics row.
                    }
                }
            }
        }
        return result;
    }

    private Map<String, Double> frequencyRanks(Map<String, Integer> frequencies) {
        Map<String, Double> result = new HashMap<>();
        if (frequencies.isEmpty()) return result;
        List<Double> ordered = new ArrayList<>();
        for (Integer value : frequencies.values()) ordered.add(Math.log1p(value));
        Collections.sort(ordered);
        List<Double> unique = new ArrayList<>();
        for (Double value : ordered) {
            if (unique.isEmpty() || !value.equals(unique.get(unique.size() - 1))) unique.add(value);
        }
        if (unique.size() == 1) {
            for (String key : frequencies.keySet()) result.put(key, 0.5);
            return result;
        }
        for (Map.Entry<String, Integer> entry : frequencies.entrySet()) {
            double value = Math.log1p(entry.getValue());
            result.put(entry.getKey(), (double) Collections.binarySearch(unique, value) / (unique.size() - 1));
        }
        return result;
    }

    private JSONObject metrics(
        JSONObject line,
        String targetKey,
        String language,
        JSONObject profile,
        Map<String, Double> frequencyRanks
    ) throws Exception {
        List<Double> familiarity = new ArrayList<>();
        List<Double> priors = new ArrayList<>();
        Set<String> interestedKeys = new HashSet<>();
        int known = 0;
        int exposed = 0;
        JSONArray tokens = line.optJSONArray("tokens");

        if (tokens != null) {
            for (int tokenIndex = 0; tokenIndex < tokens.length(); tokenIndex += 1) {
                JSONObject token = tokens.optJSONObject(tokenIndex);
                if (token == null) continue;
                for (JSONObject unit : units(token)) {
                    String lemma = value(unit, "lemma");
                    String pos = value(unit, "pos");
                    String localKey = lemma + "_" + pos;
                    if (targetKey.equals(localKey)) continue;
                    String globalKey = lemma + "/" + pos + "/" + language;
                    JSONObject state = profile.optJSONObject(globalKey);
                    Double rank = frequencyRanks.get(localKey);
                    double prior = 0.20 + 0.70 * (rank != null ? rank : 0.0);
                    double probability;
                    if (state != null && state.optBoolean("is_known", false)) {
                        probability = 1.0;
                        known += 1;
                    } else {
                        int exposureCount = state != null ? Math.max(0, Math.min(10, state.optInt("exposure_count", 0))) : 0;
                        probability = Math.max(prior, 0.35 + 0.025 * exposureCount);
                        if (exposureCount > 0) exposed += 1;
                    }
                    familiarity.add(probability);
                    priors.add(prior);
                    if (state != null && state.optBoolean("is_interested", false)) interestedKeys.add(globalKey);
                }
            }
        }

        double coverage = average(familiarity, 1.0);
        double score = coverage
            + 0.07 * Math.min(interestedKeys.size(), 2)
            + (coverage >= 0.95 ? 0.03 : 0.0)
            + (Math.abs(line.optLong("line_id")) % 1000) / 1_000_000_000.0;

        JSONObject output = new JSONObject();
        output.put("score", round4(score));
        output.put("coverage", round4(coverage));
        output.put("frequency_prior", round4(average(priors, 1.0)));
        output.put("known", known);
        output.put("exposed", exposed);
        output.put("interested", interestedKeys.size());
        output.put("scored_tokens", familiarity.size());
        output.put("length", tokens != null ? tokens.length() : 0);
        return output;
    }

    private double average(List<Double> values, double fallback) {
        if (values.isEmpty()) return fallback;
        double total = 0;
        for (Double value : values) total += value;
        return total / values.size();
    }

    private double round4(double value) {
        return Math.round(value * 10_000.0) / 10_000.0;
    }

    private List<String> signature(JSONObject line, String lemma, String pos) {
        List<String> result = new ArrayList<>();
        JSONArray tokens = line.optJSONArray("tokens");
        if (tokens == null) return result;
        for (int tokenIndex = 0; tokenIndex < tokens.length(); tokenIndex += 1) {
            JSONObject token = tokens.optJSONObject(tokenIndex);
            if (token == null) continue;
            JSONArray morphs = token.optJSONArray("morphs");
            List<JSONObject> signatureUnits = new ArrayList<>();
            if (morphs != null && morphs.length() > 0) {
                for (int index = 0; index < morphs.length(); index += 1) {
                    JSONObject morph = morphs.optJSONObject(index);
                    if (morph != null) signatureUnits.add(morph);
                }
            } else {
                signatureUnits.add(token);
            }
            for (JSONObject unit : signatureUnits) {
                String unitLemma = value(unit, "lemma");
                String unitPos = value(unit, "pos");
                if (lemma.equals(unitLemma) && pos.equals(unitPos)) continue;
                if (IGNORED_POS.contains(unitPos)) continue;
                String signatureValue = !unitLemma.isEmpty() ? unitLemma : value(unit, "surface");
                signatureValue = signatureValue.trim().toLowerCase(Locale.ROOT);
                if (!signatureValue.isEmpty()) result.add(signatureValue);
            }
        }
        return result;
    }

    private double sequenceSimilarity(List<String> left, List<String> right) {
        if (left.isEmpty() && right.isEmpty()) return 1.0;
        int[] previous = new int[right.size() + 1];
        for (int leftIndex = 1; leftIndex <= left.size(); leftIndex += 1) {
            int[] current = new int[right.size() + 1];
            for (int rightIndex = 1; rightIndex <= right.size(); rightIndex += 1) {
                current[rightIndex] = left.get(leftIndex - 1).equals(right.get(rightIndex - 1))
                    ? previous[rightIndex - 1] + 1
                    : Math.max(previous[rightIndex], current[rightIndex - 1]);
            }
            previous = current;
        }
        return (2.0 * previous[right.size()]) / (left.size() + right.size());
    }

    @Override
    protected void handleOnDestroy() {
        executor.shutdown();
        closeOpenPack();
        super.handleOnDestroy();
    }
}
