package dev.localmed.nativespike.shared.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.border
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.size
import androidx.compose.ui.Alignment
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import dev.localmed.nativespike.shared.model.NativeSearchScope

val nativeDocumentSearchScopes=listOf(NativeSearchScope.ALL,NativeSearchScope.DIAGNOSIS,NativeSearchScope.GUIDELINES,NativeSearchScope.MEDICATIONS,NativeSearchScope.LEGAL,NativeSearchScope.CONDITIONS)
fun nativeSearchScopeLabel(scope: NativeSearchScope): String = when(scope) {
    NativeSearchScope.ALL -> "Все источники"
    NativeSearchScope.DIAGNOSIS -> "Клинический разбор"
    NativeSearchScope.GUIDELINES -> "Клинические рекомендации"
    NativeSearchScope.MEDICATIONS -> "Препараты"
    NativeSearchScope.LEGAL -> "Нормативные документы"
    NativeSearchScope.CONDITIONS -> "МКБ, симптомы и состояния"
    NativeSearchScope.CALCULATORS -> "Калькуляторы"
    NativeSearchScope.ASSESSMENTS -> "Опросники"
    NativeSearchScope.PERSONAL -> "Ваши данные"
}
@Composable
fun NativeSearchScopePicker(scope: NativeSearchScope,modifier: Modifier=Modifier,onScope: (NativeSearchScope)->Unit) {
    var expanded by remember { mutableStateOf(false) }
    Box(modifier) {
        Row(Modifier.fillMaxWidth().heightIn(min=40.dp).border(1.dp,MaterialTheme.colorScheme.outline,RoundedCornerShape(6.dp))
            .clickable(role=Role.Button) { expanded=true }.padding(horizontal=8.dp,vertical=6.dp),
            verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(6.dp)) {
            NativeAppGlyph(NativeAppGlyphName.Books,Modifier.size(18.dp),MaterialTheme.colorScheme.onSurface)
            Text(nativeSearchScopeLabel(scope),Modifier.weight(1f),style=MaterialTheme.typography.labelLarge,color=MaterialTheme.colorScheme.onSurface)
            NativeAppGlyph(NativeAppGlyphName.CaretDown,Modifier.size(18.dp),MaterialTheme.colorScheme.onSurface)
        }
        DropdownMenu(expanded,{expanded=false}) {
            nativeDocumentSearchScopes.forEach { value -> DropdownMenuItem(text={Text(nativeSearchScopeLabel(value))},onClick={expanded=false;onScope(value)}) }
        }
    }
}
