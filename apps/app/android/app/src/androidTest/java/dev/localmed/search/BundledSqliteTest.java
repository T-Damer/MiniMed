package dev.localmed.search;

import static org.junit.Assert.*;
import android.content.Context;
import android.database.Cursor;
import android.util.Log;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.core.app.ActivityScenario;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import net.zetetic.database.sqlcipher.SQLiteDatabase;
import java.io.File;
import org.junit.Test;

/** Runs the shipped SQLite binary, including on devices whose system SQLite lacks FTS5. */
public class BundledSqliteTest {
    @Test public void bundledRuntimeSupportsRealFts5Queries() {
        NativePackDatabase.ensureLoaded();
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
        assertTrue("Install the verified core before running this test", file.isFile());
        long size = file.length();
        long modified = file.lastModified();
        assertTrue("Qualification must use the full corpus", size > 400_000_000L);
        for (int round = 0; round < 2; round++) {
            long start = android.os.SystemClock.elapsedRealtime();
            try (SQLiteDatabase db = NativePackDatabase.openReadOnly(file)) {
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

    @Test public void fullApplicationReachesSearchAndReturnsResultsWithoutExhaustingTheBridge() throws Exception {
        try (ActivityScenario<MainActivity> app = ActivityScenario.launch(MainActivity.class)) {
            // Cold integrity validation of the 490 MiB corpus takes about 100 s on the CI emulator.
            long start = android.os.SystemClock.elapsedRealtime();
            awaitWebCondition(app, "Boolean(document.querySelector('[data-testid=search-input]'))", 180_000);
            Log.i("MiniMedSqliteTest", "appReadyMs=" + (android.os.SystemClock.elapsedRealtime() - start));
            app.onActivity(activity -> activity.getBridge().getWebView().evaluateJavascript(
                "(() => { const input = document.querySelector('[data-testid=search-input]');"
                + " input.value = 'астма'; input.dispatchEvent(new Event('input', {bubbles:true})); })()", null));
            awaitWebCondition(app, "document.querySelectorAll('[data-testid=search-result]').length > 0", 60_000);
        }
    }

    private static void awaitWebCondition(ActivityScenario<MainActivity> app, String condition, long timeoutMs) throws Exception {
        long deadline = android.os.SystemClock.elapsedRealtime() + timeoutMs;
        while (android.os.SystemClock.elapsedRealtime() < deadline) {
            AtomicBoolean ready = new AtomicBoolean();
            CountDownLatch evaluated = new CountDownLatch(1);
            app.onActivity(activity -> activity.getBridge().getWebView().evaluateJavascript(condition, value -> {
                ready.set("true".equals(value));
                evaluated.countDown();
            }));
            assertTrue("WebView must respond while opening the full corpus", evaluated.await(5, TimeUnit.SECONDS));
            if (ready.get()) return;
            Thread.sleep(200);
        }
        fail("Full-corpus app did not reach " + condition + " within " + timeoutMs + " ms");
    }

}
