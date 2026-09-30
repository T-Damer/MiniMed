package dev.localmed.nativespike.shared.designsystem

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.runComposeUiTest
import androidx.compose.ui.unit.dp
import kotlin.test.Test
import kotlin.test.assertEquals

@OptIn(ExperimentalTestApi::class)
class NativeResultGroupTest {
    @Test
    fun moreDisclosureRevealsTheRemainingFragments() = runComposeUiTest {
        val opened = mutableListOf<String>()
        setContent {
            ProvideNativeDesignTokens(dark = false) {
                NativeResultGroup(
                    index = 1,
                    kindLabel = "Клинические рекомендации",
                    title = "Пневмония",
                    snippets = listOf("Первый", "Второй", "Третий").map { text ->
                        NativeResultSnippet(null, null, text, emptyList(), { opened += text })
                    },
                    onOpen = {},
                    moreTitle = { "Ещё $it" },
                    kindIcon = { Box(Modifier.size(18.dp)) },
                )
            }
        }
        onAllNodesWithTag("result-card", useUnmergedTree = true).assertCountEquals(1)
        onNodeWithTag("more-header").performClick()
        waitForIdle()
        onAllNodesWithTag("result-card", useUnmergedTree = true).assertCountEquals(3)
        onAllNodesWithTag("result-card", useUnmergedTree = true)[2].performClick()
        assertEquals(listOf("Третий"), opened)
    }
}
