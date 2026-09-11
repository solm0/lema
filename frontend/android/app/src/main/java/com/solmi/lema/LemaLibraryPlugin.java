package com.solmi.lema;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "LemaLibrary")
public class LemaLibraryPlugin extends Plugin {
    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    private LemaLibraryDatabase.LibraryDao dao() {
        return LemaLibraryDatabase.get(getContext()).libraryDao();
    }

    private void run(PluginCall call, Runnable work) {
        executor.execute(() -> {
            try {
                ensureMeta();
                work.run();
            } catch (Exception error) {
                call.reject(error.getMessage() != null ? error.getMessage() : "Library operation failed", error);
            }
        });
    }

    private void ensureMeta() {
        if (dao().getMeta("schema_version") == null) {
            dao().putMeta(new LemaLibraryDatabase.MetaEntity("schema_version", "1"));
        }
        if (dao().getMeta("library_id") == null) {
            dao().putMeta(new LemaLibraryDatabase.MetaEntity("library_id", UUID.randomUUID().toString()));
        }
    }

    private String now() {
        return Instant.now().toString();
    }

    @PluginMethod
    public void listPages(PluginCall call) {
        run(call, () -> {
            JSArray result = new JSArray();
            for (LemaLibraryDatabase.PageEntity page : dao().listPages()) {
                result.put(pageSummary(page));
            }
            JSObject value = new JSObject();
            value.put("items", result);
            call.resolve(value);
        });
    }

    @PluginMethod
    public void listNotebooks(PluginCall call) {
        run(call, () -> {
            JSArray result = new JSArray();
            for (LemaLibraryDatabase.NotebookEntity notebook : dao().listNotebooks()) {
                result.put(notebookJson(notebook));
            }
            JSObject value = new JSObject();
            value.put("items", result);
            call.resolve(value);
        });
    }

    @PluginMethod
    public void getPage(PluginCall call) {
        String id = call.getString("id");
        if (id == null) {
            call.reject("id is required");
            return;
        }
        run(call, () -> {
            LemaLibraryDatabase.PageEntity page = dao().getPage(id);
            if (page == null) {
                call.reject("page not found");
                return;
            }
            JSObject result = pageSummary(page);
            result.put("result", parseObject(page.resultJson));
            JSArray annotations = new JSArray();
            for (LemaLibraryDatabase.AnnotationEntity annotation : dao().getPageAnnotations(id)) {
                annotations.put(annotationJson(annotation));
            }
            result.put("annotations", annotations);
            call.resolve(result);
        });
    }

    @PluginMethod
    public void createPage(PluginCall call) {
        JSObject payload = call.getObject("page");
        if (payload == null) {
            call.reject("page is required");
            return;
        }
        run(call, () -> {
            String id = valueOr(payload.getString("id"), UUID.randomUUID().toString());
            String createdAt = valueOr(payload.getString("created_at"), now());
            LemaLibraryDatabase.PageEntity page = new LemaLibraryDatabase.PageEntity(
                id,
                nullIfBlank(payload.getString("notebook_id")),
                valueOr(payload.getString("name"), ""),
                objectString(payload.opt("result"), "{}"),
                valueOr(payload.getString("language"), ""),
                valueOr(payload.getString("source"), "user"),
                objectString(payload.opt("metadata"), "[]"),
                createdAt,
                valueOr(payload.getString("updated_at"), createdAt)
            );
            dao().insertPage(page);
            JSObject result = new JSObject();
            result.put("id", id);
            call.resolve(result);
        });
    }

    @PluginMethod
    public void createNotebook(PluginCall call) {
        String name = call.getString("name");
        if (name == null || name.trim().isEmpty()) {
            call.reject("name is required");
            return;
        }
        run(call, () -> {
            String id = UUID.randomUUID().toString();
            String createdAt = now();
            LemaLibraryDatabase.NotebookEntity notebook =
                new LemaLibraryDatabase.NotebookEntity(id, name.trim(), createdAt, createdAt);
            dao().insertNotebook(notebook);
            call.resolve(notebookJson(notebook));
        });
    }

