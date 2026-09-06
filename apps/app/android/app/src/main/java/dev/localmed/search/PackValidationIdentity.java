package dev.localmed.search;

/** Identity of an immutable, SHA-256 and quick_check-verified read-only edition.
 * Bump the verifier revision whenever validation or migration semantics change.
 * Install and recovery also explicitly delete the stamp before replacing a file.
 */
final class PackValidationIdentity {
    private PackValidationIdentity() {}

    static String create(String checksum, String sqliteVersion, long device, long inode,
                         long changeTime, long modifiedMillis, long size) {
        return "verified-requery-v2:" + checksum + ":" + sqliteVersion + ":" + device + ":" + inode
            + ":" + changeTime + ":" + modifiedMillis + ":" + size;
    }
}
