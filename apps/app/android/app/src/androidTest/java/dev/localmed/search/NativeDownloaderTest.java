package dev.localmed.search;

import static org.junit.Assert.*;

import android.app.DownloadManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.util.Log;
import androidx.test.platform.app.InstrumentationRegistry;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import ee.forgr.capacitor.plugin.downloader.CapacitorDownloaderPlugin;
import java.util.ArrayList;
import java.util.List;
import org.junit.Test;

/** Real Android DownloadManager and journal; only the WebView callback is replaced for assertions. */
public class NativeDownloaderTest {
    private static final String JOURNAL = "minimed.native.downloads.v1";

    private static final class TestPlugin extends CapacitorDownloaderPlugin {
        private final Context context;
        TestPlugin(Context context) { this.context = context; }
        @Override public Context getContext() { return context; }
        @Override public void notifyListeners(String event, JSObject data) { /* No WebView in this test. */ }
        void destroyForTest() { handleOnDestroy(); }
    }

    private static final class Call extends PluginCall {
        JSObject result;
        String error;
        String code;
        Call(String method, JSObject data) { super(null, "CapacitorDownloader", "test", method, data); }
        @Override public void resolve(JSObject data) { result = data; }
        @Override public void resolve() { result = new JSObject(); }
        @Override public void reject(String message, String code, Exception error, JSObject data) {
            this.error = message;
            this.code = code;
        }
    }

    private static Call download(TestPlugin plugin, String id) {
        JSObject request = new JSObject();
        request.put("id", id);
        // Never sends clinical content. Runner disables networking before this test.
        request.put("url", "https://example.invalid/minimed-qualification/" + id);
        request.put("destination", "minimed-downloads/" + id + ".part");
        request.put("notification", "visible");
        Call call = new Call("download", request);
        plugin.download(call);
        return call;
    }

    private static int pendingCount(DownloadManager manager) {
        try (Cursor rows = manager.query(new DownloadManager.Query().setFilterByStatus(
            DownloadManager.STATUS_PENDING | DownloadManager.STATUS_RUNNING | DownloadManager.STATUS_PAUSED))) {
            assertNotNull(rows);
            return rows.getCount();
        }
    }

    @Test public void restoresPendingJobsAndEnforcesLimitAcrossPluginRecreation() {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        DownloadManager manager = (DownloadManager) context.getSystemService(Context.DOWNLOAD_SERVICE);
        SharedPreferences journal = context.getSharedPreferences(JOURNAL, Context.MODE_PRIVATE);
        // Dedicated disposable CI install only; never clear arbitrary user downloads.
        assertEquals("Use a fresh qualification install", 0, pendingCount(manager));
        assertTrue(journal.getAll().isEmpty());
        List<TestPlugin> plugins = new ArrayList<>();
        List<Long> systemIds = new ArrayList<>();
        String[] ids = {"a".repeat(64), "b".repeat(64), "c".repeat(64)};
        try {
            TestPlugin first = new TestPlugin(context);
            first.load();
            plugins.add(first);
            for (String id : ids) {
                Call call = download(first, id);
                assertNull(call.error, call.error);
                assertNotNull(call.result);
                assertTrue(journal.contains(id));
                systemIds.add(journal.getLong(id, -1));
            }
            assertEquals(3, pendingCount(manager));
            first.destroyForTest();
            plugins.remove(first);

            TestPlugin restored = new TestPlugin(context);
            restored.load();
            plugins.add(restored);
            for (int i = 0; i < ids.length; i++) {
                Call call = download(restored, ids[i]);
                assertNull(call.error, call.error);
                assertEquals(systemIds.get(i).longValue(), journal.getLong(ids[i], -1));
            }
            Call full = download(restored, "d".repeat(64));
            assertEquals("NATIVE_DOWNLOAD_BUSY", full.code);
            assertEquals(3, pendingCount(manager));
            restored.destroyForTest();
            plugins.remove(restored);

            // Simulate enqueue -> journal interruption while the OS still has the pending job.
            assertTrue(journal.edit().remove(ids[0]).commit());
            TestPlugin recovering = new TestPlugin(context);
            recovering.load();
            plugins.add(recovering);
            Call adopted = download(recovering, ids[0]);
            assertNull(adopted.error, adopted.error);
            assertEquals(systemIds.get(0).longValue(), journal.getLong(ids[0], -1));
            assertEquals(3, pendingCount(manager));
            for (String id : ids) {
                Call stop = new Call("stop", new JSObject().put("id", id));
                recovering.stop(stop);
                assertNull(stop.error, stop.error);
                assertNotNull(stop.result);
                assertFalse(journal.contains(id));
            }
            assertEquals(0, pendingCount(manager));
            Log.i("MiniMedDownloadTest", "pendingRestore=ok enqueueJournalRecovery=ok limit=3 cancellation=ok");
        } finally {
            for (TestPlugin plugin : plugins) plugin.destroyForTest();
            for (long systemId : systemIds) manager.remove(systemId);
            for (String id : ids) journal.edit().remove(id).commit();
        }
    }
}
