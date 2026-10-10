package com.solmi.lema;

import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;

import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;
import java.util.jar.JarEntry;
import java.util.jar.JarInputStream;
import java.util.regex.Pattern;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

final class AndroidLanguagePackStore {
    interface ProgressListener {
        void update(double progress, String status, String detail, Integer modelPercent);
    }

    private static final Pattern LANGUAGE_PATTERN = Pattern.compile("^[a-z]{2,3}$");
    private static final Pattern VERSION_PATTERN = Pattern.compile("^[0-9]+(?:\\.[0-9]+)*$");
    private static final int BUFFER_SIZE = 64 * 1024;
    private static final List<String> SUPPORTED_LANGUAGES = Arrays.asList("de", "en", "ko", "ru");
    static final String KIWI_MODEL_URL =
        "https://github.com/bab2min/Kiwi/releases/download/v0.24.0/"
            + "kiwi_model_v0.24.0_base.tgz";
    static final String KIWI_MODEL_SHA256 =
        "33188ba932bba4717bad5244bbec0ef8b1c9cbb47e26e68394a7976d8d779083";
    private static final ModelArtifact[] GERMAN_MODELS = new ModelArtifact[] {
        new ModelArtifact(
            "sentence detector",
            GermanNlpAnalyzer.SENTENCE_MODEL,
            "https://repo.maven.apache.org/maven2/org/apache/opennlp/opennlp-models-sentdetect-de/1.3.0/opennlp-models-sentdetect-de-1.3.0.jar"
        ),
        new ModelArtifact(
            "tokenizer",
            GermanNlpAnalyzer.TOKEN_MODEL,
            "https://repo.maven.apache.org/maven2/org/apache/opennlp/opennlp-models-tokenizer-de/1.3.0/opennlp-models-tokenizer-de-1.3.0.jar"
        ),
        new ModelArtifact(
            "part-of-speech model",
            GermanNlpAnalyzer.POS_MODEL,
            "https://repo.maven.apache.org/maven2/org/apache/opennlp/opennlp-models-pos-de/1.3.0/opennlp-models-pos-de-1.3.0.jar"
        ),
        new ModelArtifact(
            "lemmatizer",
            GermanNlpAnalyzer.LEMMA_MODEL,
            "https://repo.maven.apache.org/maven2/org/apache/opennlp/opennlp-models-lemmatizer-de/1.3.0/opennlp-models-lemmatizer-de-1.3.0.jar"
        ),
    };
    private static final ModelArtifact[] ENGLISH_MODELS = new ModelArtifact[] {
        new ModelArtifact(
            "sentence detector",
            EnglishNlpAnalyzer.SENTENCE_MODEL,
            "https://repo.maven.apache.org/maven2/org/apache/opennlp/opennlp-models-sentdetect-en/1.3.0/opennlp-models-sentdetect-en-1.3.0.jar"
        ),
        new ModelArtifact(
            "tokenizer",
            EnglishNlpAnalyzer.TOKEN_MODEL,
            "https://repo.maven.apache.org/maven2/org/apache/opennlp/opennlp-models-tokenizer-en/1.3.0/opennlp-models-tokenizer-en-1.3.0.jar"
        ),
        new ModelArtifact(
            "part-of-speech model",
            EnglishNlpAnalyzer.POS_MODEL,
            "https://repo.maven.apache.org/maven2/org/apache/opennlp/opennlp-models-pos-en/1.3.0/opennlp-models-pos-en-1.3.0.jar"
        ),
        new ModelArtifact(
            "lemmatizer",
            EnglishNlpAnalyzer.LEMMA_MODEL,
            "https://repo.maven.apache.org/maven2/org/apache/opennlp/opennlp-models-lemmatizer-en/1.3.0/opennlp-models-lemmatizer-en-1.3.0.jar"
        ),
    };
    private static final ModelArtifact[] RUSSIAN_MODELS = new ModelArtifact[] {
        new ModelArtifact(
            "sentence detector",
            RussianNlpAnalyzer.SENTENCE_MODEL,
            "https://repo.maven.apache.org/maven2/org/apache/opennlp/opennlp-models-sentdetect-ru/1.3.0/opennlp-models-sentdetect-ru-1.3.0.jar"
        ),
        new ModelArtifact(
            "tokenizer",
            RussianNlpAnalyzer.TOKEN_MODEL,
            "https://repo.maven.apache.org/maven2/org/apache/opennlp/opennlp-models-tokenizer-ru/1.3.0/opennlp-models-tokenizer-ru-1.3.0.jar"
        ),
        new ModelArtifact(
            "part-of-speech model",
            RussianNlpAnalyzer.POS_MODEL,
            "https://repo.maven.apache.org/maven2/org/apache/opennlp/opennlp-models-pos-ru/1.3.0/opennlp-models-pos-ru-1.3.0.jar"
        ),
        new ModelArtifact(
            "lemmatizer",
            RussianNlpAnalyzer.LEMMA_MODEL,
            "https://repo.maven.apache.org/maven2/org/apache/opennlp/opennlp-models-lemmatizer-ru/1.3.0/opennlp-models-lemmatizer-ru-1.3.0.jar"
        ),
    };

