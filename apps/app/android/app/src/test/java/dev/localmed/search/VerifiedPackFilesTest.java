package dev.localmed.search;

import static org.junit.Assert.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.util.HexFormat;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

public class VerifiedPackFilesTest {
    @Rule public TemporaryFolder folder = new TemporaryFolder();

    @Test public void verifiedReplacementInvalidatesStampAndPreservesChecksum() throws Exception {
        File target = folder.newFile("core.db");
        File marker = folder.newFile("core.db.sha256");
        File stamp = folder.newFile("core.db.validated");
        Files.write(target.toPath(), "old".getBytes(StandardCharsets.UTF_8));
        byte[] bytes = "verified new core".getBytes(StandardCharsets.UTF_8);
        String checksum = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
        VerifiedPackFiles.install(new ByteArrayInputStream(bytes), target, marker, stamp, checksum);
        assertArrayEquals(bytes, Files.readAllBytes(target.toPath()));
        assertEquals(checksum, new String(Files.readAllBytes(marker.toPath()), StandardCharsets.UTF_8).trim());
        assertFalse(stamp.exists());
        assertFalse(new File(folder.getRoot(), "core.db.backup").exists());
    }

    @Test public void corruptionDoesNotReplaceCurrentEdition() throws Exception {
        File target = folder.newFile("core.db");
        File marker = folder.newFile("core.db.sha256");
        File stamp = folder.newFile("core.db.validated");
        Files.write(target.toPath(), "old".getBytes(StandardCharsets.UTF_8));
        Files.write(marker.toPath(), "prior-checksum".getBytes(StandardCharsets.UTF_8));
        assertThrows(IOException.class, () -> VerifiedPackFiles.install(
            new ByteArrayInputStream(new byte[] {1, 2}), target, marker, stamp, "0".repeat(64)));
        assertEquals("old", new String(Files.readAllBytes(target.toPath()), StandardCharsets.UTF_8));
        assertEquals("prior-checksum", new String(Files.readAllBytes(marker.toPath()), StandardCharsets.UTF_8));
        assertTrue(stamp.exists());
        assertFalse(new File(folder.getRoot(), "core.db.tmp").exists());
    }

    @Test public void interruptedTransferDoesNotPublishPartialFile() throws Exception {
        File target = new File(folder.getRoot(), "core.db");
        InputStream failing = new InputStream() {
            @Override public int read() throws IOException { throw new IOException("network interrupted"); }
        };
        assertThrows(IOException.class, () -> VerifiedPackFiles.install(failing, target,
            new File(folder.getRoot(), "core.db.sha256"), new File(folder.getRoot(), "core.db.validated"), "0".repeat(64)));
        assertFalse(target.exists());
        assertFalse(new File(folder.getRoot(), "core.db.sha256").exists());
        assertFalse(new File(folder.getRoot(), "core.db.tmp").exists());
    }
}
