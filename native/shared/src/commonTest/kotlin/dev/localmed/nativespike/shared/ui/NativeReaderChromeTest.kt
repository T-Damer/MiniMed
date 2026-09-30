package dev.localmed.nativespike.shared.ui

import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class NativeReaderChromeTest {
    @Test fun headerReflowCannotReverseTheActualUserScrollDirection() {
        val chrome = NativeReaderChrome()
        chrome.connection.onPreScroll(Offset(0f, -20f), NestedScrollSource.UserInput)
        assertFalse(chrome.visible)
        chrome.connection.onPreScroll(Offset(0f, 40f), NestedScrollSource.SideEffect)
        assertFalse(chrome.visible)
        chrome.connection.onPreScroll(Offset.Zero, NestedScrollSource.UserInput)
        assertFalse(chrome.visible)
        chrome.connection.onPreScroll(Offset(0f, 20f), NestedScrollSource.UserInput)
        assertTrue(chrome.visible)
    }
}