    @PluginMethod
    public void renameItem(PluginCall call) {
        String type = call.getString("type");
        String id = call.getString("id");
        String name = call.getString("name");
        run(call, () -> {
            int changed = "notebook".equals(type)
                ? dao().renameNotebook(id, name.trim(), now())
                : dao().renamePage(id, name.trim(), now());
            if (changed == 0) call.reject("item not found");
            else call.resolve();
        });
    }

    @PluginMethod
    public void deleteItem(PluginCall call) {
        String type = call.getString("type");
        String id = call.getString("id");
        run(call, () -> {
            int changed = "notebook".equals(type) ? dao().deleteNotebook(id) : dao().deletePage(id);
            if (changed == 0) call.reject("item not found");
            else call.resolve();
        });
    }

    @PluginMethod
    public void movePages(PluginCall call) {
        JSArray ids = call.getArray("page_ids");
        List<String> pageIds = new ArrayList<>();
        if (ids != null) {
            for (int index = 0; index < ids.length(); index++) {
                pageIds.add(ids.optString(index));
            }
        }
        String notebookId = nullIfBlank(call.getString("notebook_id"));
        run(call, () -> {
            dao().movePages(pageIds, notebookId, now());
            call.resolve();
        });
    }

    @PluginMethod
    public void updateMetadata(PluginCall call) {
        String id = call.getString("id");
        JSArray metadata = call.getArray("metadata");
        run(call, () -> {
            if (dao().updateMetadata(id, metadata != null ? metadata.toString() : "[]", now()) == 0) {
                call.reject("page not found");
                return;
            }
            JSObject result = new JSObject();
            result.put("metadata", metadata != null ? metadata : new JSArray());
            call.resolve(result);
        });
    }

    @PluginMethod
    public void listAnnotations(PluginCall call) {
        run(call, () -> {
            JSArray items = new JSArray();
            for (LemaLibraryDatabase.AnnotationFeedRow row : dao().listAnnotations()) {
                JSObject item = annotationFeedJson(row);
                items.put(item);
            }
            JSObject result = new JSObject();
            result.put("items", items);
            result.put("next_cursor", JSObject.NULL);
            call.resolve(result);
        });
    }

    @PluginMethod
    public void createAnnotation(PluginCall call) {
        JSObject payload = call.getObject("annotation");
        run(call, () -> {
            String id = valueOr(payload.getString("id"), UUID.randomUUID().toString());
            String createdAt = valueOr(payload.getString("created_at"), now());
            LemaLibraryDatabase.AnnotationEntity annotation = new LemaLibraryDatabase.AnnotationEntity(
                id,
                payload.getString("page_id"),
                valueOr(payload.getString("type"), "memo"),
                valueOr(payload.getString("content"), ""),
                payload.optInt("start_index", 0),
                payload.optInt("end_index", 0),
                createdAt,
                valueOr(payload.getString("updated_at"), createdAt)
            );
            dao().insertAnnotation(annotation);
            call.resolve(annotationJson(annotation));
        });
    }

    @PluginMethod
    public void updateAnnotation(PluginCall call) {
        String id = call.getString("id");
        String content = call.getString("content");
        run(call, () -> {
            if (dao().updateAnnotation(id, content, now()) == 0) {
                call.reject("annotation not found");
                return;
            }
            call.resolve(annotationJson(dao().getAnnotation(id)));
        });
    }

    @PluginMethod
    public void deleteAnnotation(PluginCall call) {
        String id = call.getString("id");
        run(call, () -> {
            if (dao().deleteAnnotation(id) == 0) call.reject("annotation not found");
            else call.resolve();
        });
    }

    @PluginMethod
    public void getMeta(PluginCall call) {
        String key = call.getString("key");
        run(call, () -> {
            JSObject result = new JSObject();
            String value = dao().getMeta(key);
            result.put("value", value != null ? value : JSObject.NULL);
            call.resolve(result);
        });
    }

    @PluginMethod
    public void setMeta(PluginCall call) {
        String key = call.getString("key");
        String value = valueOr(call.getString("value"), "");
        run(call, () -> {
            dao().putMeta(new LemaLibraryDatabase.MetaEntity(key, value));
            call.resolve();
        });
    }

