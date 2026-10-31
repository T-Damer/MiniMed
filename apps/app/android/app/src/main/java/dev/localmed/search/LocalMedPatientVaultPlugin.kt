package dev.localmed.search

import android.app.KeyguardManager
import android.content.Context
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import android.security.keystore.UserNotAuthenticatedException
import android.util.Base64
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Keeps only non-exportable wrapping keys in Android Keystore; the patient vault data key itself
 * lives in JS memory while the vault is open (ADR-0016).
 *
 * Two wrapping keys exist, chosen per call by `protection`:
 * - `device` ([DEVICE_KEY_ALIAS]): usable while the phone is unlocked, no prompt. Every vault made
 *   before the fingerprint unlock is wrapped by it, and phones without a secure lock screen keep
 *   using it;
 * - `auth` ([AUTH_KEY_ALIAS]): usable only within [PatientVaultAuthPolicy.AUTH_VALIDITY_SECONDS]
 *   of a fingerprint / face / device-credential check. When Keystore refuses the key for lack of a
 *   recent check, the plugin shows the system prompt and retries once.
 *
 * The device key is never touched by the auth path. It goes away only through [retireLegacyKey],
 * which JS calls after the new wrapped key is stored and read back, and through [deleteKey].
 */
@CapacitorPlugin(name = "LocalMedPatientVault")
class LocalMedPatientVaultPlugin : Plugin() {
    private companion object {
        const val DEVICE_KEY_ALIAS = "minimed.patient.vault.v3"
        const val AUTH_KEY_ALIAS = "minimed.patient.vault.auth.v1"
        const val OLD_KEY_ALIAS = "minimed.patient.vault.v2"
        const val DATA_KEY_BYTES = 32
        const val GCM_TAG_BITS = 128
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val ERROR_KEY_INVALIDATED = "KEY_INVALIDATED"
    }

    private class VaultKeyMissingException(val protection: String) :
        IllegalStateException("Vault key is missing")

    private sealed interface Attempt {
        class Done(val value: JSObject) : Attempt

        object NeedsAuth : Attempt

        class Failed(val cause: Exception) : Attempt
    }

    private var authPrompt: Any? = null

    private fun deviceIsSecure(): Boolean {
        val keyguard = context.getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager
        return keyguard?.isDeviceSecure == true
    }

    private fun authSupported(): Boolean =
        PatientVaultAuthPolicy.authSupported(Build.VERSION.SDK_INT, deviceIsSecure())

    private fun keyStore(): KeyStore = KeyStore.getInstance("AndroidKeyStore").also { it.load(null) }

    @PluginMethod
    fun isAvailable(call: PluginCall) {
        try {
            keyStore()
            call.resolve(
                JSObject()
                    .put("available", true)
                    .put("authAvailable", authSupported()),
            )
        } catch (_: Exception) {
            call.resolve(JSObject().put("available", false).put("authAvailable", false))
        }
    }

    @PluginMethod
    fun wrapKey(call: PluginCall) {
        val protection = PatientVaultAuthPolicy.normalizeProtection(call.getString("protection"))
        if (protection == null) {
            call.reject("Неизвестная защита ключа хранилища.")
            return
        }
        val raw = decodeKey(call, call.getString("keyBase64")) ?: return
        execute(
            call,
            protection,
            "Android Keystore не сохранил ключ",
            operation = {
                val cipher = Cipher.getInstance(TRANSFORMATION)
                cipher.init(Cipher.ENCRYPT_MODE, wrappingKey(protection, create = true))
                JSObject()
                    .put("ivBase64", encode(cipher.iv))
                    .put("ciphertextBase64", encode(cipher.doFinal(raw)))
            },
            cleanup = { raw.fill(0) },
        )
    }

    @PluginMethod
    fun unwrapKey(call: PluginCall) {
        val protection = PatientVaultAuthPolicy.normalizeProtection(call.getString("protection"))
        if (protection == null) {
            call.reject("Неизвестная защита ключа хранилища.")
            return
        }
        val wrapped = decodeWrappedKey(
            call,
            call.getString("ivBase64"),
            call.getString("ciphertextBase64"),
        ) ?: return
        execute(
            call,
            protection,
            "Android Keystore не открыл ключ",
            operation = {
                val cipher = Cipher.getInstance(TRANSFORMATION)
                cipher.init(
                    Cipher.DECRYPT_MODE,
                    wrappingKey(protection, create = false),
                    GCMParameterSpec(GCM_TAG_BITS, wrapped.first),
                )
                val raw = cipher.doFinal(wrapped.second)
                try {
                    if (raw.size != DATA_KEY_BYTES) {
                        throw IllegalStateException("Unexpected vault key length")
                    }
                    JSObject().put("keyBase64", encode(raw))
                } finally {
                    raw.fill(0)
                }
            },
        )
    }

