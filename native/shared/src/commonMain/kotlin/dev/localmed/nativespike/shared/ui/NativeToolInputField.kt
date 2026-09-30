package dev.localmed.nativespike.shared.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import dev.localmed.nativespike.shared.tools.*
import dev.localmed.nativespike.shared.text.jsNumberToString

internal fun nativeToolInputText(value: NativeToolInput): String = when(value) {
    is NativeToolInput.Text -> value.value
    is NativeToolInput.Number -> jsNumberToString(value.value)
}
@Composable
internal fun NativeToolInputField(input: NativeCalculatorInput,value: String,onValue: (String) -> Unit,enabled: Boolean) {
    val label=input.label+(input.unit?.let { " ($it)" } ?: "")+if(input.required) " *" else ""
    Column(Modifier.fillMaxWidth(),verticalArrangement=Arrangement.spacedBy(4.dp)) {
        when(input.kind) {
            "checkbox" -> Row(Modifier.fillMaxWidth().clickable(enabled=enabled) { onValue(if(value=="1") "0" else "1") },verticalAlignment=Alignment.CenterVertically) {
                Checkbox(value=="1",{onValue(if(it) "1" else "0")},enabled=enabled)
                Text(label,Modifier.weight(1f),style=MaterialTheme.typography.labelLarge)
            }
            "select" -> {
                var open by remember(input.id) { mutableStateOf(false) }
                Text(label,style=MaterialTheme.typography.labelMedium,color=MaterialTheme.colorScheme.onSurfaceVariant)
                Box {
                    NativePaperButton(input.options.orEmpty().find { nativeToolInputText(it.value)==value }?.label ?: "Выберите значение",
                        {open=true},Modifier.fillMaxWidth(),enabled=enabled,glyph=NativeAppGlyphName.CaretDown)
                    DropdownMenu(open,{open=false}) {
                        input.options.orEmpty().forEach { option ->
                            DropdownMenuItem(text={Text(option.label)},onClick={onValue(nativeToolInputText(option.value));open=false})
                        }
                    }
                }
            }
            else -> NativePaperTextField(value,onValue,label,Modifier.fillMaxWidth(),enabled=enabled,
                keyboardOptions=KeyboardOptions(keyboardType=if(input.kind=="number") KeyboardType.Decimal else KeyboardType.Text))
        }
        if(input.kind=="date") Text("ГГГГ-ММ-ДД",style=MaterialTheme.typography.labelMedium,color=MaterialTheme.colorScheme.onSurfaceVariant)
        input.labelTooltip?.let { text -> NativeToolDisclosure("Пояснение к полю") { Text(text) } }
        input.note?.let { Text(it,style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant) }
        if(input.minimum!=null || input.maximum!=null) Text("Допустимый диапазон: ${input.minimum?.let(::jsNumberToString) ?: "не задан"} — ${input.maximum?.let(::jsNumberToString) ?: "не задан"}",style=MaterialTheme.typography.labelMedium,color=MaterialTheme.colorScheme.onSurfaceVariant)
    }
}
