import Capacitor
import CryptoKit
import Foundation
import Security

/** Keeps only a device-bound wrapping key in Keychain. */
@objc(LocalMedPatientVaultPlugin)
public final class LocalMedPatientVaultPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "LocalMedPatientVaultPlugin"
    public let jsName = "LocalMedPatientVault"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "wrapKey", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "unwrapKey", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deleteKey", returnType: CAPPluginReturnPromise),
    ]

    private let service = "dev.localmed.search.patient-vault.v3"
    private let legacyService = "dev.localmed.search.patient-vault.v2"
    private let account = "wrapping-key"

    @objc public func isAvailable(_ call: CAPPluginCall) {
        var byte: UInt8 = 0
        call.resolve(["available": SecRandomCopyBytes(kSecRandomDefault, 1, &byte) == errSecSuccess])
    }

    @objc public func wrapKey(_ call: CAPPluginCall) {
        guard let value = call.getString("keyBase64"), let data = Data(base64Encoded: value), data.count == 32 else {
            call.reject("Некорректный ключ хранилища.")
            return
        }
        do {
            let wrappingKey = SymmetricKey(data: try loadOrCreateWrappingKey())
            let nonce = try Self.randomNonce()
            let sealed = try AES.GCM.seal(data, using: wrappingKey, nonce: nonce)
            call.resolve([
                "ivBase64": nonce.withUnsafeBytes { Data($0) }.base64EncodedString(),
                "ciphertextBase64": (sealed.ciphertext + sealed.tag).base64EncodedString(),
            ])
        } catch {
            call.reject("Keychain не сохранил ключ MiniMed: \(error.localizedDescription)")
        }
    }

    @objc public func unwrapKey(_ call: CAPPluginCall) {
        guard
            let ivValue = call.getString("ivBase64"),
            let ciphertextValue = call.getString("ciphertextBase64"),
            let iv = Data(base64Encoded: ivValue),
            let ciphertextWithTag = Data(base64Encoded: ciphertextValue),
            iv.count == 12,
            ciphertextWithTag.count == 48
        else {
            call.reject("Некорректная Keychain-обёртка ключа.")
            return
        }
        do {
            let box = try AES.GCM.SealedBox(
                nonce: AES.GCM.Nonce(data: iv),
                ciphertext: Data(ciphertextWithTag.dropLast(16)),
                tag: Data(ciphertextWithTag.suffix(16))
            )
            let data = try AES.GCM.open(box, using: SymmetricKey(data: try loadWrappingKey()))
            guard data.count == 32 else { throw VaultError.invalidKey }
            call.resolve(["keyBase64": data.base64EncodedString()])
        } catch {
            call.reject("Keychain не открыл ключ MiniMed: \(error.localizedDescription)")
        }
    }

    @objc public func deleteKey(_ call: CAPPluginCall) {
        do {
            try delete(service: service)
            try delete(service: legacyService)
            call.resolve()
        } catch {
            call.reject("Не удалось удалить ключ Keychain: \(error.localizedDescription)")
        }
    }

    private func loadWrappingKey() throws -> Data {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
        ]
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess, let data = result as? Data, data.count == 32 else {
            throw VaultError.keychain(status)
        }
        return data
    }

    private func loadOrCreateWrappingKey() throws -> Data {
        if let existing = try? loadWrappingKey() { return existing }
        try delete(service: legacyService)
        var bytes = Data(count: 32)
        let randomStatus = bytes.withUnsafeMutableBytes { buffer in
            SecRandomCopyBytes(kSecRandomDefault, buffer.count, buffer.baseAddress!)
        }
        guard randomStatus == errSecSuccess else { throw VaultError.random }
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecValueData as String: bytes,
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
        ]
        let status = SecItemAdd(query as CFDictionary, nil)
        guard status == errSecSuccess else { throw VaultError.keychain(status) }
        return bytes
    }

    private func delete(service: String) throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw VaultError.keychain(status)
        }
    }

    private enum VaultError: LocalizedError {
        case invalidKey
        case random
        case keychain(OSStatus)

        var errorDescription: String? {
            switch self {
            case .invalidKey: return "Некорректная длина ключа."
            case .random: return "Не удалось получить случайный ключ."
            case .keychain(let status): return "Ошибка Keychain (\(status))."
            }
        }
    }

    private static func randomNonce() throws -> AES.GCM.Nonce {
        var bytes = Data(count: 12)
        let status = bytes.withUnsafeMutableBytes { buffer in
            SecRandomCopyBytes(kSecRandomDefault, buffer.count, buffer.baseAddress!)
        }
        guard status == errSecSuccess else { throw VaultError.random }
        return try AES.GCM.Nonce(data: bytes)
    }
}
