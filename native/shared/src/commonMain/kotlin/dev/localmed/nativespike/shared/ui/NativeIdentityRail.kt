package dev.localmed.nativespike.shared.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import dev.localmed.nativespike.shared.core.NativeCoreIdentityHit
import dev.localmed.nativespike.shared.core.NativeCoreIdentityTarget
import dev.localmed.nativespike.shared.designsystem.NativeDesign
import dev.localmed.nativespike.shared.designsystem.NativeDimensions
import dev.localmed.nativespike.shared.designsystem.NativeIdentityCard
import dev.localmed.nativespike.shared.designsystem.NativeSecondaryButton
import dev.localmed.nativespike.shared.designsystem.textStyle

/** Source-local identities stay separate from lexical document groups. */
@Composable
fun NativeIdentityRail(hits: List<NativeCoreIdentityHit>, opening: Boolean, onOpen: (NativeCoreIdentityHit) -> Unit) {
    if (hits.isEmpty()) return
    Column(Modifier.fillMaxWidth().testTag("core-identity-matches"), verticalArrangement = Arrangement.spacedBy(NativeDimensions.space3)) {
        BasicText("Точных названий: ${hits.size}", style = NativeDesign.components.identityNote.text.textStyle())
        hits.forEach { hit ->
            val note = buildList {
                if (hit.name != hit.title) add("Название в источнике: ${hit.name}")
                add(nativeIdentityCoverageLabel(hit.coverage))
                when (val target = hit.target) {
                    is NativeCoreIdentityTarget.Document -> add("Набор: ${target.moduleId}")
                    is NativeCoreIdentityTarget.Definition -> {
                        add("Требует проверки · запись в пределах источника")
                        add("Запись: ${target.entityId}")
                    }
                }
            }.joinToString("\n")
            NativeIdentityCard(hit.title, note = note) {
                if (opening) BasicText("Открываем источник…", style = NativeDesign.components.identityNote.text.textStyle())
                else NativeSecondaryButton("Открыть запись", { onOpen(hit) })
            }
        }
    }
}
