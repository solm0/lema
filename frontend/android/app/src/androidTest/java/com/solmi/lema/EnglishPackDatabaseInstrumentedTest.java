package com.solmi.lema;

import static org.junit.Assert.assertTrue;

import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.junit.Assume;
import org.junit.Test;
import org.junit.runner.RunWith;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

@RunWith(AndroidJUnit4.class)
public class EnglishPackDatabaseInstrumentedTest {
    @Test
    public void bundledGradshowDatabaseCanBeOpenedAndQueried() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        InputStream asset;
        try {
            asset = context.getAssets().open("packs/en-v1.1.2-lemma.zip");
        } catch (Exception missingFromStandardDebug) {
            Assume.assumeNoException(missingFromStandardDebug);
            return;
        }

        File databaseFile = File.createTempFile("english-pack-test-", ".db", context.getCacheDir());
        SQLiteDatabase database = null;
        try (ZipInputStream zip = new ZipInputStream(asset)) {
            boolean found = false;
            ZipEntry entry;
            while ((entry = zip.getNextEntry()) != null) {
                if (!entry.isDirectory() && "lemma_pack.db".equals(new File(entry.getName()).getName())) {
                    try (FileOutputStream output = new FileOutputStream(databaseFile)) {
                        byte[] buffer = new byte[64 * 1024];
                        int read;
                        while ((read = zip.read(buffer)) != -1) output.write(buffer, 0, read);
                    }
                    found = true;
                    break;
                }
            }
            assertTrue(found && databaseFile.length() > 0);

            database = SQLiteDatabase.openDatabase(
                databaseFile.getAbsolutePath(),
                null,
                SQLiteDatabase.OPEN_READONLY
            );
            try (Cursor cursor = database.rawQuery(
                "SELECT payload FROM lemma_stats WHERE lemma_key = ? LIMIT 1",
                new String[] { "dog_NOUN" }
            )) {
                assertTrue(cursor.moveToFirst());
                assertTrue(cursor.getString(0).contains("\"lines\""));
            }
        } finally {
            if (database != null) database.close();
            databaseFile.delete();
        }
    }
}
