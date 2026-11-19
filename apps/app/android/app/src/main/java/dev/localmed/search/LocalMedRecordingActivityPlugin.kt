package dev.localmed.search

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.ActivityNotFoundException
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
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

    @PluginMethod
    fun notificationSettings(call: PluginCall) {
        val supported = Build.VERSION.SDK_INT >= 36
        call.resolve(JSObject()
            .put("notificationsEnabled", manager.areNotificationsEnabled())
            .put("recordingSupported", supported)
            .put("promotionEnabled", supported && manager.canPostPromotedNotifications())
            .put("recordingChannelBlocked", supported &&
                manager.getNotificationChannel(CHANNEL)?.importance == NotificationManager.IMPORTANCE_NONE))
    }

    @PluginMethod
    fun openNotificationSettings(call: PluginCall) {
        val recording = when (call.getString("kind")) {
            "app" -> false
            "recording" -> true
            else -> {
                call.reject("Invalid notification settings type")
                return
            }
        }
        handler.post {
            val packageName = context.packageName
            val actions = mutableListOf<Intent>()
            if (recording && Build.VERSION.SDK_INT >= 36) {
                val target = if (manager.getNotificationChannel(CHANNEL)?.importance ==
                    NotificationManager.IMPORTANCE_NONE
                ) {
                    Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS)
                        .putExtra(Settings.EXTRA_CHANNEL_ID, CHANNEL)
                } else {
                    Intent(Settings.ACTION_APP_NOTIFICATION_PROMOTION_SETTINGS)
                }
                actions.add(target.putExtra(Settings.EXTRA_APP_PACKAGE, packageName))
            }
            if (Build.VERSION.SDK_INT >= 26) {
                actions.add(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                    .putExtra(Settings.EXTRA_APP_PACKAGE, packageName))
            }
            actions.add(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", packageName, null)))
            for (intent in actions) {
                try {
                    context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                    call.resolve()
                    return@post
                } catch (_: ActivityNotFoundException) {
                    continue
                } catch (_: SecurityException) {
                    continue
                }
            }
            call.reject("Unable to open notification settings")
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
                context, NOTIFICATION, Intent(context, MainActivity::class.java)
                    .setAction(openAction)
                    .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
            val delete = PendingIntent.getBroadcast(
                context, NOTIFICATION, Intent(dismissAction).setPackage(context.packageName),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
            val notification = NotificationCompat.Builder(context, CHANNEL)
                .setSmallIcon(android.R.drawable.ic_btn_speak_now)
                .setColor(if (paused) Color.rgb(110, 105, 97) else Color.rgb(200, 64, 46))
                .setContentTitle(if (paused) "Пауза" else "Запись")
                .setContentIntent(open)
                .addAction(0, "Открыть запись", open)
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
    private val openAction get() = "${context.packageName}.OPEN_RECORDING"

    override fun handleOnNewIntent(intent: Intent) {
        // Some system chips bring the app forward with its launcher intent instead of the content intent.
        val promotedRelaunch = intent.action == Intent.ACTION_MAIN &&
            intent.hasCategory(Intent.CATEGORY_LAUNCHER) && isPromoted()
        if (intent.action == openAction || promotedRelaunch) {
            notifyListeners("openRecording", JSObject())
        }
    }

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
