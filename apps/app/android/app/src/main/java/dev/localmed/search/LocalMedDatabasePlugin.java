package dev.localmed.search;

import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteException;
import android.util.Base64;
import android.util.Log;
import android.os.SystemClock;
import android.system.Os;
import android.system.StructStat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.Executors;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.regex.Pattern;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

@CapacitorPlugin(name = "LocalMedDatabase")
public final class LocalMedDatabasePlugin extends Plugin {
    private static final int BUFFER_SIZE = 64 * 1024;
    private static final Pattern SAFE_FILE_NAME = Pattern.compile("[A-Za-z0-9._-]{1,120}");
    private static final Pattern READ_QUERY = Pattern.compile("^(SELECT|WITH)\\b", Pattern.CASE_INSENSITIVE);

    private final Object databaseLock = new Object();
    private SQLiteDatabase database;
    private final java.util.concurrent.ExecutorService openExecutor = Executors.newSingleThreadExecutor();

    @PluginMethod
    public void hasCorePack(PluginCall call) {
        String checksum = normalizeChecksum(call.getString("expectedSha256"));
        File directory = new File(getContext().getFilesDir(), "localmed/content");
        JSObject result = new JSObject();
        result.put("databasePath", new File(directory, "core.db").getAbsolutePath());
        try {
        result.put("installed", checksum != null &&
            new File(directory, "core.db").isFile() &&
            checksum.equals(readMarker(new File(directory, "core.db.sha256"))));
        call.resolve(result);
        } catch (IOException error) {
            call.reject("Unable to inspect core database: " + safeMessage(error));
        }
    }

    @PluginMethod
    public void downloadCorePack(PluginCall call) {
        String checksum = normalizeChecksum(call.getString("expectedSha256"));
        if (checksum == null || !checksum.matches("[a-f0-9]{64}")) {
            call.reject("A valid core checksum is required.");
            return;
        }
        var executor = Executors.newSingleThreadExecutor();
        executor.execute(() -> {
            synchronized (databaseLock) {
                try {
                    File directory = new File(getContext().getFilesDir(), "localmed/content");
                    ensureDirectory(directory);
                    installAssetIfNeeded(null, new File(directory, "core.db"),
                        new File(directory, "core.db.sha256"), checksum);
                    call.resolve();
                } catch (Exception error) {
                    call.reject("Не удалось скачать ядро: " + safeMessage(error));
                } finally {
                    executor.shutdown();
                }
            }
        });
    }

