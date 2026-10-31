package dev.localmed.search

import android.app.Activity
import android.hardware.biometrics.BiometricManager
import android.hardware.biometrics.BiometricPrompt
import android.os.Build
import android.os.CancellationSignal
import android.util.Log
import androidx.annotation.RequiresApi

/**
 * The system fingerprint / face / device-PIN prompt in front of the patient vault key, using the
 * framework BiometricPrompt (no extra library). Device credentials are allowed, so a phone without
 * an enrolled fingerprint still asks for its PIN, pattern or password. One prompt at a time: calls
 * that arrive while it is open wait for the same answer.
 */
@RequiresApi(Build.VERSION_CODES.Q)
internal class PatientVaultAuthPrompt(private val activity: Activity) {
    private companion object {
        const val TAG = "PatientVaultAuthPrompt"
    }

    private val lock = Any()
    private val waiting = ArrayList<(PatientVaultAuthPolicy.PromptFailure?) -> Unit>()
    private var showing = false

    /** `onDone(null)` means the person authenticated; otherwise the reason the prompt ended. */
    fun authenticate(onDone: (PatientVaultAuthPolicy.PromptFailure?) -> Unit) {
        val start: Boolean
        synchronized(lock) {
            waiting.add(onDone)
            start = !showing
            showing = true
        }
        if (!start) return
        activity.runOnUiThread {
            try {
                show()
            } catch (cause: Exception) {
                // Never silent: a missing permission once made every prompt fail without a trace.
                Log.w(TAG, "The vault prompt could not be shown: ${cause.javaClass.simpleName}", cause)
                finish(PatientVaultAuthPolicy.PromptFailure.FAILED)
            }
        }
    }

    private fun show() {
        val builder = BiometricPrompt.Builder(activity)
            .setTitle("Хранилище пациентов")
            .setSubtitle("Подтвердите, что это вы")
            .setConfirmationRequired(false)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            builder.setAllowedAuthenticators(
                BiometricManager.Authenticators.BIOMETRIC_STRONG or
                    BiometricManager.Authenticators.DEVICE_CREDENTIAL,
            )
        } else {
            @Suppress("DEPRECATION")
            builder.setDeviceCredentialAllowed(true)
        }
        builder.build().authenticate(
            CancellationSignal(),
            activity.mainExecutor,
            object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                    finish(null)
                }

                override fun onAuthenticationError(errorCode: Int, errString: CharSequence?) {
                    finish(PatientVaultAuthPolicy.classifyPromptError(errorCode))
                }
            },
        )
    }

    private fun finish(failure: PatientVaultAuthPolicy.PromptFailure?) {
        val callbacks: List<(PatientVaultAuthPolicy.PromptFailure?) -> Unit>
        synchronized(lock) {
            callbacks = ArrayList(waiting)
            waiting.clear()
            showing = false
        }
        for (callback in callbacks) callback(failure)
    }
}
