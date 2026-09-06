package dev.localmed.search;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotEquals;
import org.junit.Test;

public class PackValidationIdentityTest {
    @Test public void identicalVerifiedEditionCanReuseStamp() {
        assertEquals(identity("sha", "3.50", 1, 2, 3, 4, 5), identity("sha", "3.50", 1, 2, 3, 4, 5));
    }
    @Test public void everyIdentityComponentInvalidatesStamp() {
        String before = identity("sha", "3.50", 1, 2, 3, 4, 5);
        assertNotEquals(before, identity("migration-sha", "3.50", 1, 2, 3, 4, 5));
        assertNotEquals(before, identity("sha", "3.51", 1, 2, 3, 4, 5));
        assertNotEquals(before, identity("sha", "3.50", 2, 2, 3, 4, 5));
        assertNotEquals(before, identity("sha", "3.50", 1, 9, 3, 4, 5));
        assertNotEquals(before, identity("sha", "3.50", 1, 2, 9, 4, 5));
        assertNotEquals(before, identity("sha", "3.50", 1, 2, 3, 9, 5));
        assertNotEquals(before, identity("sha", "3.50", 1, 2, 3, 4, 9));
    }
    private static String identity(String sha, String sqlite, long device, long inode,
                                   long ctime, long mtime, long size) {
        return PackValidationIdentity.create(sha, sqlite, device, inode, ctime, mtime, size);
    }
}