    /**
     * Removes the pre-fingerprint device key. Refused (retired = false) unless the auth key exists
     * on this phone; JS asks only after the auth-wrapped key is durably stored and read back.
     */
    @PluginMethod
    fun retireLegacyKey(call: PluginCall) {
        try {
            val store = keyStore()
            if (!PatientVaultAuthPolicy.mayRetireDeviceKey(store.containsAlias(AUTH_KEY_ALIAS))) {
                call.resolve(JSObject().put("retired", false))
                return
            }
            for (alias in arrayOf(DEVICE_KEY_ALIAS, OLD_KEY_ALIAS)) {
                if (store.containsAlias(alias)) store.deleteEntry(alias)
            }
            call.resolve(JSObject().put("retired", true))
        } catch (cause: Exception) {
            call.reject("Не удалось убрать прежний ключ Android Keystore: ${safeMessage(cause)}")
        }
    }

    /** Deletes every vault key; only for deleting the whole vault. */
    @PluginMethod
    fun deleteKey(call: PluginCall) {
        try {
            val store = keyStore()
            for (alias in arrayOf(AUTH_KEY_ALIAS, DEVICE_KEY_ALIAS, OLD_KEY_ALIAS)) {
                if (store.containsAlias(alias)) store.deleteEntry(alias)
            }
            call.resolve()
        } catch (cause: Exception) {
            call.reject("Не удалось удалить ключ Android Keystore: ${safeMessage(cause)}")
        }
    }

    /**
     * Runs one Keystore operation. With the auth key, a refusal for lack of a recent check shows
     * the system prompt and repeats the operation once; every other failure is reported as is.
     */
    private fun execute(
        call: PluginCall,
        protection: String,
        failureText: String,
        operation: () -> JSObject,
        cleanup: () -> Unit = {},
    ) {
        val first = attempt(operation)
        if (first !is Attempt.NeedsAuth || protection != PatientVaultAuthPolicy.PROTECTION_AUTH) {
            settle(call, first, failureText)
            cleanup()
            return
        }
        val host = activity
        if (host == null || Build.VERSION.SDK_INT < PatientVaultAuthPolicy.MIN_AUTH_SDK) {
            call.reject("Нет окна для подтверждения.", PatientVaultAuthPolicy.PromptFailure.UNAVAILABLE.code)
            cleanup()
            return
        }
        val prompt = promptFor(host)
        prompt.authenticate { failure ->
            if (failure != null) {
                call.reject(promptMessage(failure), failure.code)
            } else {
                settle(call, attempt(operation), failureText)
            }
            cleanup()
        }
    }

    private fun promptFor(host: android.app.Activity): PatientVaultAuthPrompt {
        synchronized(this) {
            val existing = authPrompt as? PatientVaultAuthPrompt
            if (existing != null) return existing
            return PatientVaultAuthPrompt(host).also { authPrompt = it }
        }
    }

    private fun attempt(operation: () -> JSObject): Attempt =
        try {
            Attempt.Done(operation())
        } catch (cause: Exception) {
            if (needsAuthentication(cause)) Attempt.NeedsAuth else Attempt.Failed(cause)
        }

    private fun needsAuthentication(cause: Throwable?): Boolean {
        var current = cause
        var depth = 0
        while (current != null && depth < 4) {
            if (current is UserNotAuthenticatedException) return true
            current = current.cause
            depth++
        }
        return false
    }

