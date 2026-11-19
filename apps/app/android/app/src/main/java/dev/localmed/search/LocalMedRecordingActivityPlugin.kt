package dev.localmed.search

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

@CapacitorPlugin(name = "LocalMedRecordingActivity")
class LocalMedRecordingActivityPlugin : Plugin() {
    private val handler = Handler(Looper.getMainLooper())
    private val manager get() = context.getSystemService(NotificationManager::class.java)
    private var active = false
    private var registered = false
    private var dismissedByUser = false
    private val dismissed = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            active = false
            dismissedByUser = true
            notifyListeners("presentationChanged", presentation(false))
        }
    }

    @PluginMethod
    fun update(call: PluginCall) {
        val state = call.getString("state")
        if (state !in listOf("recording", "paused", "ended")) {
            call.reject("Invalid recording state")
            return
        }
        val elapsed = (call.getLong("elapsedMs") ?: 0L).coerceAtLeast(0L)
        handler.post {
            if (state == "ended") dismissedByUser = false
            if (Build.VERSION.SDK_INT < 36 || state == "ended" || dismissedByUser) {
                clear()
                call.resolve(presentation(false))
            } else {
                post(call, state == "paused", elapsed)
            }
        }
    }

    private fun post(call: PluginCall, paused: Boolean, elapsed: Long) {
        if (Build.VERSION.SDK_INT < 36 ||
            !manager.areNotificationsEnabled() || !manager.canPostPromotedNotifications()
        ) {
            clear()
            call.resolve(presentation(false))
            return
        }
        try {
            if (!registered) {
                ContextCompat.registerReceiver(
                    context, dismissed, IntentFilter(dismissAction),
                    ContextCompat.RECEIVER_NOT_EXPORTED,
                )
                registered = true
            }
            manager.createNotificationChannel(
                NotificationChannel(CHANNEL, "Запись беседы", NotificationManager.IMPORTANCE_LOW)
            )
            val open = PendingIntent.getActivity(
                context, NOTIFICATION, Intent(Intent.ACTION_VIEW, Uri.parse("minimed-recording://open"),
                    context, MainActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
            val delete = PendingIntent.getBroadcast(
                context, NOTIFICATION, Intent(dismissAction).setPackage(context.packageName),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
            val notification = NotificationCompat.Builder(context, CHANNEL)
                .setSmallIcon(android.R.drawable.ic_btn_speak_now)
                .setContentTitle(if (paused) "Запись на паузе" else "Запись беседы")
                .setContentIntent(open)
                .setDeleteIntent(delete)
                .setWhen(System.currentTimeMillis() - elapsed)
                .setShowWhen(!paused)
                .setUsesChronometer(!paused)
                .setShortCriticalText(if (paused) "Пауза" else null)
                .setRequestPromotedOngoing(true)
                .setOnlyAlertOnce(true)
                .setOngoing(true)
                .setVisibility(Notification.VISIBILITY_PRIVATE)
                .setTimeoutAfter(8 * 60 * 60 * 1000L)
                .build()
            active = true
            manager.notify(NOTIFICATION, notification)
            confirmPromotion(call, 4)
        } catch (failure: RuntimeException) {
            clear()
            call.reject("Unable to show recording promotion", failure)
        }
    }

    private fun confirmPromotion(call: PluginCall, attemptsLeft: Int) {
        val promoted = isPromoted()
        if (promoted || !active || attemptsLeft == 0) {
            if (!promoted) clear()
            call.resolve(presentation(promoted))
        } else {
            handler.postDelayed({ confirmPromotion(call, attemptsLeft - 1) }, 125L)
        }
    }

    private fun isPromoted(): Boolean = Build.VERSION.SDK_INT >= 36 && active &&
        manager.activeNotifications.any {
            it.id == NOTIFICATION && it.notification.flags and Notification.FLAG_PROMOTED_ONGOING != 0
        }

    private fun presentation(presented: Boolean) = JSObject().put("presented", presented)

    private val dismissAction get() = "${context.packageName}.RECORDING_ACTIVITY_DISMISSED"

    private fun clear() {
        active = false
        manager.cancel(NOTIFICATION)
    }

    override fun handleOnResume() {
        if (active && !isPromoted()) {
            dismissedByUser = true
            clear()
            notifyListeners("presentationChanged", presentation(false))
        }
    }

    override fun handleOnDestroy() {
        handler.removeCallbacksAndMessages(null)
        clear()
        if (registered) context.unregisterReceiver(dismissed)
        super.handleOnDestroy()
    }

    companion object {
        private const val CHANNEL = "minimed-recording"
        private const val NOTIFICATION = 7301
    }
}