    private final Context context;

    AndroidLanguagePackStore(Context context) {
        this.context = context.getApplicationContext();
        cleanupIncompleteInstalls();
    }

    JSArray supportedLanguages() {
        JSArray result = new JSArray();
        for (String language : SUPPORTED_LANGUAGES) result.put(language);
        return result;
    }

    List<String> supportedLanguageCodes() {
        return SUPPORTED_LANGUAGES;
    }

    JSArray installedPacks() {
        JSArray result = new JSArray();
        File root = rootDirectory();
        File[] languageDirectories = root.listFiles(File::isDirectory);
        if (languageDirectories == null) return result;

        Arrays.sort(languageDirectories, Comparator.comparing(File::getName));
        for (File languageDirectory : languageDirectories) {
            String language = languageDirectory.getName();
            if (!SUPPORTED_LANGUAGES.contains(language)) continue;
            File[] versionDirectories = languageDirectory.listFiles(file ->
                file.isDirectory() && VERSION_PATTERN.matcher(file.getName()).matches()
            );
            if (versionDirectories == null) continue;
            Arrays.sort(versionDirectories, (left, right) -> compareVersions(right.getName(), left.getName()));

            for (File versionDirectory : versionDirectories) {
                boolean databaseReady = hasUsableDatabase(versionDirectory);
                boolean modelsReady = hasUsableModels(language, versionDirectory);
                JSObject state = new JSObject();
                state.put("lang", language);
                state.put("version", versionDirectory.getName());
                state.put("lemma_installed", databaseReady);
                state.put("model_installed", modelsReady);
                state.put("installed", databaseReady && modelsReady);
                result.put(state);
            }
        }
        return result;
    }

    File latestReadyDirectory(String language) {
        if (!SUPPORTED_LANGUAGES.contains(language)) return null;
        File languageDirectory = new File(rootDirectory(), language);
        File[] candidates = languageDirectory.listFiles(file ->
            file.isDirectory() && VERSION_PATTERN.matcher(file.getName()).matches()
        );
        if (candidates == null) return null;
        Arrays.sort(candidates, (left, right) -> compareVersions(right.getName(), left.getName()));
        for (File candidate : candidates) {
            if (hasUsableDatabase(candidate) && hasUsableModels(language, candidate)) return candidate;
        }
        return null;
    }

