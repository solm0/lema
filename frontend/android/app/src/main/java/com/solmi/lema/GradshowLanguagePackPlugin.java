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
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

@CapacitorPlugin(name = "GradshowLanguagePack")
public class GradshowLanguagePackPlugin extends Plugin {
    private static final String PACK_ASSET = "packs/en-v1.1.2-lemma.zip";
    private static final int EXAMPLE_LIMIT = 12;
    private static final double SIMILARITY_THRESHOLD = 0.85;
    private static final Set<String> IGNORED_POS =
        new HashSet<>(Arrays.asList("PUNCT", "SPACE", "SYM"));

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private SQLiteDatabase database;

    @PluginMethod
    public void lookupBatch(PluginCall call) {
        JSArray items = call.getArray("items", new JSArray());
        String language = call.getString("language", "en");
        JSObject profile = call.getObject("profile", new JSObject());

        executor.execute(() -> {
            try {
                if (!"en".equals(language)) {
                    JSObject response = new JSObject();
                    response.put("items", new JSObject());
                    call.resolve(response);
                    return;
                }

                SQLiteDatabase db = openDatabase();
                JSObject output = new JSObject();
                int count = Math.min(items.length(), 100);

                for (int index = 0; index < count; index += 1) {
                    JSONObject item = items.optJSONObject(index);
                    if (item == null) continue;
                    String lemma = item.optString("lemma", "").trim();
                    String pos = item.optString("pos", "").trim();
                    if (lemma.isEmpty() || pos.isEmpty()) continue;

                    JSONObject result = lookup(db, lemma, pos, language, profile);
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

    private synchronized SQLiteDatabase openDatabase() throws Exception {
        if (database != null && database.isOpen()) return database;

        File packDirectory = new File(getContext().getFilesDir(), "gradshow-language-packs/en-v1.1.2");
        File packDatabase = new File(packDirectory, "lemma_pack.db");
        if (!packDatabase.exists() || packDatabase.length() == 0) {
            extractPack(packDirectory, packDatabase);
        }
        database = SQLiteDatabase.openDatabase(
            packDatabase.getAbsolutePath(),
            null,
            SQLiteDatabase.OPEN_READONLY
        );
        return database;
    }

    private void extractPack(File packDirectory, File packDatabase) throws Exception {
        if (!packDirectory.exists() && !packDirectory.mkdirs()) {
            throw new IllegalStateException("Could not create language pack directory");
        }

        File temporary = new File(packDirectory, "lemma_pack.db.extracting");
        if (temporary.exists() && !temporary.delete()) {
            throw new IllegalStateException("Could not clear incomplete language pack");
        }

        boolean found = false;
        try (
            InputStream asset = getContext().getAssets().open(PACK_ASSET);
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
            throw new IllegalStateException("Bundled English language pack is invalid");
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

    private JSONObject lookup(
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
        synchronized (this) {
            if (database != null) database.close();
            database = null;
        }
        super.handleOnDestroy();
    }
}
