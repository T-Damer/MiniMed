package dev.localmed.nativespike.shared.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.disabled
import androidx.compose.ui.semantics.semantics
import dev.localmed.nativespike.shared.designsystem.NativeChoice
import dev.localmed.nativespike.shared.designsystem.NativeChoiceGroup
import dev.localmed.nativespike.shared.designsystem.NativeDesign
import dev.localmed.nativespike.shared.designsystem.NativeDimensions
import dev.localmed.nativespike.shared.designsystem.NativeGroupTitle
import dev.localmed.nativespike.shared.designsystem.NativePageHeader
import dev.localmed.nativespike.shared.designsystem.NativePaperSheet
import dev.localmed.nativespike.shared.designsystem.NativeRangeSetting
import dev.localmed.nativespike.shared.designsystem.NativeSectionHeading
import dev.localmed.nativespike.shared.user.NATIVE_TEXT_SCALE_LEVELS
import dev.localmed.nativespike.shared.user.NativeThemePreference
import dev.localmed.nativespike.shared.user.NativeUserSnapshot
import kotlin.math.roundToInt
import kotlinx.coroutines.launch

/** Web settings sheets, connected to the preferences the native app actually persists. */
@Composable
fun NativeSettingsScreen(session: NativeCoreSession, snapshot: NativeUserSnapshot?) {
    var saving by remember(session) { mutableStateOf(false) }
    val save = { operation: suspend () -> Unit ->
        if (!saving && snapshot != null) {
            saving = true
            session.actionScope.launch {
                try {
                    session.uiErrors.execute(NativeUiOperation.UserPreferences, "Не удалось сохранить настройку. Выберите значение ещё раз.", operation)
                } finally { saving = false }
            }
        }
        Unit
    }
    val list = remember(session) { androidx.compose.foundation.lazy.LazyListState() }
    val statusTop = WindowInsets.statusBars.asPaddingValues().calculateTopPadding()
    val navigationBottom = WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding()
    NativeChromeScaffold(
        containerColor = NativeDesign.colors.background, desk = true,
        scrolled = list.firstVisibleItemIndex > 0 || list.firstVisibleItemScrollOffset > 0,
        topBar = { Box(Modifier.height(statusTop)) },
    ) { padding ->
        LazyColumn(
            Modifier.fillMaxSize().testTag("settings-page"), state = list,
            contentPadding = PaddingValues(
                start = NativeDimensions.space2 + NativeDimensions.outlineWidth,
                end = NativeDimensions.space2 + NativeDimensions.outlineWidth,
                top = padding.calculateTopPadding() + (NativeDimensions.space5 + NativeDimensions.space1),
                bottom = padding.calculateBottomPadding() + navigationBottom + (NativeDimensions.space5 + NativeDimensions.space1),
            ),
            verticalArrangement = Arrangement.spacedBy(NativeDimensions.space4),
        ) {
            item { NativePageHeader("Настройки", Modifier.testTag("page__header"), description = "Внешний вид и размер текста.", icon = { tint ->
                NativeAppGlyph(NativeAppGlyphName.System, Modifier.size(NativeDimensions.space5), tint)
            }) }
            item { NativeUserError(session) }
            if (snapshot != null) {
                item { NativeGroupTitle("Основное", Modifier.testTag("settings-page__group-title")) }
                item {
                    NativePaperSheet(Modifier.blockCoveredPointers(saving).semantics { if (saving) disabled() }) {
                        NativeSectionHeading("Внешний вид", Modifier.testTag("settings-section__heading"))
                        NativeChoiceGroup(
                            "Тема", listOf(NativeChoice("Системная"), NativeChoice("Светлая"), NativeChoice("Тёмная")),
                            NativeThemePreference.entries.indexOf(snapshot.preferences.theme),
                            { index -> save { session.userState.setTheme(NativeThemePreference.entries[index]) } },
                            Modifier.testTag("ui-choice-group"),
                        )
                    }
                }
                item {
                    NativePaperSheet(Modifier.blockCoveredPointers(saving).semantics { if (saving) disabled() }) {
                        NativeSectionHeading("Размер текста", Modifier.testTag("settings-section__heading"), description = "Применяется поверх системного размера шрифта.")
                        val index = NATIVE_TEXT_SCALE_LEVELS.indexOf(snapshot.preferences.textScalePercent)
                        NativeRangeSetting(
                            "Масштаб", index.toFloat() / NATIVE_TEXT_SCALE_LEVELS.lastIndex,
                            { value ->
                                val scale = NATIVE_TEXT_SCALE_LEVELS[(value * NATIVE_TEXT_SCALE_LEVELS.lastIndex).roundToInt().coerceIn(NATIVE_TEXT_SCALE_LEVELS.indices)]
                                save { session.userState.setTextScalePercent(scale) }
                            },
                            "${snapshot.preferences.textScalePercent} %", steps = NATIVE_TEXT_SCALE_LEVELS.size,
                        )
                    }
                }
            }
        }
    }
}
