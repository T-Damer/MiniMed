package dev.localmed.search;

import java.io.File;
import net.zetetic.database.Logger;
import net.zetetic.database.NoopTarget;
import net.zetetic.database.sqlcipher.SQLiteDatabase;

/** Bundled engine only. Public content packs remain ordinary, unencrypted SQLite files. */
final class NativePackDatabase {
    private static boolean loaded;
    private NativePackDatabase() {}

    static synchronized void ensureLoaded() {
        if (loaded) return;
        System.loadLibrary("sqlcipher");
        // Native diagnostics belong to our phase-only logger, not SQL/query text or file paths.
        Logger.setTarget(new NoopTarget());
        loaded = true;
    }

    static SQLiteDatabase openReadOnly(File file) {
        ensureLoaded();
        // The published 4.17.0 overload uses an empty key and preserves the original error.
        // Never encrypt, migrate or recreate a published pack during an open.
        return SQLiteDatabase.openDatabase(file.getAbsolutePath(), null,
            SQLiteDatabase.OPEN_READONLY | SQLiteDatabase.NO_LOCALIZED_COLLATORS,
            (database, error) -> {
                // The library's default handler deletes corrupt files. Retain ours for atomic repair.
                throw error;
            });
    }
}