    @PluginMethod
    public void openPack(PluginCall call) {
        String assetPath = call.getString("assetPath");
        String databaseName = call.getString("databaseName");
        String expectedSha256 = normalizeChecksum(call.getString("expectedSha256"));

        if (!isSafeAssetPath(assetPath)) {
            call.reject("Invalid packaged database asset path.");
            return;
        }
        if (databaseName == null || !SAFE_FILE_NAME.matcher(databaseName).matches()) {
            call.reject("Invalid packaged database file name.");
            return;
        }
        if (expectedSha256 == null || expectedSha256.length() != 64) {
            call.reject("A SHA-256 checksum is required for the packaged database.");
            return;
        }

        // Do not block the bridge while inspecting a large edition. JS awaits this operation to
        // completion (including cleanup); it must never race an uncancellable timeout against it.
        openExecutor.execute(() -> {
            synchronized (databaseLock) {
                JSObject timings = new JSObject();
                long started = SystemClock.elapsedRealtime();
                long phaseStarted = started;
                String phase = "capabilities";
                File validationMarker = null;
                try {
                    closeDatabase();
                    // Probe the runtime, not the 490 MiB pack. This must precede installation,
                    // hashing, opening and quick_check, including on already-installed editions.
                    String sqliteVersion = probeRuntimeFts5();
                    timings.put(phase + "Ms", SystemClock.elapsedRealtime() - phaseStarted);
                    phase = "installedFile";
                    phaseStarted = SystemClock.elapsedRealtime();
                    File directory = new File(getContext().getFilesDir(), "localmed/content");
                    ensureDirectory(directory);
                    File target = new File(directory, databaseName);
                    File checksumMarker = new File(directory, databaseName + ".sha256");
                    validationMarker = validationMarker(target);
                    boolean copied = installAssetIfNeeded(assetPath, target, checksumMarker, expectedSha256);
                    String identity = validationIdentity(target, expectedSha256, sqliteVersion);
                    boolean verified = identity.equals(readMarker(validationMarker));
                    if (!verified && !expectedSha256.equals(sha256(target))) {
                        throw new PackValidationException("Installed database checksum mismatch.");
                    }
                    timings.put(phase + "Ms", SystemClock.elapsedRealtime() - phaseStarted);
                    phase = "sqliteOpen";
                    phaseStarted = SystemClock.elapsedRealtime();
                    database = SQLiteDatabase.openDatabase(
                        target.getAbsolutePath(), null,
                        SQLiteDatabase.OPEN_READONLY | SQLiteDatabase.NO_LOCALIZED_COLLATORS
                    );
                    timings.put(phase + "Ms", SystemClock.elapsedRealtime() - phaseStarted);
                    phase = "integrity";
                    phaseStarted = SystemClock.elapsedRealtime();
                    if (!verified) {
                        String integrity = scalarString("PRAGMA quick_check");
                        if (!"ok".equalsIgnoreCase(integrity)) {
                            throw new PackValidationException("Packaged database integrity check failed.");
                        }
                    }
                    timings.put(phase + "Ms", SystemClock.elapsedRealtime() - phaseStarted);
                    timings.put("integrityCached", verified);
                    phase = "metadata";
                    phaseStarted = SystemClock.elapsedRealtime();
                    if (!probeFts5()) {
                        throw new SQLiteException("The installed pack FTS5 index cannot be queried.");
                    }
                    JSObject result = new JSObject();
                    result.put("schemaVersion", scalarLong(
                        "SELECT CAST(value AS INTEGER) FROM app_metadata WHERE key = 'schema_version'"
                    ));
                    result.put("sqliteVersion", sqliteVersion);
                    result.put("fts5Available", true);
                    result.put("contentPackIds", contentPackIds());
                    result.put("documentCount", scalarLong("SELECT count(*) FROM documents"));
                    result.put("databasePath", target.getAbsolutePath());
                    result.put("copied", copied);
                    result.put("sizeBytes", target.length());
                    if (!identity.equals(validationIdentity(target, expectedSha256, sqliteVersion))) {
                        throw new PackValidationException("Installed database changed while opening.");
                    }
                    if (!verified) writeMarker(validationMarker, identity);
                    timings.put(phase + "Ms", SystemClock.elapsedRealtime() - phaseStarted);
                    timings.put("totalMs", SystemClock.elapsedRealtime() - started);
                    result.put("openTimings", timings);
                    Log.i("LocalMedDatabase", "openPack success " + timings);
                    call.resolve(result);
                } catch (Exception error) {
                    closeDatabase();
                    if (validationMarker != null) deleteBestEffort(validationMarker);
                    timings.put(phase + "Ms", SystemClock.elapsedRealtime() - phaseStarted);
                    timings.put("failedPhase", phase);
                    timings.put("totalMs", SystemClock.elapsedRealtime() - started);
                    // No paths, queries, content, or native arguments in diagnostic logs.
                    Log.w("LocalMedDatabase", "openPack failed " + timings);
                    call.reject("Unable to open the packaged LocalMed database: " + safeMessage(error),
                        error instanceof PackValidationException ? "NATIVE_PACK_VALIDATION_FAILED"
                            : "capabilities".equals(phase) ? "NATIVE_SQLITE_UNSUPPORTED" : "NATIVE_PACK_OPEN_FAILED");
                }
            }
        });
    }

    private static final class PackValidationException extends IOException {
        PackValidationException(String message) { super(message); }
    }

    @Override
    protected void handleOnDestroy() {
        openExecutor.execute(() -> {
            synchronized (databaseLock) { closeDatabase(); }
        });
        openExecutor.shutdown();
    }

