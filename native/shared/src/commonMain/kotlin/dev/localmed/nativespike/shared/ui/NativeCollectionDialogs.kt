package dev.localmed.nativespike.shared.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.window.Dialog
import dev.localmed.nativespike.shared.designsystem.NativeDesign
import dev.localmed.nativespike.shared.designsystem.NativeDimensions
import dev.localmed.nativespike.shared.designsystem.NativePaperSheet
import dev.localmed.nativespike.shared.designsystem.NativePrimaryButton
import dev.localmed.nativespike.shared.designsystem.NativeSearchField
import dev.localmed.nativespike.shared.designsystem.NativeSectionHeading
import dev.localmed.nativespike.shared.designsystem.textStyle
import dev.localmed.nativespike.shared.user.NativeItemCollection
import dev.localmed.nativespike.shared.user.NativeItemCollectionsSnapshot
import dev.localmed.nativespike.shared.user.NativeItemRef
import dev.localmed.nativespike.shared.user.nativeCollectionNameError
import kotlin.time.Clock
import kotlin.time.ExperimentalTime
import kotlin.uuid.ExperimentalUuidApi
import kotlin.uuid.Uuid

internal fun nativeCollectionGlyph(name: NativeAppGlyphName): @Composable (Color) -> Unit = { tint ->
    NativeAppGlyph(name, Modifier.size(NativeDimensions.space5), tint)
}

@OptIn(ExperimentalTime::class, ExperimentalUuidApi::class)
@Composable
internal fun NativeCollectionNameDialog(
    session: NativeCoreSession, state: NativeItemCollectionsSnapshot, name: String,
    renaming: NativeItemCollection?, selectedItem: NativeItemRef?, saving: Boolean,
    onName: (String) -> Unit, onDismiss: () -> Unit,
    mutate: (suspend () -> Unit) -> Unit, onSaved: () -> Unit,
) {
    val error = nativeCollectionNameError(state, name, renaming?.id)
    Dialog(onDismissRequest = { if (!saving) onDismiss() }) {
        NativePaperSheet(Modifier.testTag("tool-collection-form")) {
            NativeSectionHeading(if (renaming == null) "Новая коллекция" else "Название коллекции")
            NativeSearchField(name, { if (!saving) onName(it) }, "Название", icon = nativeCollectionGlyph(NativeAppGlyphName.Edit))
            if (error != null && name.isNotEmpty()) BasicText(error, Modifier.testTag("tool-collection-form__error"), style = NativeDesign.components.coreStatusDetail.text.textStyle())
            Row(horizontalArrangement = Arrangement.spacedBy(NativeDimensions.space2)) {
                NativePrimaryButton("Сохранить", {
                    val at = Clock.System.now().toString()
                    val id = renaming?.id ?: Uuid.random().toString()
                    mutate {
                        if (renaming == null) session.collectionsState.createCollection(id, name, at, listOfNotNull(selectedItem))
                        else session.collectionsState.renameCollection(id, name)
                        onSaved()
                    }
                }, enabled = !saving && error == null)
                NativePrimaryButton("Отмена", onDismiss, enabled = !saving)
            }
        }
    }
}

@Composable
internal fun NativeCollectionDeleteDialog(collection: NativeItemCollection, saving: Boolean, onDismiss: () -> Unit, onDelete: () -> Unit) {
    Dialog(onDismissRequest = { if (!saving) onDismiss() }) {
        NativePaperSheet {
            NativeSectionHeading("Удалить коллекцию «${collection.name}»?", description = "Её элементы останутся в избранном и других коллекциях.")
            Row(horizontalArrangement = Arrangement.spacedBy(NativeDimensions.space2)) {
                NativePrimaryButton("Удалить", onDelete, enabled = !saving)
                NativePrimaryButton("Отмена", onDismiss, enabled = !saving)
            }
        }
    }
}
