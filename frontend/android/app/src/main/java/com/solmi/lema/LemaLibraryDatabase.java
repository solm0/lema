package com.solmi.lema;

import android.content.Context;

import androidx.annotation.NonNull;
import androidx.room.Dao;
import androidx.room.Database;
import androidx.room.Delete;
import androidx.room.Entity;
import androidx.room.ForeignKey;
import androidx.room.Index;
import androidx.room.Insert;
import androidx.room.OnConflictStrategy;
import androidx.room.PrimaryKey;
import androidx.room.Query;
import androidx.room.Room;
import androidx.room.RoomDatabase;
import androidx.room.Transaction;

import java.util.List;

@Database(
    entities = {
        LemaLibraryDatabase.NotebookEntity.class,
        LemaLibraryDatabase.PageEntity.class,
        LemaLibraryDatabase.AnnotationEntity.class,
        LemaLibraryDatabase.MetaEntity.class,
    },
    version = 1,
    exportSchema = false
)
public abstract class LemaLibraryDatabase extends RoomDatabase {
    private static volatile LemaLibraryDatabase INSTANCE;

    public abstract LibraryDao libraryDao();

    public static LemaLibraryDatabase get(Context context) {
        if (INSTANCE == null) {
            synchronized (LemaLibraryDatabase.class) {
                if (INSTANCE == null) {
                    INSTANCE = Room.databaseBuilder(
                        context.getApplicationContext(),
                        LemaLibraryDatabase.class,
                        "lema.sqlite"
                    ).build();
                }
            }
        }
        return INSTANCE;
    }

    @Entity(tableName = "library_meta")
    public static class MetaEntity {
        @PrimaryKey @NonNull public String key;
        @NonNull public String value;

        public MetaEntity(@NonNull String key, @NonNull String value) {
            this.key = key;
            this.value = value;
        }
    }

    @Entity(tableName = "notebooks")
    public static class NotebookEntity {
        @PrimaryKey @NonNull public String id;
        @NonNull public String name;
        @NonNull public String createdAt;
        @NonNull public String updatedAt;

        public NotebookEntity(
            @NonNull String id,
            @NonNull String name,
            @NonNull String createdAt,
            @NonNull String updatedAt
        ) {
            this.id = id;
            this.name = name;
            this.createdAt = createdAt;
            this.updatedAt = updatedAt;
        }
    }

    @Entity(
        tableName = "pages",
        foreignKeys = @ForeignKey(
            entity = NotebookEntity.class,
            parentColumns = "id",
            childColumns = "notebookId",
            onDelete = ForeignKey.CASCADE
        ),
        indices = {@Index("notebookId"), @Index("createdAt")}
    )
    public static class PageEntity {
        @PrimaryKey @NonNull public String id;
        public String notebookId;
        @NonNull public String name;
        @NonNull public String resultJson;
        @NonNull public String language;
        @NonNull public String source;
        @NonNull public String metadataJson;
        @NonNull public String createdAt;
        @NonNull public String updatedAt;

        public PageEntity(
            @NonNull String id,
            String notebookId,
            @NonNull String name,
            @NonNull String resultJson,
            @NonNull String language,
            @NonNull String source,
            @NonNull String metadataJson,
            @NonNull String createdAt,
            @NonNull String updatedAt
        ) {
            this.id = id;
            this.notebookId = notebookId;
            this.name = name;
            this.resultJson = resultJson;
            this.language = language;
            this.source = source;
            this.metadataJson = metadataJson;
            this.createdAt = createdAt;
            this.updatedAt = updatedAt;
        }
    }

    @Entity(
        tableName = "annotations",
        foreignKeys = @ForeignKey(
            entity = PageEntity.class,
            parentColumns = "id",
            childColumns = "pageId",
            onDelete = ForeignKey.CASCADE
        ),
        indices = {@Index("pageId"), @Index("createdAt")}
    )
    public static class AnnotationEntity {
        @PrimaryKey @NonNull public String id;
        @NonNull public String pageId;
        @NonNull public String type;
        @NonNull public String content;
        public int startIndex;
        public int endIndex;
        @NonNull public String createdAt;
        @NonNull public String updatedAt;

