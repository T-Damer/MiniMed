package dev.localmed.search;

import static org.junit.Assert.*;
import android.content.Context;
import android.database.Cursor;
import android.util.Log;
import androidx.test.platform.app.InstrumentationRegistry;
import io.requery.android.database.sqlite.SQLiteDatabase;
import java.io.File;
import org.junit.Test;

/** Runs the shipped SQLite binary, including on devices whose system SQLite lacks FTS5. */
public class BundledSqliteTest {
    @Test public void bundledRuntimeSupportsRealFts5Queries() {
        try (SQLiteDatabase db = SQLiteDatabase.create(null)) {
            db.execSQL("CREATE VIRTUAL TABLE documents USING fts5(text, tokenize='unicode61')");
            db.execSQL("INSERT INTO documents VALUES ('бронхиальная астма')");
            try (Cursor row = db.rawQuery("SELECT count(*) FROM documents WHERE documents MATCH ?", new String[] {"астма"})) {
                assertTrue(row.moveToFirst());
                assertEquals(1, row.getLong(0));
            }
        }
    }

    @Test public void installedRealCoreOpensReadOnlyAndReopensWithoutChangingItsFile() {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        File file = new File(context.getFilesDir(), "localmed/content/core.db");
        // The dedicated CI qualification installs the exact core before instrumentation. Not a mock.
        assertTrue("Install the verified core before running this test", file.isFile());
        long size = file.length();
        long modified = file.lastModified();
        assertTrue("Qualification must use the full corpus", size > 400_000_000L);
        for (int round = 0; round < 2; round++) {
            long start = android.os.SystemClock.elapsedRealtime();
            try (SQLiteDatabase db = SQLiteDatabase.openDatabase(file.getAbsolutePath(), null,
                    SQLiteDatabase.OPEN_READONLY | SQLiteDatabase.NO_LOCALIZED_COLLATORS)) {
                long opened = android.os.SystemClock.elapsedRealtime();
                try (Cursor row = db.rawQuery("SELECT count(*) FROM chunks_fts WHERE chunks_fts MATCH ?", new String[] {"астма"})) {
                    assertTrue(row.moveToFirst());
                    assertTrue("A real corpus FTS search must find evidence", row.getLong(0) > 0);
                }
                long searched = android.os.SystemClock.elapsedRealtime();
                assertTrue(db.isReadOnly());
                Log.i("MiniMedSqliteTest", "round=" + round + " openMs=" + (opened-start) + " ftsMs=" + (searched-opened));
            }
            assertEquals(size, file.length());
            assertEquals(modified, file.lastModified());
        }
    }
}
