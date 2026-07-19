import Capacitor
import CryptoKit
import Foundation
import SQLite3

private let sqliteTransient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

@objc(LocalMedDatabasePlugin)
public final class LocalMedDatabasePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "LocalMedDatabasePlugin"
    public let jsName = "LocalMedDatabase"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "openPack", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "query", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "searchVectors", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "close", returnType: CAPPluginReturnPromise),
    ]

    private let databaseLock = NSLock()
    private var database: OpaquePointer?

    @objc public func openPack(_ call: CAPPluginCall) {
        guard let assetPath = call.getString("assetPath"), isSafeAssetPath(assetPath) else {
            call.reject("Invalid packaged database asset path.")
            return
        }
        guard let databaseName = call.getString("databaseName"), isSafeFileName(databaseName) else {
            call.reject("Invalid packaged database file name.")
            return
        }
        guard
            let expectedValue = call.getString("expectedSha256"),
            let expectedSha256 = normalizeChecksum(expectedValue),
            expectedSha256.count == 64
        else {
            call.reject("A SHA-256 checksum is required for the packaged database.")
            return
        }

        databaseLock.lock()
        defer { databaseLock.unlock() }

        do {
            closeDatabase()
            guard let sourceURL = Bundle.main.resourceURL?.appendingPathComponent(assetPath) else {
                throw LocalMedNativeError.assetMissing(assetPath)
            }
            guard FileManager.default.fileExists(atPath: sourceURL.path) else {
                throw LocalMedNativeError.assetMissing(assetPath)
            }

            let applicationSupport = try FileManager.default.url(
                for: .applicationSupportDirectory,
                in: .userDomainMask,
                appropriateFor: nil,
                create: true
            )
            let contentDirectory = applicationSupport.appendingPathComponent(
                "LocalMed/content",
                isDirectory: true
            )
            try FileManager.default.createDirectory(
                at: contentDirectory,
                withIntermediateDirectories: true
            )
            let targetURL = contentDirectory.appendingPathComponent(databaseName)
            let markerURL = contentDirectory.appendingPathComponent("\(databaseName).sha256")
            let copied = try installAssetIfNeeded(
                sourceURL: sourceURL,
                targetURL: targetURL,
                markerURL: markerURL,
                expectedSha256: expectedSha256
            )
            var resourceValues = URLResourceValues()
            resourceValues.isExcludedFromBackup = true
            var installedURL = targetURL
            try? installedURL.setResourceValues(resourceValues)

            var opened: OpaquePointer?
            let openCode = sqlite3_open_v2(
                targetURL.path,
                &opened,
                SQLITE_OPEN_READONLY | SQLITE_OPEN_NOMUTEX,
                nil
            )
            guard openCode == SQLITE_OK, let opened else {
                if let opened { sqlite3_close_v2(opened) }
                throw LocalMedNativeError.sqlite(message: "Unable to open native SQLite database.")
            }
            database = opened

            let integrity = try scalarString("PRAGMA quick_check")
            guard integrity.lowercased() == "ok" else {
                throw LocalMedNativeError.sqlite(
                    message: "Packaged database integrity check failed: \(integrity)"
                )
            }
            guard probeFts5() else {
                throw LocalMedNativeError.sqlite(
                    message: "The system SQLite runtime cannot query the FTS5 index."
                )
            }

            let attributes = try FileManager.default.attributesOfItem(atPath: targetURL.path)
            let sizeBytes = (attributes[.size] as? NSNumber)?.int64Value ?? 0
            let packRows = try queryRows(
                sql: "SELECT id FROM content_packs ORDER BY id",
                arguments: []
            )
            let contentPackIds = packRows.compactMap { $0["id"] as? String }

            call.resolve([
                "schemaVersion": try scalarInt64(
                    "SELECT CAST(value AS INTEGER) FROM app_metadata WHERE key = 'schema_version'"
                ),
                "sqliteVersion": try scalarString("SELECT sqlite_version()"),
                "fts5Available": true,
                "contentPackIds": contentPackIds,
                "documentCount": try scalarInt64("SELECT count(*) FROM documents"),
                "databasePath": targetURL.path,
                "copied": copied,
                "sizeBytes": sizeBytes,
            ])
        } catch {
            closeDatabase()
            call.reject("Unable to open the packaged LocalMed database: \(error.localizedDescription)")
        }
    }

    @objc public func query(_ call: CAPPluginCall) {
        guard let sql = call.getString("sql"), isReadOnlyQuery(sql) else {
            call.reject("Only a single read-only SELECT or WITH query is allowed.")
            return
        }

        let argsJson = call.getString("argsJson") ?? "[]"
        databaseLock.lock()
        defer { databaseLock.unlock() }

        do {
            let data = Data(argsJson.utf8)
            let decoded = try JSONSerialization.jsonObject(with: data)
            guard let arguments = decoded as? [Any] else {
                throw LocalMedNativeError.invalidArguments
            }
            call.resolve(["rows": try queryRows(sql: sql, arguments: arguments)])
        } catch {
            call.reject("Native SQLite query failed: \(error.localizedDescription)")
        }
    }

    @objc public func searchVectors(_ call: CAPPluginCall) {
        guard let profileId = call.getString("profileId"), !profileId.isEmpty else {
            call.reject("An embedding profile id is required.")
            return
        }
        guard
            let vectorBase64 = call.getString("vectorBase64"),
            let queryVector = Data(base64Encoded: vectorBase64),
            (8 ... 8192).contains(queryVector.count)
        else {
            call.reject("A valid base64-encoded query vector is required.")
            return
        }
        guard let queryNorm = call.getDouble("vectorNorm"), queryNorm.isFinite, queryNorm > 0 else {
            call.reject("A positive finite query-vector norm is required.")
            return
        }

        let requestedLimit = call.getInt("limit") ?? 50
        let limit = max(1, min(requestedLimit, 500))
        let documentIds = call.getArray("documentIds", String.self) ?? []
        let sectionTypes = call.getArray("sectionTypes", String.self) ?? []

        databaseLock.lock()
        defer { databaseLock.unlock() }
        do {
            let hits = try vectorSearch(
                profileId: profileId,
                queryVector: queryVector,
                queryNorm: queryNorm,
                documentIds: documentIds,
                sectionTypes: sectionTypes,
                limit: limit
            )
            call.resolve([
                "hits": hits.map { ["chunkId": $0.chunkId, "score": $0.score] },
            ])
        } catch {
            call.reject("Native vector search failed: \(error.localizedDescription)")
        }
    }

    @objc public func close(_ call: CAPPluginCall) {
        databaseLock.lock()
        closeDatabase()
        databaseLock.unlock()
        call.resolve()
    }

    private func installAssetIfNeeded(
        sourceURL: URL,
        targetURL: URL,
        markerURL: URL,
        expectedSha256: String
    ) throws -> Bool {
        let fileManager = FileManager.default
        let temporaryURL = targetURL.appendingPathExtension("tmp")
        let backupURL = targetURL.appendingPathExtension("backup")
        try recoverInterruptedInstall(
            targetURL: targetURL,
            backupURL: backupURL,
            markerURL: markerURL,
            expectedSha256: expectedSha256
        )

        let installedChecksum = try? String(contentsOf: markerURL, encoding: .ascii)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if fileManager.fileExists(atPath: targetURL.path), installedChecksum == expectedSha256 {
            return false
        }

        try? fileManager.removeItem(at: temporaryURL)
        try fileManager.copyItem(at: sourceURL, to: temporaryURL)
        let actualSha256 = try sha256(url: temporaryURL)
        guard actualSha256 == expectedSha256 else {
            try? fileManager.removeItem(at: temporaryURL)
            throw LocalMedNativeError.checksumMismatch
        }

        let hadPreviousPack = fileManager.fileExists(atPath: targetURL.path)
        if hadPreviousPack {
            try fileManager.moveItem(at: targetURL, to: backupURL)
        }

        do {
            try fileManager.moveItem(at: temporaryURL, to: targetURL)
            try (expectedSha256 + "\n").write(to: markerURL, atomically: true, encoding: .ascii)
        } catch {
            try? fileManager.removeItem(at: targetURL)
            if hadPreviousPack, fileManager.fileExists(atPath: backupURL.path) {
                do {
                    try fileManager.moveItem(at: backupURL, to: targetURL)
                } catch {
                    throw LocalMedNativeError.restoreFailed
                }
            }
            throw error
        }

        try? fileManager.removeItem(at: backupURL)
        return true
    }

    private func recoverInterruptedInstall(
        targetURL: URL,
        backupURL: URL,
        markerURL: URL,
        expectedSha256: String
    ) throws {
        let fileManager = FileManager.default
        let targetExists = fileManager.fileExists(atPath: targetURL.path)
        let backupExists = fileManager.fileExists(atPath: backupURL.path)
        if !targetExists, backupExists {
            try fileManager.moveItem(at: backupURL, to: targetURL)
            return
        }
        guard targetExists, backupExists else { return }

        let installedChecksum = try? String(contentsOf: markerURL, encoding: .ascii)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if installedChecksum == expectedSha256 {
            try fileManager.removeItem(at: backupURL)
            return
        }

        try fileManager.removeItem(at: targetURL)
        try fileManager.moveItem(at: backupURL, to: targetURL)
    }

    private struct VectorHit {
        let chunkId: String
        let score: Double
    }

    private func vectorSearch(
        profileId: String,
        queryVector: Data,
        queryNorm: Double,
        documentIds: [String],
        sectionTypes: [String],
        limit: Int
    ) throws -> [VectorHit] {
        guard let database else { throw LocalMedNativeError.databaseClosed }
        var clauses = ["ce.profile_id = ?"]
        var arguments: [Any] = [profileId]
        appendInFilter(column: "d.id", values: documentIds, clauses: &clauses, arguments: &arguments)
        appendInFilter(
            column: "s.section_type",
            values: sectionTypes,
            clauses: &clauses,
            arguments: &arguments
        )
        let sql = """
        SELECT ce.chunk_id, ce.vector, ce.vector_norm
        FROM chunk_embeddings ce
        JOIN chunks c ON c.id = ce.chunk_id
        JOIN sections s ON s.id = c.section_id
        JOIN document_versions dv ON dv.id = c.document_version_id
        JOIN documents d ON d.id = dv.document_id
        WHERE \(clauses.joined(separator: " AND "))
        """

        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(database, sql, -1, &statement, nil) == SQLITE_OK, let statement else {
            throw sqliteError(database)
        }
        defer { sqlite3_finalize(statement) }
        for (offset, value) in arguments.enumerated() {
            try bind(value, to: statement, index: Int32(offset + 1), database: database)
        }

        var hits: [VectorHit] = []
        while true {
            let step = sqlite3_step(statement)
            if step == SQLITE_DONE { break }
            guard step == SQLITE_ROW else { throw sqliteError(database) }
            guard
                let rawChunkId = sqlite3_column_text(statement, 0),
                let rawVector = sqlite3_column_blob(statement, 1)
            else { continue }
            let vectorLength = Int(sqlite3_column_bytes(statement, 1))
            guard vectorLength == queryVector.count else { continue }
            let storedNorm = sqlite3_column_double(statement, 2)
            guard storedNorm.isFinite, storedNorm > 0 else { continue }

            let dot: Int64 = queryVector.withUnsafeBytes { queryBytes in
                let query = queryBytes.bindMemory(to: Int8.self)
                let storedBytes = UnsafeRawBufferPointer(start: rawVector, count: vectorLength)
                let stored = storedBytes.bindMemory(to: Int8.self)
                var value: Int64 = 0
                for index in 0 ..< vectorLength {
                    value += Int64(query[index]) * Int64(stored[index])
                }
                return value
            }
            let rawScore = Double(dot) / (queryNorm * storedNorm)
            guard rawScore.isFinite else { continue }
            hits.append(
                VectorHit(
                    chunkId: String(cString: rawChunkId),
                    score: max(-1, min(1, rawScore))
                )
            )
        }
        return Array(
            hits.sorted {
                if $0.score == $1.score { return $0.chunkId < $1.chunkId }
                return $0.score > $1.score
            }.prefix(limit)
        )
    }

    private func appendInFilter(
        column: String,
        values: [String],
        clauses: inout [String],
        arguments: inout [Any]
    ) {
        let filtered = values.filter { !$0.isEmpty }
        guard !filtered.isEmpty else { return }
        clauses.append(
            "\(column) IN (\(Array(repeating: "?", count: filtered.count).joined(separator: ", ")))"
        )
        arguments.append(contentsOf: filtered)
    }

    private func queryRows(sql: String, arguments: [Any]) throws -> [[String: Any]] {
        guard let database else { throw LocalMedNativeError.databaseClosed }
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(database, sql, -1, &statement, nil) == SQLITE_OK, let statement else {
            throw sqliteError(database)
        }
        defer { sqlite3_finalize(statement) }

        for (offset, value) in arguments.enumerated() {
            try bind(value, to: statement, index: Int32(offset + 1), database: database)
        }

        var rows: [[String: Any]] = []
        while true {
            let step = sqlite3_step(statement)
            if step == SQLITE_DONE { break }
            guard step == SQLITE_ROW else { throw sqliteError(database) }

            var row: [String: Any] = [:]
            for column in 0 ..< sqlite3_column_count(statement) {
                guard let rawName = sqlite3_column_name(statement, column) else { continue }
                let name = String(cString: rawName)
                switch sqlite3_column_type(statement, column) {
                case SQLITE_NULL:
                    row[name] = NSNull()
                case SQLITE_INTEGER:
                    row[name] = sqlite3_column_int64(statement, column)
                case SQLITE_FLOAT:
                    row[name] = sqlite3_column_double(statement, column)
                case SQLITE_TEXT:
                    if let rawText = sqlite3_column_text(statement, column) {
                        row[name] = String(cString: rawText)
                    } else {
                        row[name] = ""
                    }
                case SQLITE_BLOB:
                    throw LocalMedNativeError.sqlite(
                        message: "BLOB columns are not exposed by the LocalMed bridge."
                    )
                default:
                    throw LocalMedNativeError.sqlite(message: "Unsupported SQLite column type.")
                }
            }
            rows.append(row)
        }
        return rows
    }

    private func bind(
        _ value: Any,
        to statement: OpaquePointer,
        index: Int32,
        database: OpaquePointer
    ) throws {
        let code: Int32
        switch value {
        case is NSNull:
            code = sqlite3_bind_null(statement, index)
        case let value as String:
            code = value.withCString { pointer in
                sqlite3_bind_text(statement, index, pointer, -1, sqliteTransient)
            }
        case let value as NSNumber:
            let type = String(cString: value.objCType)
            if type == "f" || type == "d" {
                code = sqlite3_bind_double(statement, index, value.doubleValue)
            } else {
                code = sqlite3_bind_int64(statement, index, value.int64Value)
            }
        default:
            throw LocalMedNativeError.invalidArguments
        }
        guard code == SQLITE_OK else { throw sqliteError(database) }
    }

    private func scalarString(_ sql: String) throws -> String {
        guard let value = try queryRows(sql: sql, arguments: []).first?.values.first as? String else {
            throw LocalMedNativeError.sqlite(message: "Expected a scalar string result.")
        }
        return value
    }

    private func scalarInt64(_ sql: String) throws -> Int64 {
        guard let value = try queryRows(sql: sql, arguments: []).first?.values.first else {
            throw LocalMedNativeError.sqlite(message: "Expected a scalar integer result.")
        }
        if let value = value as? Int64 { return value }
        if let value = value as? NSNumber { return value.int64Value }
        throw LocalMedNativeError.sqlite(message: "Expected a scalar integer result.")
    }

    private func probeFts5() -> Bool {
        do {
            _ = try queryRows(
                sql: "SELECT count(*) FROM chunks_fts WHERE chunks_fts MATCH ?",
                arguments: ["localmed"]
            )
            return true
        } catch {
            return false
        }
    }

    private func closeDatabase() {
        if let database { sqlite3_close_v2(database) }
        database = nil
    }

    private func sqliteError(_ database: OpaquePointer) -> LocalMedNativeError {
        let message = sqlite3_errmsg(database).map { String(cString: $0) } ?? "Unknown SQLite error."
        return .sqlite(message: message)
    }

    private func sha256(url: URL) throws -> String {
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        var hasher = SHA256()
        while true {
            let data = try handle.read(upToCount: 64 * 1024) ?? Data()
            if data.isEmpty { break }
            hasher.update(data: data)
        }
        return hasher.finalize().map { String(format: "%02x", $0) }.joined()
    }

    private func isSafeAssetPath(_ value: String) -> Bool {
        value.hasPrefix("public/content/")
            && !value.contains("..")
            && !value.contains("\\")
            && value.count <= 240
    }

    private func isSafeFileName(_ value: String) -> Bool {
        value.range(of: "^[A-Za-z0-9._-]{1,120}$", options: .regularExpression) != nil
    }

    private func isReadOnlyQuery(_ value: String) -> Bool {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.range(of: "^(SELECT|WITH)\\b", options: [.regularExpression, .caseInsensitive]) != nil else {
            return false
        }
        return !trimmed.contains(";") && !trimmed.contains("--") && !trimmed.contains("/*")
    }

    private func normalizeChecksum(_ value: String) -> String? {
        let normalized = value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let checksum = normalized.hasPrefix("sha256:") ? String(normalized.dropFirst(7)) : normalized
        guard checksum.range(of: "^[0-9a-f]{64}$", options: .regularExpression) != nil else {
            return nil
        }
        return checksum
    }
}

private enum LocalMedNativeError: LocalizedError {
    case assetMissing(String)
    case checksumMismatch
    case databaseClosed
    case invalidArguments
    case restoreFailed
    case sqlite(message: String)

    var errorDescription: String? {
        switch self {
        case let .assetMissing(path):
            return "Packaged database asset is missing: \(path)"
        case .checksumMismatch:
            return "Packaged database checksum mismatch."
        case .databaseClosed:
            return "The packaged LocalMed database is not open."
        case .invalidArguments:
            return "Invalid native query arguments."
        case .restoreFailed:
            return "Pack installation failed and the previous database could not be restored."
        case let .sqlite(message):
            return message
        }
    }
}
