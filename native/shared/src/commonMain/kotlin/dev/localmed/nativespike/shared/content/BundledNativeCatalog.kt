package dev.localmed.nativespike.shared.content

import minimed_native_spike.shared.generated.resources.Res
import org.jetbrains.compose.resources.ExperimentalResourceApi

@OptIn(ExperimentalResourceApi::class)
suspend fun bundledNativeCatalog(): String = Res.readBytes("files/native-module-catalog.json").decodeToString()
