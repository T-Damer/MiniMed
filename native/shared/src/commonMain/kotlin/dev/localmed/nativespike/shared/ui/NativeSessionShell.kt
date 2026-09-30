package dev.localmed.nativespike.shared.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.ime
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp
import dev.localmed.nativespike.shared.user.NativeUserPreferences
import kotlinx.coroutines.launch
import dev.localmed.nativespike.shared.reader.nativeFilePickerAvailable
import dev.localmed.nativespike.shared.reader.rememberNativeFilePicker
import dev.localmed.nativespike.shared.reader.NativeReaderContent
import dev.localmed.nativespike.shared.designsystem.NativeDimensions

/** Keeps the ready app composed while settings/history cover it, including its draft and reader. */
@Composable
fun NativeSessionShell(session: NativeCoreSession, ready: @Composable (NativeCoreSessionState.Ready) -> Unit) {
    val state by session.state.collectAsState()
    val user by session.userState.snapshot.collectAsState()
    val panel by session.panel.collectAsState()
    val openedFile by session.openedFile.collectAsState()
    val pickFile = rememberNativeFilePicker { result -> session.actionScope.launch { session.openFile(result) } }
    val toolsSnapshot by session.toolsState.snapshot.collectAsState()
    val toolCore by session.tools.collectAsState()
    val messages by session.uiErrors.messages.collectAsState()
    val covered=panel!=null || toolsSnapshot?.route!=null || openedFile != null
    val focus = LocalFocusManager.current
    val keyboard = LocalSoftwareKeyboardController.current
    LaunchedEffect(session) { session.loadUserState();session.loadTools() }
    LaunchedEffect(covered) { if (covered) { focus.clearFocus(force = true); keyboard?.hide() } }
    NativeUserAppearance(user?.preferences ?: NativeUserPreferences()) {
        NativeSpikeTheme {
            val navigation = (state as? NativeCoreSessionState.Ready)?.core?.navigation?.collectAsState()?.value
            val readerTarget = navigation?.readers?.lastOrNull()?.target
            val readerChrome = remember(session, readerTarget) { NativeReaderChrome() }
            val fileChrome = remember(session, openedFile) { NativeReaderChrome() }
            val fileDocument = openedFile is NativeReaderContent.Document
            val keyboardHidden = WindowInsets.ime.getBottom(LocalDensity.current) == 0
            val routeNavigationVisible = panel != NativeUserPanel.History && panel != NativeUserPanel.Collections &&
                (panel != null || toolsSnapshot?.route != null || readerTarget == null || readerChrome.visible) && keyboardHidden
            val navigationVisible = if (fileDocument) fileChrome.visible && keyboardHidden else openedFile == null && routeNavigationVisible
            val navigationSpace = NativeDimensions.controlHeightLarge + NativeDimensions.space3
            val emptyNavigationSpace = 0.dp
            CompositionLocalProvider(
                LocalNativeOpenFile provides pickFile.takeIf { nativeFilePickerAvailable },
                LocalNativeReaderChrome provides if (readerTarget != null) readerChrome else null,
                LocalNativeNavigationPadding provides if (routeNavigationVisible) navigationSpace else emptyNavigationSpace,
            ) {
            Box(Modifier.fillMaxSize()) {
                Box(Modifier.fillMaxSize().focusProperties { canFocus = !covered }
                    .onPreviewKeyEvent { covered }.blockCoveredPointers(covered)
                    .then(if (covered) Modifier.clearAndSetSemantics { } else Modifier)) {
                when (val current = state) {
                    is NativeCoreSessionState.Ready -> ready(current)
                    is NativeCoreSessionState.Opening -> NativeCoreStartup(session, current.progress, null)
                    is NativeCoreSessionState.Failed -> NativeCoreStartup(session, null, current.message)
                }
                }
                if(toolsSnapshot?.route!=null) Box(Modifier.fillMaxSize()
                    .focusProperties { canFocus = panel==null && openedFile == null }.onPreviewKeyEvent { panel!=null || openedFile != null }.blockCoveredPointers(panel != null || openedFile != null)
                    .then(if(panel!=null || openedFile != null) Modifier.clearAndSetSemantics { } else Modifier)) { NativeToolsPane(session) }
                Box(Modifier.fillMaxSize().focusProperties { canFocus = openedFile == null }
                    .onPreviewKeyEvent { openedFile != null }.blockCoveredPointers(openedFile != null)
                    .then(if (openedFile != null) Modifier.clearAndSetSemantics { } else Modifier)) {
                when (panel) {
                    NativeUserPanel.Settings -> NativeSettingsScreen(session, user)
                    NativeUserPanel.History -> NativeHistoryDrawer(session, user)
                    NativeUserPanel.Collections -> NativeCollectionsScreen(session)
                    null -> Unit
                }
                }
                openedFile?.let { file ->
                    CompositionLocalProvider(
                        LocalNativeReaderChrome provides fileChrome,
                        LocalNativeNavigationPadding provides if (navigationVisible) navigationSpace else emptyNavigationSpace,
                    ) {
                        NativeOpenedFileScreen(file) { session.actionScope.launch { session.back() } }
                    }
                }
                if (navigationVisible) Box(Modifier.align(Alignment.BottomCenter).navigationBarsPadding().padding(bottom = 10.dp)) {
                    NativeBottomNavigation(
                        selectedIndex = if (!fileDocument && panel == NativeUserPanel.Settings) 2 else 0,
                        onSearch = { session.actionScope.launch { session.showSearch() } },
                        onCollections = { session.actionScope.launch { session.openCollections() } },
                        onSettings = { session.actionScope.launch { session.openPanel(NativeUserPanel.Settings) } },
                    )
                }
            }
            }
        }
    }
}

/** A non-interactive file notice must not pass gestures to the retained page underneath. */
internal fun Modifier.blockCoveredPointers(covered: Boolean): Modifier = if (!covered) this else pointerInput(Unit) {
    awaitPointerEventScope {
        while (true) awaitPointerEvent(PointerEventPass.Initial).changes.forEach { it.consume() }
    }
}
