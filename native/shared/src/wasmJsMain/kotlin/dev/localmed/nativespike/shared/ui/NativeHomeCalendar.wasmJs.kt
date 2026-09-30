package dev.localmed.nativespike.shared.ui

@JsFun("() => { const d = new Date(); return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000); }")
private external fun localEpochDay(): Double

internal actual fun nativeHomeLocalEpochDay(): Long = localEpochDay().toLong()