    void install(
        String language,
        String version,
        String filename,
        String downloadUrl,
        ProgressListener progress
    ) throws Exception {
        validateCoordinates(language, version);
        if (!SUPPORTED_LANGUAGES.contains(language)) {
            throw new IllegalArgumentException("Unsupported Android language pack: " + language);
        }
        if (filename == null || filename.trim().isEmpty()) {
            throw new IllegalArgumentException("filename is required for pack install");
        }
        if (downloadUrl == null || downloadUrl.trim().isEmpty()) {
            throw new IllegalArgumentException("download_url is required for pack install");
        }

        File languageDirectory = new File(rootDirectory(), language);
        ensureDirectory(languageDirectory);
        File staging = new File(languageDirectory, "." + version + "-installing-" + UUID.randomUUID());
        File packArchive = null;
        try {
            ensureDirectory(staging);
            progress.update(0.0, "downloading_pack", filename, null);
            packArchive = download(downloadUrl, "language-pack-", ".zip", 0.0, 0.62, progress, "downloading_pack", filename, null);
            progress.update(0.64, "extracting_pack", filename, null);
            extractLemmaDatabase(packArchive, staging);

            File modelsDirectory = new File(staging, "models");
            ensureDirectory(modelsDirectory);
            installModels(language, modelsDirectory, progress);
            progress.update(0.98, "verifying_install", null, 100);

            if (!hasUsableDatabase(staging) || !hasUsableModels(language, staging)) {
                throw new IllegalStateException("Downloaded Android language pack is incomplete");
            }
            if ("en".equals(language)) {
                new EnglishNlpAnalyzer(new File(staging, "models"));
            } else if ("de".equals(language)) {
                new GermanNlpAnalyzer(new File(staging, "models"), null);
            } else if ("ko".equals(language)) {
                try (KoreanNlpAnalyzer ignored = new KoreanNlpAnalyzer(
                    new File(new File(staging, "models"), KoreanNlpAnalyzer.MODEL_DIRECTORY)
                )) {
                    // Opening the native analyzer verifies model/runtime compatibility.
                }
            } else if ("ru".equals(language)) {
                new RussianNlpAnalyzer(new File(staging, "models"), null);
            }

            File target = new File(languageDirectory, version);
            deleteRecursively(target);
            if (!staging.renameTo(target)) {
                throw new IllegalStateException("Could not finish language pack installation");
            }
            progress.update(1.0, "done", null, 100);
        } finally {
            if (packArchive != null) packArchive.delete();
            deleteRecursively(staging);
        }
    }

    void uninstall(String language, String version) {
        validateCoordinates(language, version);
        deleteRecursively(new File(new File(rootDirectory(), language), version));
        File languageDirectory = new File(rootDirectory(), language);
        File[] remaining = languageDirectory.listFiles();
        if (remaining != null && remaining.length == 0) languageDirectory.delete();
    }

    private void installModels(
        String language,
        File modelsDirectory,
        ProgressListener progress
    ) throws Exception {
        if ("ko".equals(language)) {
            installKiwiModel(modelsDirectory, progress);
            return;
        }

        ModelArtifact[] models = modelsForLanguage(language);
        for (int index = 0; index < models.length; index += 1) {
            ModelArtifact artifact = models[index];
            double start = 0.66 + (0.30 * index / models.length);
            double end = 0.66 + (0.30 * (index + 1) / models.length);
            int startPercent = (int) Math.round(100.0 * index / models.length);
            File archive = null;
            try {
                archive = download(
                    artifact.url,
                    "opennlp-model-",
                    ".jar",
                    start,
                    end,
                    progress,
                    "installing_model",
                    artifact.label,
                    startPercent
                );
                extractModel(archive, modelsDirectory, artifact.filename);
            } finally {
                if (archive != null) archive.delete();
            }
        }
    }

    private void installKiwiModel(
        File modelsDirectory,
        ProgressListener progress
    ) throws Exception {
        File archive = null;
        try {
            archive = download(
                KIWI_MODEL_URL,
                "kiwi-model-",
                ".tgz",
                0.66,
                0.96,
                progress,
                "installing_model",
                "Kiwi 0.24.0 Korean model",
                0
            );
            verifySha256(archive, KIWI_MODEL_SHA256);
            File kiwiDirectory = new File(modelsDirectory, KoreanNlpAnalyzer.MODEL_DIRECTORY);
            KiwiModelArchive.extract(archive, kiwiDirectory);
        } finally {
            if (archive != null) archive.delete();
        }
    }

    private ModelArtifact[] modelsForLanguage(String language) {
        if ("de".equals(language)) return GERMAN_MODELS;
        if ("en".equals(language)) return ENGLISH_MODELS;
        if ("ru".equals(language)) return RUSSIAN_MODELS;
        throw new IllegalArgumentException("Unsupported Android language pack: " + language);
    }

