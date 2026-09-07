package dev.localmed.search;

/** Identity of an immutable SHA-256 and quick_check-verified edition. Bump when validation changes. */
final class PackValidationIdentity {
    private PackValidationIdentity() {}

    static String create(String checksum, String sqliteVersion, long device, long inode,
                         long changeTime, long modifiedMillis, long size) {
        return "verified-sqlcipher-v3:" + checksum + ":" + sqliteVersion + ":" + device + ":" + inode
            + ":" + changeTime + ":" + modifiedMillis + ":" + size;
    }
}