        public AnnotationEntity(
            @NonNull String id,
            @NonNull String pageId,
            @NonNull String type,
            @NonNull String content,
            int startIndex,
            int endIndex,
            @NonNull String createdAt,
            @NonNull String updatedAt
        ) {
            this.id = id;
            this.pageId = pageId;
            this.type = type;
            this.content = content;
            this.startIndex = startIndex;
            this.endIndex = endIndex;
            this.createdAt = createdAt;
            this.updatedAt = updatedAt;
        }
    }

    public static class AnnotationFeedRow {
        public String id;
        public String pageId;
        public String type;
        public String content;
        public int startIndex;
        public int endIndex;
        public String createdAt;
        public String updatedAt;
        public String pageName;
        public String pageSource;
        public String resultJson;
    }

    @Dao
    public interface LibraryDao {
        @Query("SELECT * FROM pages ORDER BY createdAt DESC, id DESC")
        List<PageEntity> listPages();

        @Query("SELECT * FROM notebooks ORDER BY createdAt DESC, id DESC")
        List<NotebookEntity> listNotebooks();

        @Query("SELECT * FROM pages WHERE id = :id LIMIT 1")
        PageEntity getPage(String id);

        @Query("SELECT * FROM notebooks WHERE id = :id LIMIT 1")
        NotebookEntity getNotebook(String id);

        @Query("SELECT * FROM annotations WHERE pageId = :pageId ORDER BY createdAt DESC, id DESC")
        List<AnnotationEntity> getPageAnnotations(String pageId);

        @Query(
            "SELECT a.id, a.pageId, a.type, a.content, a.startIndex, a.endIndex, " +
            "a.createdAt, a.updatedAt, p.name AS pageName, p.source AS pageSource, " +
            "p.resultJson AS resultJson FROM annotations a " +
            "JOIN pages p ON p.id = a.pageId ORDER BY a.createdAt DESC, a.id DESC"
        )
        List<AnnotationFeedRow> listAnnotations();

        @Query("SELECT * FROM annotations WHERE id = :id LIMIT 1")
        AnnotationEntity getAnnotation(String id);

        @Insert(onConflict = OnConflictStrategy.ABORT)
        void insertPage(PageEntity page);

        @Insert(onConflict = OnConflictStrategy.ABORT)
        void insertNotebook(NotebookEntity notebook);

        @Insert(onConflict = OnConflictStrategy.ABORT)
        void insertAnnotation(AnnotationEntity annotation);

        @Insert(onConflict = OnConflictStrategy.IGNORE)
        long insertNotebookIgnore(NotebookEntity notebook);

        @Insert(onConflict = OnConflictStrategy.IGNORE)
        long insertPageIgnore(PageEntity page);

        @Insert(onConflict = OnConflictStrategy.IGNORE)
        long insertAnnotationIgnore(AnnotationEntity annotation);

        @Insert(onConflict = OnConflictStrategy.REPLACE)
        void putMeta(MetaEntity meta);

        @Query("SELECT value FROM library_meta WHERE `key` = :key LIMIT 1")
        String getMeta(String key);

        @Query("UPDATE pages SET name = :name, updatedAt = :updatedAt WHERE id = :id")
        int renamePage(String id, String name, String updatedAt);

        @Query("UPDATE notebooks SET name = :name, updatedAt = :updatedAt WHERE id = :id")
        int renameNotebook(String id, String name, String updatedAt);

        @Query("UPDATE pages SET notebookId = :notebookId, updatedAt = :updatedAt WHERE id IN (:ids)")
        int movePages(List<String> ids, String notebookId, String updatedAt);

        @Query("UPDATE pages SET metadataJson = :metadataJson, updatedAt = :updatedAt WHERE id = :id")
        int updateMetadata(String id, String metadataJson, String updatedAt);

        @Query("UPDATE annotations SET content = :content, updatedAt = :updatedAt WHERE id = :id")
        int updateAnnotation(String id, String content, String updatedAt);

        @Query("DELETE FROM pages WHERE id = :id")
        int deletePage(String id);

        @Query("DELETE FROM notebooks WHERE id = :id")
        int deleteNotebook(String id);

        @Query("DELETE FROM annotations WHERE id = :id")
        int deleteAnnotation(String id);
    }
}
