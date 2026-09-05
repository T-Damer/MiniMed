package dev.localmed.search

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.os.PersistableBundle
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

internal object ApkUpdateRuntime {
    @Volatile
    private var sharedManager: ApkUpdateManager? = null

    fun manager(context: Context): ApkUpdateManager = synchronized(this) {
        sharedManager ?: ApkUpdateManager(context.applicationContext.filesDir).also { sharedManager = it }
    }
}

internal object ApkUpdateScheduler {
    const val EXTRA_TASK_ID = "dev.localmed.search.extra.APK_TASK_ID"
    private const val JOB_ID = 72401
    private const val JOB_BACKOFF_MS = 10_000L

    fun start(context: Context, taskId: String, expectedBytes: Long?) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            scheduleUserInitiatedJob(context, taskId, expectedBytes)
            return
        }
        val intent = Intent(context, ApkUpdateForegroundService::class.java)
            .putExtra(EXTRA_TASK_ID, taskId)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(intent)
        } else {
            context.startService(intent)
        }
    }

    fun cancel(context: Context) {
        context.getSystemService(JobScheduler::class.java).cancel(JOB_ID)
        context.stopService(Intent(context, ApkUpdateForegroundService::class.java))
    }

    private fun scheduleUserInitiatedJob(context: Context, taskId: String, expectedBytes: Long?) {
        val extras = PersistableBundle().apply { putString(EXTRA_TASK_ID, taskId) }
        val job = JobInfo.Builder(
            JOB_ID,
            ComponentName(context, ApkUpdateJobService::class.java),
        )
            .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
            .setUserInitiated(true)
            .setEstimatedNetworkBytes(expectedBytes ?: JobInfo.NETWORK_BYTES_UNKNOWN.toLong(), 0L)
            .setBackoffCriteria(JOB_BACKOFF_MS, JobInfo.BACKOFF_POLICY_EXPONENTIAL)
            .setExtras(extras)
            .build()
        val result = context.getSystemService(JobScheduler::class.java).schedule(job)
        if (result != JobScheduler.RESULT_SUCCESS) {
            throw ApkDownloadException("scheduling_failed", "Android could not start the APK download.")
        }
    }
}

internal object ApkUpdateNotifications {
    const val NOTIFICATION_ID = 72402
    private const val CHANNEL_ID = "apk-updates"
    private const val CANCEL_ACTION = "dev.localmed.search.action.CANCEL_APK_DOWNLOAD"

    fun createChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val channel = NotificationChannel(
            CHANNEL_ID,
            "Обновление MiniMed",
            NotificationManager.IMPORTANCE_LOW,
        ).apply {
            description = "Ход загрузки обновления приложения"
        }
        context.getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    fun build(context: Context, snapshot: ApkTaskSnapshot): Notification {
        val active = snapshot.state == ApkTaskState.DOWNLOADING || snapshot.state == ApkTaskState.VERIFYING
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(context, CHANNEL_ID)
        } else {
            Notification.Builder(context)
        }
        builder
            .setSmallIcon(android.R.drawable.stat_sys_download)
            .setContentTitle("Обновление MiniMed")
            .setContentText(contentText(snapshot))
            .setCategory(Notification.CATEGORY_PROGRESS)
            .setOnlyAlertOnce(true)
            .setOngoing(active)
            .setProgress(progressMaximum(snapshot), progressValue(snapshot), progressIndeterminate(snapshot))
        if (active) {
            builder.addAction(
                Notification.Action.Builder(
                    android.R.drawable.ic_menu_close_clear_cancel,
                    "Отменить",
                    cancelIntent(context, snapshot.taskId),
                ).build(),
            )
        }
        return builder.build()
    }

    fun update(context: Context, snapshot: ApkTaskSnapshot) {
        context.getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, build(context, snapshot))
    }

    fun clear(context: Context) {
        context.getSystemService(NotificationManager::class.java).cancel(NOTIFICATION_ID)
    }

    private fun cancelIntent(context: Context, taskId: String): PendingIntent =
        PendingIntent.getBroadcast(
            context,
            taskId.hashCode(),
            Intent(context, ApkUpdateCancelReceiver::class.java)
                .setAction(CANCEL_ACTION)
                .putExtra(ApkUpdateScheduler.EXTRA_TASK_ID, taskId),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

    private fun contentText(snapshot: ApkTaskSnapshot): String = when (snapshot.state) {
        ApkTaskState.DOWNLOADING -> "Загружаем обновление"
        ApkTaskState.VERIFYING -> "Проверяем файл обновления"
        ApkTaskState.READY -> "Обновление готово к установке"
        ApkTaskState.FAILED -> "Загрузка обновления прервана"
        ApkTaskState.CANCELLED -> "Загрузка обновления отменена"
    }

    private fun progressMaximum(snapshot: ApkTaskSnapshot): Int =
        snapshot.totalBytes?.takeIf { it > 0L }?.let { 100 } ?: 0

    private fun progressValue(snapshot: ApkTaskSnapshot): Int {
        val total = snapshot.totalBytes ?: return 0
        if (total <= 0L) return 0
        return ((snapshot.downloadedBytes * 100L) / total).toInt().coerceIn(0, 100)
    }

    private fun progressIndeterminate(snapshot: ApkTaskSnapshot): Boolean =
        snapshot.state == ApkTaskState.DOWNLOADING && snapshot.totalBytes == null
}

