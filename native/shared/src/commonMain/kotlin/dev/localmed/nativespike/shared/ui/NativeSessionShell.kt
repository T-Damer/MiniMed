package dev.localmed.nativespike.shared.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.Modifier
import dev.localmed.nativespike.shared.user.NativeUserPreferences
import kotlinx.coroutines.launch

/** Keeps the ready app composed while settings/history cover it, including its draft and reader. */
@Composable
fun NativeSessionShell(session: NativeCoreSession, ready: @Composable (NativeCoreSessionState.Ready) -> Unit) {
    val state by session.state.collectAsState()
    val user by session.userState.snapshot.collectAsState()
    val panel by session.panel.collectAsState()
    val focus = LocalFocusManager.current
    val keyboard = LocalSoftwareKeyboardController.current
    LaunchedEffect(session) { session.loadUserState() }
    LaunchedEffect(panel) { if (panel != null) { focus.clearFocus(force = true); keyboard?.hide() } }
    NativeUserAppearance(user?.preferences ?: NativeUserPreferences()) {
        NativeSpikeTheme {
            Box(Modifier.fillMaxSize()) {
                Box(Modifier.fillMaxSize().focusProperties { canFocus = panel == null }
                    .onPreviewKeyEvent { panel != null }
                    .then(if (panel != null) Modifier.clearAndSetSemantics { } else Modifier)) {
                when (val current = state) {
                    is NativeCoreSessionState.Ready -> ready(current)
                    else -> Column(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.surface)) {
                        Box(Modifier.weight(1f)) {
                            when (current) {
                                is NativeCoreSessionState.Opening -> NativeCoreStartup(current.progress, null, session::retry)
                                is NativeCoreSessionState.Failed -> NativeCoreStartup(null, current.message, session::retry)
                                else -> Unit
                            }
                        }
                        TextButton(modifier = Modifier.navigationBarsPadding(), onClick = { session.actionScope.launch { session.openPanel(NativeUserPanel.Settings) } }) { Text("Настройки") }
                    }
                }
                }
                when (panel) {
                    NativeUserPanel.Settings -> NativeSettingsScreen(session, user)
                    NativeUserPanel.History -> NativeHistoryDrawer(session, user)
                    null -> Unit
                }
            }
        }
    }
}
