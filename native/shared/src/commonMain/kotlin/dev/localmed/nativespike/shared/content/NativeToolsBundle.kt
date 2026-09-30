@file:OptIn(kotlin.time.ExperimentalTime::class,org.jetbrains.compose.resources.ExperimentalResourceApi::class)
package dev.localmed.nativespike.shared.content

import minimed_native_spike.shared.generated.resources.Res
import dev.localmed.nativespike.shared.tools.NativeToolCore
import dev.localmed.nativespike.shared.tools.NativeToolContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlin.time.Clock

/** Trusted bundled resource decoded outside UI; the calendar context follows the actual UTC day. */
class NativeToolsBundle(private val bankJson: String) {
    private val mutex=Mutex()
    private var cached: Pair<String,NativeToolCore>?=null
    suspend fun core(): NativeToolCore = mutex.withLock {
        val day=Clock.System.now().toString().take(10)
        cached?.takeIf { it.first==day }?.second ?: withContext(Dispatchers.Default) {
            NativeToolCore(bankJson,NativeToolContext(day)).also { cached=day to it }
        }
    }
}
suspend fun bundledNativeTools(): NativeToolsBundle = NativeToolsBundle(Res.readBytes("files/native-tool-data.json").decodeToString())