    private File download(
        String rawUrl,
        String prefix,
        String suffix,
        double start,
        double end,
        ProgressListener progress,
        String status,
        String detail,
        Integer initialModelPercent
    ) throws Exception {
        URL url = new URL(rawUrl);
        if (!"https".equalsIgnoreCase(url.getProtocol())) {
            throw new IllegalArgumentException("Language pack downloads must use HTTPS");
        }

        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        connection.setConnectTimeout(30_000);
        connection.setReadTimeout(120_000);
        connection.setInstanceFollowRedirects(true);
        connection.setRequestProperty("User-Agent", "Lema-Android/" + BuildConfig.VERSION_NAME);
        int responseCode = connection.getResponseCode();
        if (responseCode < 200 || responseCode >= 300) {
            connection.disconnect();
            throw new IllegalStateException("Download failed: HTTP " + responseCode);
        }

        long total = connection.getContentLengthLong();
        long downloaded = 0;
        File outputFile = File.createTempFile(prefix, suffix, context.getCacheDir());
        try (
            InputStream input = new BufferedInputStream(connection.getInputStream());
            FileOutputStream output = new FileOutputStream(outputFile)
        ) {
            byte[] buffer = new byte[BUFFER_SIZE];
            int read;
            while ((read = input.read(buffer)) != -1) {
                output.write(buffer, 0, read);
                downloaded += read;
                double fraction = total > 0 ? Math.min(1.0, (double) downloaded / total) : 0.0;
                double current = total > 0 ? start + ((end - start) * fraction) : start;
                Integer modelPercent = initialModelPercent;
                if ("installing_model".equals(status)) {
                    modelPercent = (int) Math.round(
                        Math.max(0.0, Math.min(100.0, (current - 0.66) / 0.30 * 100.0))
                    );
                }
                progress.update(current, status, detail, modelPercent);
            }
            output.getFD().sync();
        } catch (Exception error) {
            outputFile.delete();
            throw error;
        } finally {
            connection.disconnect();
        }
        return outputFile;
    }

    private void extractLemmaDatabase(File archive, File targetDirectory) throws Exception {
        File database = new File(targetDirectory, "lemma_pack.db");
        boolean found = false;
        try (ZipInputStream zip = new ZipInputStream(new BufferedInputStream(new java.io.FileInputStream(archive)))) {
            ZipEntry entry;
            while ((entry = zip.getNextEntry()) != null) {
                if (!entry.isDirectory() && "lemma_pack.db".equals(new File(entry.getName()).getName())) {
                    copyStream(zip, database);
                    found = true;
                    break;
                }
                zip.closeEntry();
            }
        }
        if (!found || database.length() == 0) {
            throw new IllegalStateException("Language pack archive does not contain lemma_pack.db");
        }
    }

    private void extractModel(File archive, File targetDirectory, String filename) throws Exception {
        File target = new File(targetDirectory, filename);
        boolean found = false;
        try (JarInputStream jar = new JarInputStream(new BufferedInputStream(new java.io.FileInputStream(archive)))) {
            JarEntry entry;
            while ((entry = jar.getNextJarEntry()) != null) {
                if (!entry.isDirectory() && filename.equals(new File(entry.getName()).getName())) {
                    copyStream(jar, target);
                    found = true;
                    break;
                }
            }
        }
        if (!found || target.length() == 0) {
            throw new IllegalStateException("OpenNLP model archive does not contain " + filename);
        }
    }

    private void copyStream(InputStream input, File target) throws Exception {
        try (FileOutputStream output = new FileOutputStream(target)) {
            byte[] buffer = new byte[BUFFER_SIZE];
            int read;
            while ((read = input.read(buffer)) != -1) output.write(buffer, 0, read);
            output.getFD().sync();
        }
    }

