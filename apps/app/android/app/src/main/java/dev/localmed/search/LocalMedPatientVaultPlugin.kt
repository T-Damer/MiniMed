package dev.localmed.search

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
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

/** Keeps only a non-exportable wrapping key in Android Keystore. */
@CapacitorPlugin(name = "LocalMedPatientVault")
class LocalMedPatientVaultPlugin : Plugin() {
    private companion object {
        const val KEY_ALIAS = "minimed.patient.vault.v3"
        const val LEGACY_KEY_ALIAS = "minimed.patient.vault.v2"
        const val DATA_KEY_BYTES = 32
        const val GCM_TAG_BITS = 128
    }

    @PluginMethod
    fun isAvailable(call: PluginCall) {
        try {
            val keyStore = KeyStore.getInstance("AndroidKeyStore")
            keyStore.load(null)
            call.resolve(JSObject().put("available", true))
        } catch (_: Exception) {
            call.resolve(JSObject().put("available", false))
        }
    }

    @PluginMethod
    fun wrapKey(call: PluginCall) {
        val raw = decodeKey(call, call.getString("keyBase64")) ?: return
        try {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey())
            call.resolve(
                JSObject()
                    .put("ivBase64", encode(cipher.iv))
                    .put("ciphertextBase64", encode(cipher.doFinal(raw))),
            )
        } catch (cause: Exception) {
            call.reject("Android Keystore не сохранил ключ: ${safeMessage(cause)}")
        } finally {
            raw.fill(0)
        }
    }

    @PluginMethod
    fun unwrapKey(call: PluginCall) {
        val wrapped = decodeWrappedKey(
            call,
            call.getString("ivBase64"),
            call.getString("ciphertextBase64"),
        ) ?: return
        try {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(
                Cipher.DECRYPT_MODE,
                getExistingKey(),
                GCMParameterSpec(GCM_TAG_BITS, wrapped.first),
            )
            val raw = cipher.doFinal(wrapped.second)
            if (raw.size != DATA_KEY_BYTES) throw IllegalStateException("Unexpected vault key length")
            call.resolve(JSObject().put("keyBase64", encode(raw)))
            raw.fill(0)
        } catch (cause: Exception) {
            call.reject("Android Keystore не открыл ключ: ${safeMessage(cause)}")
        }
    }

    @PluginMethod
    fun deleteKey(call: PluginCall) {
        try {
            val keyStore = KeyStore.getInstance("AndroidKeyStore")
            keyStore.load(null)
            for (alias in arrayOf(KEY_ALIAS, LEGACY_KEY_ALIAS)) {
                if (keyStore.containsAlias(alias)) keyStore.deleteEntry(alias)
            }
            call.resolve()
        } catch (cause: Exception) {
            call.reject("Не удалось удалить ключ Android Keystore: ${safeMessage(cause)}")
        }
    }

    private fun getOrCreateKey(): SecretKey {
        val keyStore = KeyStore.getInstance("AndroidKeyStore")
        keyStore.load(null)
        val existing = keyStore.getKey(KEY_ALIAS, null)
        if (existing is SecretKey) return existing
        if (keyStore.containsAlias(LEGACY_KEY_ALIAS)) keyStore.deleteEntry(LEGACY_KEY_ALIAS)
        val generator = KeyGenerator.getInstance(
            KeyProperties.KEY_ALGORITHM_AES,
            "AndroidKeyStore",
        )
        generator.init(
            KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .build(),
        )
        return generator.generateKey()
    }

    private fun getExistingKey(): SecretKey {
        val keyStore = KeyStore.getInstance("AndroidKeyStore")
        keyStore.load(null)
        return keyStore.getKey(KEY_ALIAS, null) as? SecretKey
            ?: throw IllegalStateException("Vault key is missing")
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