    @PluginMethod
    public void exportLibrary(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("application/json");
        intent.putExtra(Intent.EXTRA_TITLE, "lema-library-" + now().substring(0, 10) + ".lema");
        startActivityForResult(call, intent, "exportResult");
    }

    @ActivityCallback
    private void exportResult(PluginCall call, androidx.activity.result.ActivityResult activityResult) {
        if (call == null) return;
        if (activityResult.getResultCode() != Activity.RESULT_OK || activityResult.getData() == null) {
            call.resolve();
            return;
        }
        Uri uri = activityResult.getData().getData();
        run(call, () -> {
            try (OutputStream stream = getContext().getContentResolver().openOutputStream(uri, "wt")) {
                stream.write(buildBundle().toString().getBytes(StandardCharsets.UTF_8));
                stream.flush();
            } catch (Exception error) {
                throw new RuntimeException(error);
            }
            JSObject result = new JSObject();
            result.put("ok", true);
            call.resolve(result);
        });
    }

    @PluginMethod
    public void importLibrary(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        startActivityForResult(call, intent, "importResult");
    }

    @ActivityCallback
    private void importResult(PluginCall call, androidx.activity.result.ActivityResult activityResult) {
        if (call == null) return;
        if (activityResult.getResultCode() != Activity.RESULT_OK || activityResult.getData() == null) {
            call.resolve();
            return;
        }
        Uri uri = activityResult.getData().getData();
        run(call, () -> {
            try {
                String json = readText(uri);
                call.resolve(importBundle(new JSONObject(json)));
            } catch (Exception error) {
                throw new RuntimeException(error);
            }
        });
    }

    @PluginMethod
    public void mergeBundle(PluginCall call) {
        JSObject bundle = call.getObject("bundle");
        run(call, () -> {
            try {
                call.resolve(importBundle(bundle));
            } catch (JSONException error) {
                throw new RuntimeException(error);
            }
        });
    }

    private JSObject buildBundle() throws JSONException {
        JSObject bundle = new JSObject();
        bundle.put("format", "lema-library");
        bundle.put("version", 1);
        bundle.put("library_id", dao().getMeta("library_id"));
        bundle.put("exported_at", now());
        JSArray notebooks = new JSArray();
        for (LemaLibraryDatabase.NotebookEntity item : dao().listNotebooks()) notebooks.put(notebookJson(item));
        JSArray pages = new JSArray();
        for (LemaLibraryDatabase.PageEntity item : dao().listPages()) {
            JSObject page = pageSummary(item);
            page.put("result", parseObject(item.resultJson));
            pages.put(page);
        }
        JSArray annotations = new JSArray();
        for (LemaLibraryDatabase.AnnotationFeedRow row : dao().listAnnotations()) {
            LemaLibraryDatabase.AnnotationEntity item = dao().getAnnotation(row.id);
            annotations.put(annotationJson(item));
        }
        bundle.put("notebooks", notebooks);
        bundle.put("pages", pages);
        bundle.put("annotations", annotations);
        return bundle;
    }