    private void verifySha256(File file, String expected) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream input = new BufferedInputStream(new java.io.FileInputStream(file))) {
            byte[] buffer = new byte[BUFFER_SIZE];
            int read;
            while ((read = input.read(buffer)) != -1) digest.update(buffer, 0, read);
        }
        StringBuilder actual = new StringBuilder();
        for (byte value : digest.digest()) actual.append(String.format("%02x", value & 0xff));
        if (!expected.equals(actual.toString())) {
            throw new IllegalStateException("Downloaded Kiwi model failed SHA-256 verification");
        }
    }

    private boolean hasUsableDatabase(File directory) {
        File databaseFile = new File(directory, "lemma_pack.db");
        if (!databaseFile.isFile() || databaseFile.length() == 0) return false;
        SQLiteDatabase database = null;
        try {
            database = SQLiteDatabase.openDatabase(databaseFile.getAbsolutePath(), null, SQLiteDatabase.OPEN_READONLY);
            List<String> required = new ArrayList<>(Arrays.asList("lemma_stats", "lines"));
            try (Cursor cursor = database.rawQuery(
                "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('lemma_stats', 'lines')",
                null
            )) {
                while (cursor.moveToNext()) required.remove(cursor.getString(0));
            }
            return required.isEmpty();
        } catch (Exception ignored) {
            return false;
        } finally {
            if (database != null) database.close();
        }
    }

    private boolean hasUsableModels(String language, File directory) {
        File modelsDirectory = new File(directory, "models");
        if ("de".equals(language)) return GermanNlpAnalyzer.modelsAvailable(modelsDirectory);
        if ("en".equals(language)) return EnglishNlpAnalyzer.modelsAvailable(modelsDirectory);
        if ("ko".equals(language)) {
            return KoreanNlpAnalyzer.modelsAvailable(
                new File(modelsDirectory, KoreanNlpAnalyzer.MODEL_DIRECTORY)
            );
        }
        if ("ru".equals(language)) return RussianNlpAnalyzer.modelsAvailable(modelsDirectory);
        return false;
    }

    private File rootDirectory() {
        return new File(context.getFilesDir(), "language-packs");
    }

    private void cleanupIncompleteInstalls() {
        File[] languageDirectories = rootDirectory().listFiles(File::isDirectory);
        if (languageDirectories == null) return;
        for (File languageDirectory : languageDirectories) {
            File[] incomplete = languageDirectory.listFiles(file ->
                file.isDirectory() && file.getName().startsWith(".") && file.getName().contains("-installing-")
            );
            if (incomplete == null) continue;
            for (File directory : incomplete) deleteRecursively(directory);
        }
    }

    private void validateCoordinates(String language, String version) {
        if (language == null || !LANGUAGE_PATTERN.matcher(language).matches()) {
            throw new IllegalArgumentException("Invalid language pack language");
        }
        if (version == null || !VERSION_PATTERN.matcher(version).matches()) {
            throw new IllegalArgumentException("Invalid language pack version");
        }
    }

    private void ensureDirectory(File directory) {
        if (!directory.isDirectory() && !directory.mkdirs()) {
            throw new IllegalStateException("Could not create " + directory.getAbsolutePath());
        }
    }

    private void deleteRecursively(File file) {
        if (file == null || !file.exists()) return;
        File[] children = file.listFiles();
        if (children != null) {
            for (File child : children) deleteRecursively(child);
        }
        file.delete();
    }

    private static int compareVersions(String left, String right) {
        String[] leftParts = left.split("\\.");
        String[] rightParts = right.split("\\.");
        int length = Math.max(leftParts.length, rightParts.length);
        for (int index = 0; index < length; index += 1) {
            int leftValue = index < leftParts.length ? Integer.parseInt(leftParts[index]) : 0;
            int rightValue = index < rightParts.length ? Integer.parseInt(rightParts[index]) : 0;
            int compared = Integer.compare(leftValue, rightValue);
            if (compared != 0) return compared;
        }
        return 0;
    }

    private static final class ModelArtifact {
        final String label;
        final String filename;
        final String url;

        ModelArtifact(String label, String filename, String url) {
            this.label = label;
            this.filename = filename;
            this.url = url;
        }
    }
}