    private static String probeRuntimeFts5() {
        try (SQLiteDatabase probe = SQLiteDatabase.create(null)) {
            probe.execSQL("CREATE VIRTUAL TABLE runtime_probe USING fts5(value)");
            try (Cursor cursor = probe.rawQuery(
                "SELECT count(*) FROM runtime_probe WHERE runtime_probe MATCH 'localmed'", null
            )) {
                if (!cursor.moveToFirst()) throw new SQLiteException("FTS5 probe returned no row.");
            }
            try (Cursor cursor = probe.rawQuery("SELECT sqlite_version()", null)) {
                if (!cursor.moveToFirst()) throw new SQLiteException("SQLite version is unavailable.");
                return cursor.getString(0);
            }
        }
    }

    private static File validationMarker(File target) {
        return new File(target.getParentFile(), target.getName() + ".validated");
    }

    private static String validationIdentity(File target, String checksum, String sqliteVersion)
        throws android.system.ErrnoException {
        StructStat stat = Os.stat(target.getAbsolutePath());
        return PackValidationIdentity.create(checksum, sqliteVersion, stat.st_dev, stat.st_ino,
            stat.st_ctime, target.lastModified(), target.length());
    }

    @PluginMethod
    public void query(PluginCall call) {
        String sql = call.getString("sql");
        if (!isReadOnlyQuery(sql)) {
            call.reject("Only a single read-only SELECT or WITH query is allowed.");
            return;
        }

        String argsJson = call.getString("argsJson");
        if (argsJson == null) argsJson = "[]";

        synchronized (databaseLock) {
            try {
                SQLiteDatabase opened = requireDatabase();
                JSONArray arguments = new JSONArray(argsJson);
                String[] selectionArgs = new String[arguments.length()];
                for (int index = 0; index < arguments.length(); index++) {
                    Object value = arguments.get(index);
                    selectionArgs[index] = value == JSONObject.NULL ? null : String.valueOf(value);
                }

                JSArray rows = new JSArray();
                try (Cursor cursor = opened.rawQuery(sql, selectionArgs)) {
                    String[] columnNames = cursor.getColumnNames();
                    while (cursor.moveToNext()) {
                        JSObject row = new JSObject();
                        for (int column = 0; column < columnNames.length; column++) {
                            putCursorValue(row, columnNames[column], cursor, column);
                        }
                        rows.put(row);
                    }
                }
                JSObject result = new JSObject();
                result.put("rows", rows);
                call.resolve(result);
            } catch (JSONException error) {
                call.reject("Invalid native query arguments: " + safeMessage(error));
            } catch (Exception error) {
                call.reject("Native SQLite query failed: " + safeMessage(error));
            }
        }
    }

