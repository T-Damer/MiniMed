package dev.localmed.search

import android.app.ActivityManager
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager
import android.os.Build
import android.os.Debug
import android.os.Handler
import android.os.HandlerThread
import android.os.PowerManager
import android.os.Process
import android.os.SystemClock
import android.webkit.WebView
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.File

/**
 * The native half of the opt-in performance log (PERFLOG1). While the log is on, a background
 * thread samples the app process every few seconds — CPU time (the Java side, the database and the
 * native GigaAM recogniser run here; the WebView renderer is a separate, sandboxed process), memory,
 * battery temperature, thermal status and headroom, CPU clock — and keeps only the latest sample.
 * `sample()` hands that over, so a plugin call never waits for the reads. Off: no thread, no work.
 */
@CapacitorPlugin(name = "LocalMedPerf")
class LocalMedPerfPlugin : Plugin() {
    private var thread: HandlerThread? = null
    private var handler: Handler? = null
    @Volatile private var latest: JSObject? = null
    private var lastCpuMs = 0L
    private var lastWallMs = 0L
    private var intervalMs = 5_000L

    private val tick = object : Runnable {
        override fun run() {
            latest = try {
                takeSample()
            } catch (_: RuntimeException) {
                latest
            }
            handler?.postDelayed(this, intervalMs)
        }
    }

    @PluginMethod
    fun start(call: PluginCall) {
        intervalMs = (call.getInt("intervalMs") ?: 5_000).toLong().coerceIn(1_000L, 60_000L)
        if (thread == null) {
            val started = HandlerThread("MiniMedPerf", Process.THREAD_PRIORITY_BACKGROUND)
            started.start()
            thread = started
            handler = Handler(started.looper)
            lastCpuMs = Process.getElapsedCpuTime()
            lastWallMs = SystemClock.elapsedRealtime()
            handler?.post(tick)
        }
        call.resolve()
    }

    @PluginMethod
    fun stop(call: PluginCall) {
        shutDown()
        call.resolve()
    }

    @PluginMethod
    fun sample(call: PluginCall) {
        val result = JSObject()
        latest?.let { result.put("sample", it) }
        result.put("device", deviceInfo())
        call.resolve(result)
    }

    override fun handleOnDestroy() {
        shutDown()
    }

    private fun shutDown() {
        handler?.removeCallbacksAndMessages(null)
        thread?.quitSafely()
        thread = null
        handler = null
        latest = null
    }

    private fun takeSample(): JSObject {
        val sample = JSObject()
        val context = context
        val now = SystemClock.elapsedRealtime()
        val cpu = Process.getElapsedCpuTime()
        val wall = (now - lastWallMs).coerceAtLeast(1L)
        sample.put("epochMs", System.currentTimeMillis())
        // Cores the app process used on average since the last sample (1.0 = one core busy).
        sample.put("cpuCores", (cpu - lastCpuMs).toDouble() / wall.toDouble())
        lastCpuMs = cpu
        lastWallMs = now
        sample.put("threads", Thread.activeCount())

        val battery = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        if (battery != null) {
            val temperature = battery.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, Int.MIN_VALUE)
            if (temperature != Int.MIN_VALUE) sample.put("tempC", temperature / 10.0)
            val level = battery.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
            val scale = battery.getIntExtra(BatteryManager.EXTRA_SCALE, -1)
            if (level >= 0 && scale > 0) sample.put("battery", level * 100 / scale)
            val plugged = battery.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0)
            sample.put("charging", plugged != 0)
        }

        val power = context.getSystemService(Context.POWER_SERVICE) as? PowerManager
        if (power != null) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                sample.put("thermal", power.currentThermalStatus)
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                val headroom = power.getThermalHeadroom(10)
                if (!headroom.isNaN()) sample.put("headroom", headroom.toDouble())
            }
            sample.put("powerSave", power.isPowerSaveMode)
        }

        val activities = context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
        if (activities != null) {
            val memory = ActivityManager.MemoryInfo()
            activities.getMemoryInfo(memory)
            sample.put("availMb", memory.availMem / MB)
            sample.put("lowMemory", memory.lowMemory)
        }
        // The app process only (Java heap, native heap, the recogniser, mapped databases).
        sample.put("pssMb", Debug.getPss() / 1024.0)
        sample.put("nativeHeapMb", Debug.getNativeHeapAllocatedSize().toDouble() / MB)
        maxCpuMhz()?.let { sample.put("cpuMaxMhz", it) }
        return sample
    }

    /** The fastest core's current clock: drops when the phone throttles. Null where unreadable. */
    private fun maxCpuMhz(): Int? {
        var best = 0
        for (index in 0 until 16) {
            val file = File("/sys/devices/system/cpu/cpu$index/cpufreq/scaling_cur_freq")
            if (!file.exists()) {
                if (index > 0) break else continue
            }
            val khz = try {
                file.readText().trim().toIntOrNull()
            } catch (_: Exception) {
                null
            } ?: continue
            if (khz > best) best = khz
        }
        return if (best >= 1000) best / 1000 else null
    }

    private fun deviceInfo(): JSObject {
        val device = JSObject()
        device.put("manufacturer", Build.MANUFACTURER)
        device.put("model", Build.MODEL)
        device.put("release", Build.VERSION.RELEASE)
        device.put("sdk", Build.VERSION.SDK_INT)
        device.put("cores", Runtime.getRuntime().availableProcessors())
        val activities = context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
        if (activities != null) {
            val memory = ActivityManager.MemoryInfo()
            activities.getMemoryInfo(memory)
            device.put("totalMb", memory.totalMem / MB)
            device.put("memoryClassMb", activities.memoryClass)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            WebView.getCurrentWebViewPackage()?.let { device.put("webview", it.versionName) }
        }
        try {
            val info = context.packageManager.getPackageInfo(context.packageName, 0)
            device.put("appVersion", info.versionName)
        } catch (_: Exception) {
            // Unknown version: the JavaScript side reports the release version anyway.
        }
        return device
    }

    private companion object {
        const val MB = 1_048_576L
    }
}