/** API 24–33 fallback. The user starts it from the visible update control. */
class ApkUpdateForegroundService : Service() {
    private val executor = Executors.newSingleThreadExecutor()
    private val started = AtomicBoolean(false)
    private var taskId: String? = null
    private var removeListener: (() -> Unit)? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val nextTaskId = intent?.getStringExtra(ApkUpdateScheduler.EXTRA_TASK_ID) ?: run {
            stopSelf(startId)
            return START_NOT_STICKY
        }
        taskId = nextTaskId
        val manager = ApkUpdateRuntime.manager(this)
        val snapshot = manager.statusOrNull(nextTaskId) ?: run {
            stopSelf(startId)
            return START_NOT_STICKY
        }
        ApkUpdateNotifications.createChannel(this)
        startForeground(ApkUpdateNotifications.NOTIFICATION_ID, ApkUpdateNotifications.build(this, snapshot))
        removeListener?.invoke()
        removeListener = manager.addListener { update ->
            if (update.taskId == nextTaskId) ApkUpdateNotifications.update(this, update)
        }
        if (started.compareAndSet(false, true)) {
            executor.execute { runTask(nextTaskId, startId) }
        }
        return START_REDELIVER_INTENT
    }

    override fun onDestroy() {
        taskId?.let { ApkUpdateRuntime.manager(this).pause(it) }
        removeListener?.invoke()
        removeListener = null
        executor.shutdownNow()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun runTask(taskId: String, startId: Int) {
        try {
            var result = ApkUpdateRuntime.manager(this).run(taskId)
            while (result.shouldRetry && !Thread.currentThread().isInterrupted) {
                try {
                    Thread.sleep(result.retryDelayMs)
                } catch (_: InterruptedException) {
                    ApkUpdateRuntime.manager(this).pause(taskId)
                    return
                }
                result = ApkUpdateRuntime.manager(this).run(taskId)
            }
        } finally {
            removeListener?.invoke()
            removeListener = null
            ApkUpdateNotifications.clear(this)
            stopForeground(true)
            stopSelf(startId)
        }
    }
}

/** Android 14+ path: a platform user-initiated data-transfer job. */
class ApkUpdateJobService : JobService() {
    private val executor = Executors.newSingleThreadExecutor()
    private val stopped = AtomicBoolean(false)
    private var taskId: String? = null
    private var removeListener: (() -> Unit)? = null

    override fun onStartJob(params: JobParameters): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) return false
        val nextTaskId = params.extras.getString(ApkUpdateScheduler.EXTRA_TASK_ID) ?: return false
        val manager = ApkUpdateRuntime.manager(this)
        val snapshot = manager.statusOrNull(nextTaskId) ?: return false
        taskId = nextTaskId
        stopped.set(false)
        ApkUpdateNotifications.createChannel(this)
        setNotification(
            params,
            ApkUpdateNotifications.NOTIFICATION_ID,
            ApkUpdateNotifications.build(this, snapshot),
            JOB_END_NOTIFICATION_POLICY_REMOVE,
        )
        removeListener?.invoke()
        removeListener = manager.addListener { update ->
            if (update.taskId == nextTaskId) ApkUpdateNotifications.update(this, update)
        }
        executor.execute {
            val result = manager.run(nextTaskId)
            removeListener?.invoke()
            removeListener = null
            if (!stopped.get()) jobFinished(params, result.shouldRetry)
        }
        return true
    }

    override fun onStopJob(params: JobParameters): Boolean {
        stopped.set(true)
        val task = params.extras.getString(ApkUpdateScheduler.EXTRA_TASK_ID)
        return task != null && ApkUpdateRuntime.manager(this).pause(task)
    }

    override fun onDestroy() {
        taskId?.let { ApkUpdateRuntime.manager(this).pause(it) }
        removeListener?.invoke()
        removeListener = null
        executor.shutdownNow()
        super.onDestroy()
    }
}

class ApkUpdateCancelReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val taskId = intent.getStringExtra(ApkUpdateScheduler.EXTRA_TASK_ID) ?: return
        val manager = ApkUpdateRuntime.manager(context)
        if (manager.statusOrNull(taskId)?.let { manager.cancel(taskId).state } == ApkTaskState.CANCELLED) {
            ApkUpdateScheduler.cancel(context)
        }
    }
}