    private fun settle(call: PluginCall, outcome: Attempt, failureText: String) {
        when (outcome) {
            is Attempt.Done -> call.resolve(outcome.value)
            is Attempt.NeedsAuth ->
                call.reject(
                    "Подтверждение не засчитано. Попробуйте ещё раз.",
                    PatientVaultAuthPolicy.PromptFailure.FAILED.code,
                )
            is Attempt.Failed -> {
                val cause = outcome.cause
                if (cause is KeyPermanentlyInvalidatedException ||
                    (cause is VaultKeyMissingException &&
                        cause.protection == PatientVaultAuthPolicy.PROTECTION_AUTH)
                ) {
                    call.reject(
                        "Ключ хранилища больше недействителен: сменилась или снята блокировка экрана. " +
                            "Данные на месте, но открыть их можно только из резервной копии.",
                        ERROR_KEY_INVALIDATED,
                    )
                } else {
                    call.reject("$failureText: ${safeMessage(cause)}")
                }
            }
        }
    }

    private fun promptMessage(failure: PatientVaultAuthPolicy.PromptFailure): String =
        when (failure) {
            PatientVaultAuthPolicy.PromptFailure.CANCELLED -> "Хранилище закрыто: подтверждение отменено."
            PatientVaultAuthPolicy.PromptFailure.UNAVAILABLE ->
                "На устройстве нет блокировки экрана для подтверждения."
            PatientVaultAuthPolicy.PromptFailure.FAILED -> "Не удалось подтвердить. Попробуйте ещё раз."
        }

    private fun wrappingKey(protection: String, create: Boolean): SecretKey {
        val store = keyStore()
        val alias =
            if (protection == PatientVaultAuthPolicy.PROTECTION_AUTH) AUTH_KEY_ALIAS else DEVICE_KEY_ALIAS
        val existing = store.getKey(alias, null)
        if (existing is SecretKey) return existing
        if (!create) throw VaultKeyMissingException(protection)
        return if (protection == PatientVaultAuthPolicy.PROTECTION_AUTH) {
            createAuthKey()
        } else {
            createDeviceKey(store)
        }
    }

    private fun createDeviceKey(store: KeyStore): SecretKey {
        if (store.containsAlias(OLD_KEY_ALIAS)) store.deleteEntry(OLD_KEY_ALIAS)
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(
            KeyGenParameterSpec.Builder(
                DEVICE_KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .build(),
        )
        return generator.generateKey()
    }

    private fun createAuthKey(): SecretKey {
        if (!authSupported()) throw IllegalStateException("No secure lock screen")
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        val builder = KeyGenParameterSpec.Builder(
            AUTH_KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setUserAuthenticationRequired(true)
            // Adding a fingerprint must not make the vault unreadable.
            .setInvalidatedByBiometricEnrollment(false)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            builder.setUserAuthenticationParameters(
                PatientVaultAuthPolicy.AUTH_VALIDITY_SECONDS,
                KeyProperties.AUTH_BIOMETRIC_STRONG or KeyProperties.AUTH_DEVICE_CREDENTIAL,
            )
        } else {
            @Suppress("DEPRECATION")
            builder.setUserAuthenticationValidityDurationSeconds(
                PatientVaultAuthPolicy.AUTH_VALIDITY_SECONDS,
            )
        }
        generator.init(builder.build())
        return generator.generateKey()
    }

    private fun decodeKey(call: PluginCall, value: String?): ByteArray? {
        if (value == null) {
            call.reject("Отсутствует ключ хранилища.")
            return null
        }
        return try {
            Base64.decode(value, Base64.DEFAULT).also {
                if (it.size != DATA_KEY_BYTES) throw IllegalArgumentException()
            }
        } catch (_: Exception) {
            call.reject("Некорректный ключ хранилища.")
            null
        }
    }

    private fun decodeWrappedKey(
        call: PluginCall,
        ivValue: String?,
        ciphertextValue: String?,
    ): Pair<ByteArray, ByteArray>? {
        if (ivValue == null || ciphertextValue == null) {
            call.reject("Отсутствует обёртка ключа.")
            return null
        }
        return try {
            val iv = Base64.decode(ivValue, Base64.DEFAULT)
            val ciphertext = Base64.decode(ciphertextValue, Base64.DEFAULT)
            if (iv.size != 12 || ciphertext.size != DATA_KEY_BYTES + 16) throw IllegalArgumentException()
            iv to ciphertext
        } catch (_: Exception) {
            call.reject("Некорректная обёртка ключа.")
            null
        }
    }

    private fun encode(value: ByteArray): String = Base64.encodeToString(value, Base64.NO_WRAP)

    private fun safeMessage(cause: Exception): String = cause.message?.take(160) ?: "ошибка устройства"
}
