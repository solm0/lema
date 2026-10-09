package com.solmi.lema;

import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;

import java.util.LinkedHashMap;
import java.util.Map;

/** Small bounded cache around the language-pack lemma_stats primary key. */
final class SqliteLemmaKeyLookup implements LemmaKeyLookup {
    private static final int MAX_CACHE_ENTRIES = 4096;

    private final SQLiteDatabase database;
    private final Map<String, Boolean> cache = new LinkedHashMap<String, Boolean>(256, 0.75f, true) {
        @Override
        protected boolean removeEldestEntry(Map.Entry<String, Boolean> eldest) {
            return size() > MAX_CACHE_ENTRIES;
        }
    };

    SqliteLemmaKeyLookup(SQLiteDatabase database) {
        if (database == null) throw new IllegalArgumentException("database is required");
        this.database = database;
    }

    @Override
    public synchronized boolean contains(String lemma, String pos) {
        String key = lemma + "_" + pos;
        Boolean cached = cache.get(key);
        if (cached != null) return cached;

        boolean found;
        try (Cursor cursor = database.rawQuery(
            "SELECT 1 FROM lemma_stats WHERE lemma_key = ? LIMIT 1",
            new String[] { key }
        )) {
            found = cursor.moveToFirst();
        }
        cache.put(key, found);
        return found;
    }
}