    private JSObject importBundle(JSONObject bundle) throws JSONException {
        if (!"lema-library".equals(bundle.optString("format"))) {
            throw new JSONException("unsupported library format");
        }
        if (bundle.optInt("version", 0) > 1) {
            throw new JSONException("library was created by a newer version of Lema");
        }
        backupBeforeImport();
        int notebooks = 0;
        int pages = 0;
        int annotations = 0;
        int conflicts = 0;
        Map<String, String> notebookIdMap = new HashMap<>();
        Map<String, String> pageIdMap = new HashMap<>();
        JSONArray notebookItems = bundle.optJSONArray("notebooks");
        if (notebookItems != null) {
            for (int i = 0; i < notebookItems.length(); i++) {
                JSONObject item = notebookItems.getJSONObject(i);
                String originalId = item.getString("id");
                LemaLibraryDatabase.NotebookEntity entity = new LemaLibraryDatabase.NotebookEntity(
                    originalId, item.optString("name"), item.optString("created_at", now()),
                    item.optString("updated_at", item.optString("created_at", now()))
                );
                LemaLibraryDatabase.NotebookEntity existing = dao().getNotebook(originalId);
                if (existing == null) {
                    dao().insertNotebook(entity);
                    notebooks++;
                } else if (!sameNotebook(existing, entity)) {
                    entity.id = UUID.randomUUID().toString();
                    entity.name = entity.name + " (imported conflict)";
                    dao().insertNotebook(entity);
                    notebooks++;
                    conflicts++;
                }
                notebookIdMap.put(originalId, entity.id);
            }
        }
        JSONArray pageItems = bundle.optJSONArray("pages");
        if (pageItems != null) {
            for (int i = 0; i < pageItems.length(); i++) {
                JSONObject item = pageItems.getJSONObject(i);
                String originalId = item.getString("id");
                String originalNotebookId = nullIfBlank(item.optString("notebook_id", null));
                String mappedNotebookId = originalNotebookId == null
                    ? null
                    : notebookIdMap.getOrDefault(originalNotebookId, originalNotebookId);
                LemaLibraryDatabase.PageEntity entity = new LemaLibraryDatabase.PageEntity(
                    originalId, mappedNotebookId,
                    item.optString("name"), objectString(item.opt("result"), "{}"),
                    item.optString("language"), item.optString("source", "user"),
                    objectString(item.opt("metadata"), "[]"), item.optString("created_at", now()),
                    item.optString("updated_at", item.optString("created_at", now()))
                );
                LemaLibraryDatabase.PageEntity existing = dao().getPage(originalId);
                if (existing == null) {
                    dao().insertPage(entity);
                    pages++;
                } else if (!samePage(existing, entity)) {
                    entity.id = UUID.randomUUID().toString();
                    entity.name = entity.name + " (imported conflict)";
                    dao().insertPage(entity);
                    pages++;
                    conflicts++;
                }
                pageIdMap.put(originalId, entity.id);
            }
        }
        JSONArray annotationItems = bundle.optJSONArray("annotations");
        if (annotationItems != null) {
            for (int i = 0; i < annotationItems.length(); i++) {
                JSONObject item = annotationItems.getJSONObject(i);
                String originalId = item.getString("id");
                String originalPageId = item.getString("page_id");
                LemaLibraryDatabase.AnnotationEntity entity = new LemaLibraryDatabase.AnnotationEntity(
                    originalId, pageIdMap.getOrDefault(originalPageId, originalPageId), item.optString("type", "memo"),
                    item.optString("content"), item.optInt("start_index"), item.optInt("end_index"),
                    item.optString("created_at", now()),
                    item.optString("updated_at", item.optString("created_at", now()))
                );
                LemaLibraryDatabase.AnnotationEntity existing = dao().getAnnotation(originalId);
                if (existing == null) {
                    dao().insertAnnotation(entity);
                    annotations++;
                } else if (!sameAnnotation(existing, entity)) {
                    entity.id = UUID.randomUUID().toString();
                    dao().insertAnnotation(entity);
                    annotations++;
                    conflicts++;
                }
            }
        }
        JSObject result = new JSObject();
        result.put("notebooks", notebooks);
        result.put("pages", pages);
        result.put("annotations", annotations);
        result.put("conflicts", conflicts);
        return result;
    }

    private void backupBeforeImport() {
        try {
            File directory = new File(getContext().getFilesDir(), "library-backups");
            if (!directory.exists() && !directory.mkdirs()) return;
            File target = new File(directory, "lema-before-import-" + System.currentTimeMillis() + ".lema");
            try (FileOutputStream stream = new FileOutputStream(target)) {
                stream.write(buildBundle().toString().getBytes(StandardCharsets.UTF_8));
            }
        } catch (Exception ignored) {
            // Import remains non-destructive even if the private safety backup cannot be written.
        }
    }

    private boolean sameNotebook(
        LemaLibraryDatabase.NotebookEntity left,
        LemaLibraryDatabase.NotebookEntity right
    ) {
        return left.name.equals(right.name)
            && left.createdAt.equals(right.createdAt)
            && left.updatedAt.equals(right.updatedAt);
    }

    private boolean samePage(
        LemaLibraryDatabase.PageEntity left,
        LemaLibraryDatabase.PageEntity right
    ) {
        return sameNullable(left.notebookId, right.notebookId)
            && left.name.equals(right.name)
            && left.resultJson.equals(right.resultJson)
            && left.language.equals(right.language)
            && left.source.equals(right.source)
            && left.metadataJson.equals(right.metadataJson)
            && left.createdAt.equals(right.createdAt)
            && left.updatedAt.equals(right.updatedAt);
    }

