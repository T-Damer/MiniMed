package dev.localmed.search;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Locale;

/** File-only transaction shared by bundled and system-downloaded cores. Never buffers a pack. */
final class VerifiedPackFiles {
    private VerifiedPackFiles() {}

    interface Progress { void phase(String phase); }

    static void install(InputStream source, File target, File marker, File validationMarker,
                        String expectedChecksum) throws IOException, NoSuchAlgorithmException {
        install(source, target, marker, validationMarker, expectedChecksum, phase -> {});
    }

    static void install(InputStream source, File target, File marker, File validationMarker,
                        String expectedChecksum, Progress progress) throws IOException, NoSuchAlgorithmException {
        if (!expectedChecksum.matches("[a-f0-9]{64}")) throw new IOException("Invalid checksum.");
        File temporary = new File(target.getParentFile(), target.getName() + ".tmp");
        File backup = new File(target.getParentFile(), target.getName() + ".backup");
        File markerTemporary = new File(marker.getParentFile(), marker.getName() + ".tmp");
        if (backup.exists()) throw new IOException("Recover the interrupted installation first.");
        remove(temporary);
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try {
            progress.phase("verifying");
            try (FileOutputStream output = new FileOutputStream(temporary)) {
                byte[] buffer = new byte[64 * 1024];
                int count;
                while ((count = source.read(buffer)) != -1) {
                    if (count == 0) continue;
                    digest.update(buffer, 0, count);
                    output.write(buffer, 0, count);
                }
                output.getFD().sync();
            }
            StringBuilder actual = new StringBuilder(64);
            for (byte value : digest.digest()) actual.append(String.format(Locale.ROOT, "%02x", value));
            if (!expectedChecksum.contentEquals(actual)) throw new IOException("Core checksum mismatch.");
            progress.phase("installing");
            // Prepare durable metadata before moving either of the current installation's files.
            try (FileOutputStream output = new FileOutputStream(markerTemporary)) {
                output.write((expectedChecksum + "\n").getBytes(StandardCharsets.US_ASCII));
                output.getFD().sync();
            }
            remove(validationMarker);
            boolean hadPrevious = target.isFile();
            if (hadPrevious && !target.renameTo(backup)) throw new IOException("Cannot preserve prior core.");
            boolean replaced = false;
            try {
                if (!temporary.renameTo(target)) throw new IOException("Cannot commit verified core.");
                replaced = true;
                if (!markerTemporary.renameTo(marker)) throw new IOException("Cannot commit checksum marker.");
            } catch (IOException error) {
                if (replaced && target.exists() && !target.delete()) {
                    error.addSuppressed(new IOException("Cannot remove failed replacement."));
                }
                if (hadPrevious && !backup.renameTo(target)) {
                    error.addSuppressed(new IOException("Prior core remains in recovery backup."));
                }
                throw error;
            }
            remove(backup);
        } finally {
            remove(temporary);
            remove(markerTemporary);
        }
    }

    private static void remove(File file) throws IOException {
        if (file.exists() && !file.delete()) throw new IOException("Cannot remove transaction file.");
    }
}
