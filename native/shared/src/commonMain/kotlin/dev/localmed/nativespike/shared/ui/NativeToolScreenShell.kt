package dev.localmed.nativespike.shared.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.localmed.nativespike.shared.tools.NativeToolRecord
import dev.localmed.nativespike.shared.user.NativeItemKind
import dev.localmed.nativespike.shared.user.NativeItemRef

internal fun nativeToolItem(record: NativeToolRecord) = NativeItemRef(NativeItemKind.Tool,record.id,title=record.title,parentId=record.bankId)
@Composable
internal fun NativeToolScreenShell(title: String,onBack: () -> Unit,onSave: (() -> Unit)? = null,content: @Composable (PaddingValues) -> Unit) {
    NativeChromeScaffold(containerColor=MaterialTheme.colorScheme.surface,desk=true,topBar={
        Surface(color=androidx.compose.ui.graphics.Color.Transparent) {
            Column(Modifier.fillMaxWidth()) {
                Spacer(Modifier.windowInsetsTopHeight(WindowInsets.statusBars))
                Row(Modifier.fillMaxWidth().padding(8.dp),horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                    NativePaperIconButton(NativeAppGlyphName.ArrowLeft,onBack,"Назад",primary=true)
                    Text(title,Modifier.weight(1f).padding(top=12.dp),style=MaterialTheme.typography.titleMedium,maxLines=2,overflow=androidx.compose.ui.text.style.TextOverflow.Ellipsis)
                    onSave?.let { NativePaperIconButton(NativeAppGlyphName.Bookmark,it,"В избранное или коллекцию") }
                }
            }
        }
    },content=content)
}
