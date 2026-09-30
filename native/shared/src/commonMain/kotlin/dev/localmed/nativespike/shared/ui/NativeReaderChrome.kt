package dev.localmed.nativespike.shared.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.input.nestedscroll.NestedScrollConnection
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import dev.localmed.nativespike.shared.core.NativeReaderTarget

class NativeReaderChrome {
    var visible by mutableStateOf(true)
        private set
    val connection = object : NestedScrollConnection {
        override fun onPreScroll(available: Offset, source: NestedScrollSource): Offset {
            // Header reflow and programmatic restoration must not reverse user direction.
            if (source == NestedScrollSource.UserInput && available.y != 0f) visible = available.y > 0f
            return Offset.Zero
        }
    }
}

@Composable
fun rememberNativeReaderChrome(target: NativeReaderTarget): NativeReaderChrome = remember(target) { NativeReaderChrome() }