    @PluginMethod
    public void searchVectors(PluginCall call) {
        String profileId = call.getString("profileId");
        String vectorBase64 = call.getString("vectorBase64");
        Double queryNorm = call.getDouble("vectorNorm");
        Integer requestedLimit = call.getInt("limit");
        JSArray documentIds = call.getArray("documentIds");
        JSArray sectionTypes = call.getArray("sectionTypes");

        if (profileId == null || profileId.isEmpty()) {
            call.reject("An embedding profile id is required.");
            return;
        }
        if (vectorBase64 == null || vectorBase64.isEmpty()) {
            call.reject("A base64-encoded query vector is required.");
            return;
        }
        if (queryNorm == null || !Double.isFinite(queryNorm) || queryNorm <= 0) {
            call.reject("A positive finite query-vector norm is required.");
            return;
        }

        final byte[] queryVector;
        try {
            queryVector = Base64.decode(vectorBase64, Base64.DEFAULT);
        } catch (IllegalArgumentException error) {
            call.reject("The query vector is not valid base64.");
            return;
        }
        if (queryVector.length < 8 || queryVector.length > 8192) {
            call.reject("The query-vector dimension is outside the supported range.");
            return;
        }
        int limit = Math.max(1, Math.min(requestedLimit == null ? 50 : requestedLimit, 500));

        synchronized (databaseLock) {
            try {
                SQLiteDatabase opened = requireDatabase();
                List<String> clauses = new ArrayList<>();
                List<String> args = new ArrayList<>();
                clauses.add("ce.profile_id = ?");
                args.add(profileId);
                appendInFilter(clauses, args, "d.id", documentIds);
                appendInFilter(clauses, args, "s.section_type", sectionTypes);

                String sql =
                    "SELECT ce.chunk_id, ce.vector, ce.vector_norm " +
                    "FROM chunk_embeddings ce " +
                    "JOIN chunks c ON c.id = ce.chunk_id " +
                    "JOIN sections s ON s.id = c.section_id " +
                    "JOIN document_versions dv ON dv.id = c.document_version_id " +
                    "JOIN documents d ON d.id = dv.document_id " +
                    "WHERE " + String.join(" AND ", clauses);

                List<VectorHit> hits = new ArrayList<>();
                try (Cursor cursor = opened.rawQuery(sql, args.toArray(new String[0]))) {
                    while (cursor.moveToNext()) {
                        byte[] stored = cursor.getBlob(1);
                        if (stored == null || stored.length != queryVector.length) continue;
                        double storedNorm = cursor.getDouble(2);
                        if (!Double.isFinite(storedNorm) || storedNorm <= 0) continue;
                        long dot = 0;
                        for (int index = 0; index < stored.length; index++) {
                            dot += (long) queryVector[index] * stored[index];
                        }
                        double score = dot / (queryNorm * storedNorm);
                        if (!Double.isFinite(score)) continue;
                        hits.add(new VectorHit(cursor.getString(0), Math.max(-1.0, Math.min(1.0, score))));
                    }
                }

                Collections.sort(hits, (left, right) -> {
                    int scoreOrder = Double.compare(right.score, left.score);
                    return scoreOrder != 0 ? scoreOrder : left.chunkId.compareTo(right.chunkId);
                });
                JSArray output = new JSArray();
                for (int index = 0; index < Math.min(limit, hits.size()); index++) {
                    VectorHit hit = hits.get(index);
                    JSObject row = new JSObject();
                    row.put("chunkId", hit.chunkId);
                    row.put("score", hit.score);
                    output.put(row);
                }
                JSObject result = new JSObject();
                result.put("hits", output);
                call.resolve(result);
            } catch (JSONException error) {
                call.reject("Invalid native vector-search filters: " + safeMessage(error));
            } catch (Exception error) {
                call.reject("Native vector search failed: " + safeMessage(error));
            }
        }
    }

    @PluginMethod
    public void close(PluginCall call) {
        synchronized (databaseLock) {
            closeDatabase();
            call.resolve();
        }
    }

    private boolean installAssetIfNeeded(
        String assetPath,
        File target,
        File checksumMarker,
        String expectedSha256
    ) throws IOException, NoSuchAlgorithmException {
        File temporary = new File(target.getParentFile(), target.getName() + ".tmp");
        File backup = new File(target.getParentFile(), target.getName() + ".backup");
        if (backup.exists()) deleteIfExists(validationMarker(target));
        recoverInterruptedInstall(target, backup, checksumMarker, expectedSha256);

        String installedChecksum = readMarker(checksumMarker);
        if (target.isFile() && expectedSha256.equals(installedChecksum)) return false;

        deleteIfExists(temporary);
        HttpURLConnection connection = null;
        if (assetPath == null) {
            connection = (HttpURLConnection) new URL(
                "https://media.githubusercontent.com/media/T-Damer/MiniMed/datasets/content-2026-09-06/core.db").openConnection();
            connection.setConnectTimeout(30_000);
            connection.setReadTimeout(60_000);
            if (connection.getResponseCode() != 200) {
                int status = connection.getResponseCode();
                connection.disconnect();
                throw new IOException("Core download HTTP " + status);
            }
        }
        long total = connection == null ? 0 : connection.getContentLengthLong();
        try (
            InputStream source = new BufferedInputStream(connection == null
                ? getContext().getAssets().open(assetPath) : connection.getInputStream());
            BufferedOutputStream output = new BufferedOutputStream(new FileOutputStream(temporary))
        ) {
            byte[] buffer = new byte[BUFFER_SIZE];
            int read;
            long loaded = 0;
            long lastUpdate = 0;
            while ((read = source.read(buffer)) >= 0) {
                if (read > 0) {
                    output.write(buffer, 0, read);
                    loaded += read;
                    if (connection != null && loaded - lastUpdate >= 1024 * 1024) {
                        JSObject progress = new JSObject();
                        progress.put("loaded", loaded);
                        progress.put("total", total);
                        notifyListeners("coreDownloadProgress", progress);
                        lastUpdate = loaded;
                    }
                }
            }
        } catch (IOException error) {
            deleteBestEffort(temporary);
            throw error;
        } finally {
            if (connection != null) connection.disconnect();
        }

        String actualSha256 = sha256(temporary);
        if (!expectedSha256.equals(actualSha256)) {
            deleteIfExists(temporary);
            throw new IOException("Packaged database checksum mismatch.");
        }

        deleteIfExists(validationMarker(target));
        boolean hadPreviousPack = target.isFile();
        if (hadPreviousPack && !target.renameTo(backup)) {
            deleteIfExists(temporary);
            throw new IOException("Unable to preserve the previous packaged database.");
        }

        try {
            if (!temporary.renameTo(target)) {
                throw new IOException("Unable to atomically install the packaged database.");
            }
            writeMarker(checksumMarker, expectedSha256);
        } catch (IOException error) {
            deleteBestEffort(target);
            if (hadPreviousPack && backup.isFile() && !backup.renameTo(target)) {
                throw new IOException(
                    "Pack installation failed and the previous database could not be restored.",
                    error
                );
            }
            throw error;
        } finally {
            deleteBestEffort(temporary);
        }

        deleteBestEffort(backup);
        return true;
    }