    private boolean sameAnnotation(
        LemaLibraryDatabase.AnnotationEntity left,
        LemaLibraryDatabase.AnnotationEntity right
    ) {
        return left.pageId.equals(right.pageId)
            && left.type.equals(right.type)
            && left.content.equals(right.content)
            && left.startIndex == right.startIndex
            && left.endIndex == right.endIndex
            && left.createdAt.equals(right.createdAt)
            && left.updatedAt.equals(right.updatedAt);
    }

    private boolean sameNullable(String left, String right) {
        return left == null ? right == null : left.equals(right);
    }

    private String readText(Uri uri) throws Exception {
        StringBuilder builder = new StringBuilder();
        try (
            InputStream stream = getContext().getContentResolver().openInputStream(uri);
            BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))
        ) {
            String line;
            while ((line = reader.readLine()) != null) builder.append(line);
        }
        return builder.toString();
    }

    private JSObject pageSummary(LemaLibraryDatabase.PageEntity page) {
        JSObject result = new JSObject();
        result.put("id", page.id);
        result.put("name", page.name);
        result.put("created_at", page.createdAt);
        result.put("updated_at", page.updatedAt);
        result.put("notebook_id", page.notebookId != null ? page.notebookId : JSObject.NULL);
        result.put("language", page.language);
        result.put("source", page.source);
        result.put("metadata", parseArray(page.metadataJson));
        return result;
    }

    private JSObject notebookJson(LemaLibraryDatabase.NotebookEntity notebook) {
        JSObject result = new JSObject();
        result.put("id", notebook.id);
        result.put("name", notebook.name);
        result.put("created_at", notebook.createdAt);
        result.put("updated_at", notebook.updatedAt);
        return result;
    }

    private JSObject annotationJson(LemaLibraryDatabase.AnnotationEntity annotation) {
        JSObject result = new JSObject();
        result.put("id", annotation.id);
        result.put("page_id", annotation.pageId);
        result.put("type", annotation.type);
        result.put("content", annotation.content);
        result.put("start_index", annotation.startIndex);
        result.put("end_index", annotation.endIndex);
        result.put("created_at", annotation.createdAt);
        result.put("updated_at", annotation.updatedAt);
        return result;
    }

    private JSObject annotationFeedJson(LemaLibraryDatabase.AnnotationFeedRow row) {
        JSObject result = new JSObject();
        result.put("id", row.id);
        result.put("page_id", row.pageId);
        result.put("type", row.type);
        result.put("content", row.content);
        result.put("start_index", row.startIndex);
        result.put("end_index", row.endIndex);
        result.put("created_at", row.createdAt);
        result.put("updated_at", row.updatedAt);
        result.put("page_name", row.pageName);
        result.put("source", sourceText(row));
        return result;
    }

    private String sourceText(LemaLibraryDatabase.AnnotationFeedRow row) {
        JSONObject result = parseObject(row.resultJson);
        String[] tokens = result.optString("text", "").split("\\s+");
        StringBuilder source = new StringBuilder();
        for (int index = Math.max(0, row.startIndex); index <= row.endIndex && index < tokens.length; index++) {
            if (source.length() > 0) source.append(' ');
            source.append(tokens[index]);
        }
        return source.length() > 0 ? source.toString() : row.pageSource;
    }

    private JSONObject parseObject(String value) {
        try { return new JSONObject(value); } catch (JSONException error) { return new JSONObject(); }
    }

    private JSONArray parseArray(String value) {
        try { return new JSONArray(value); } catch (JSONException error) { return new JSONArray(); }
    }

    private String objectString(Object value, String fallback) {
        if (value instanceof JSONObject || value instanceof JSONArray) return value.toString();
        return value != null ? value.toString() : fallback;
    }

    private String valueOr(String value, String fallback) {
        return value == null || value.isEmpty() ? fallback : value;
    }

    private String nullIfBlank(String value) {
        return value == null || value.isEmpty() || "null".equals(value) ? null : value;
    }
}
