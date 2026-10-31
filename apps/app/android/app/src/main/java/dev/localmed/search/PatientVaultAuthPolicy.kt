package dev.localmed.search

/**
 * Decisions of the patient vault that need no Android framework, so they run in plain JVM tests.
 *
 * The vault data key is wrapped by one of two Keystore keys:
 * - `device`: the original key, usable whenever the phone is unlocked (kept for phones without a
 *   secure lock screen, and until an existing vault has been moved to the other key);
 * - `auth`: a key that can only be used within [AUTH_VALIDITY_SECONDS] of a fingerprint, face or
 *   device PIN/pattern check.
 */
internal object PatientVaultAuthPolicy {
    const val PROTECTION_DEVICE = "device"
    const val PROTECTION_AUTH = "auth"

    /** How long one successful check keeps the auth-bound key usable. */
    const val AUTH_VALIDITY_SECONDS = 300

    /**
     * The framework BiometricPrompt can offer the device PIN as a fallback from API 29 (before it
     * insists on a negative button), so phones below that keep the device-bound key.
     */
    const val MIN_AUTH_SDK = 29

    // Values of android.hardware.biometrics.BiometricPrompt.BIOMETRIC_ERROR_*.
    private const val ERROR_HW_UNAVAILABLE = 1
    private const val ERROR_CANCELED = 5
    private const val ERROR_USER_CANCELED = 10
    private const val ERROR_NO_BIOMETRICS = 11
    private const val ERROR_HW_NOT_PRESENT = 12
    private const val ERROR_NEGATIVE_BUTTON = 13
    private const val ERROR_NO_DEVICE_CREDENTIAL = 14

    /** Why a prompt ended without unlocking the key. */
    enum class PromptFailure(val code: String) {
        /** The person closed the prompt, or the app left the foreground. */
        CANCELLED("AUTH_CANCELLED"),

        /** There is nothing to authenticate with (the lock screen was removed). */
        UNAVAILABLE("AUTH_UNAVAILABLE"),

        /** Too many wrong attempts, a sensor fault or another error. */
        FAILED("AUTH_FAILED"),
    }

    fun authSupported(sdkInt: Int, deviceSecure: Boolean): Boolean =
        sdkInt >= MIN_AUTH_SDK && deviceSecure

    fun classifyPromptError(errorCode: Int): PromptFailure =
        when (errorCode) {
            ERROR_CANCELED, ERROR_USER_CANCELED, ERROR_NEGATIVE_BUTTON -> PromptFailure.CANCELLED
            ERROR_NO_BIOMETRICS, ERROR_HW_NOT_PRESENT, ERROR_NO_DEVICE_CREDENTIAL,
            ERROR_HW_UNAVAILABLE,
            -> PromptFailure.UNAVAILABLE
            else -> PromptFailure.FAILED
        }

    /** Only the two protections the JS side knows; anything else is a caller bug. */
    fun normalizeProtection(value: String?): String? =
        when (value) {
            null, PROTECTION_DEVICE -> PROTECTION_DEVICE
            PROTECTION_AUTH -> PROTECTION_AUTH
            else -> null
        }

    /**
     * The device key may be retired only once the auth-bound key exists on this phone: the JS side
     * confirms its own durable copy first, and this is the second lock on the same door.
     */
    fun mayRetireDeviceKey(authKeyExists: Boolean): Boolean = authKeyExists
}