    private static void recoverInterruptedInstall(
        File target,
        File backup,
        File checksumMarker,
        String expectedSha256
    ) throws IOException {
        if (!target.exists() && backup.isFile()) {
            if (!backup.renameTo(target)) {
                throw new IOException("Unable to restore an interrupted packaged database update.");
            }
            return;
        }
        if (!target.exists() || !backup.exists()) return;

        String installedChecksum = readMarker(checksumMarker);
        if (expectedSha256.equals(installedChecksum)) {
            deleteIfExists(backup);
            return;
        }

        deleteIfExists(target);
        if (!backup.renameTo(target)) {
            throw new IOException("Unable to restore the previous packaged database after interruption.");
        }
    }

    private static void appendInFilter(
        List<String> clauses,
        List<String> arguments,
        String column,
        JSArray values
    ) throws JSONException {
        if (values == null || values.length() == 0) return;
        StringBuilder placeholders = new StringBuilder();
        for (int index = 0; index < values.length(); index++) {
            String value = values.getString(index);
            if (value == null || value.isEmpty()) continue;
            if (placeholders.length() > 0) placeholders.append(", ");
            placeholders.append("?");
            arguments.add(value);
        }
        if (placeholders.length() > 0) clauses.add(column + " IN (" + placeholders + ")");
    }

    private static final class VectorHit {
        final String chunkId;
        final double score;

        VectorHit(String chunkId, double score) {
            this.chunkId = chunkId;
            this.score = score;
        }
    }

    private boolean probeFts5() {
        try (Cursor cursor = requireDatabase().rawQuery(
            "SELECT count(*) FROM chunks_fts WHERE chunks_fts MATCH ?",
            new String[] { "localmed" }
        )) {
            return cursor.moveToFirst();
        } catch (SQLiteException error) {
            return false;
        }
    }

    private JSArray contentPackIds() {
        JSArray result = new JSArray();
        try (Cursor cursor = requireDatabase().rawQuery("SELECT id FROM content_packs ORDER BY id", null)) {
            while (cursor.moveToNext()) result.put(cursor.getString(0));
        }
        return result;
    }

    private String scalarString(String sql) {
        try (Cursor cursor = requireDatabase().rawQuery(sql, null)) {
            if (!cursor.moveToFirst() || cursor.isNull(0)) {
                throw new SQLiteException("Expected a scalar result for: " + sql);
            }
            return cursor.getString(0);
        }
    }

    private long scalarLong(String sql) {
        try (Cursor cursor = requireDatabase().rawQuery(sql, null)) {
            if (!cursor.moveToFirst() || cursor.isNull(0)) {
                throw new SQLiteException("Expected a scalar result for: " + sql);
            }
            return cursor.getLong(0);
        }
    }

    private SQLiteDatabase requireDatabase() {
        if (database == null || !database.isOpen()) {
            throw new IllegalStateException("The packaged LocalMed database is not open.");
        }
        return database;
    }

    private void closeDatabase() {
        if (database != null && database.isOpen()) database.close();
        database = null;
    }

    private static void putCursorValue(JSObject row, String name, Cursor cursor, int column)
        throws JSONException {
        switch (cursor.getType(column)) {
            case Cursor.FIELD_TYPE_NULL:
                row.put(name, JSONObject.NULL);
                break;
            case Cursor.FIELD_TYPE_INTEGER:
                row.put(name, cursor.getLong(column));
                break;
            case Cursor.FIELD_TYPE_FLOAT:
                row.put(name, cursor.getDouble(column));
                break;
            case Cursor.FIELD_TYPE_STRING:
                row.put(name, cursor.getString(column));
                break;
            case Cursor.FIELD_TYPE_BLOB:
                throw new SQLiteException("BLOB columns are not exposed by the LocalMed bridge.");
            default:
                throw new SQLiteException("Unsupported SQLite column type.");
        }
    }

    private static boolean isSafeAssetPath(String assetPath) {
        return assetPath != null
            && assetPath.startsWith("public/content/")
            && !assetPath.contains("..")
            && !assetPath.contains("\\")
            && assetPath.length() <= 240;
    }

    private static boolean isReadOnlyQuery(String sql) {
        if (sql == null) return false;
        String trimmed = sql.trim();
        if (!READ_QUERY.matcher(trimmed).find()) return false;
        return !trimmed.contains(";") && !trimmed.contains("--") && !trimmed.contains("/*");
    }

    private static String normalizeChecksum(String value) {
        if (value == null) return null;
        String normalized = value.trim().toLowerCase(Locale.ROOT);
        return normalized.startsWith("sha256:") ? normalized.substring(7) : normalized;
    }

    private static String sha256(File file) throws IOException, NoSuchAlgorithmException {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (BufferedInputStream input = new BufferedInputStream(new FileInputStream(file))) {
            byte[] buffer = new byte[BUFFER_SIZE];
            int read;
            while ((read = input.read(buffer)) >= 0) {
                if (read > 0) digest.update(buffer, 0, read);
            }
        }
        StringBuilder result = new StringBuilder(64);
        for (byte value : digest.digest()) result.append(String.format(Locale.ROOT, "%02x", value));
        return result.toString();
    }

    private static void ensureDirectory(File directory) throws IOException {
        if (!directory.isDirectory() && !directory.mkdirs()) {
            throw new IOException("Unable to create native content directory.");
        }
    }

    private static void deleteIfExists(File file) throws IOException {
        if (file.exists() && !file.delete()) {
            throw new IOException("Unable to remove stale native database file: " + file.getName());
        }
    }

    private static void deleteBestEffort(File file) {
        if (file.exists()) file.delete();
    }

    private static String readMarker(File marker) throws IOException {
        if (!marker.isFile()) return null;
        try (BufferedInputStream input = new BufferedInputStream(new FileInputStream(marker))) {
            byte[] bytes = new byte[(int) Math.min(marker.length(), 1024L)];
            int read = input.read(bytes);
            return read <= 0 ? null : new String(bytes, 0, read, StandardCharsets.US_ASCII).trim();
        }
    }

    private static void writeMarker(File marker, String checksum) throws IOException {
        File temporary = new File(marker.getParentFile(), marker.getName() + ".tmp");
        try (FileOutputStream output = new FileOutputStream(temporary, false)) {
            output.write((checksum + "\n").getBytes(StandardCharsets.US_ASCII));
            output.getFD().sync();
        }
        if (!temporary.renameTo(marker)) {
            deleteBestEffort(temporary);
            throw new IOException("Unable to commit database verification marker.");
        }
    }

    private static String safeMessage(Exception error) {
        String message = error.getMessage();
        return message == null || message.trim().isEmpty() ? error.getClass().getSimpleName() : message;
    }
}
