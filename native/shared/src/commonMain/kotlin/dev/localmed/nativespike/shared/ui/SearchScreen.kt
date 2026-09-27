package dev.localmed.nativespike.shared.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import dev.localmed.nativespike.shared.model.SearchOutcome
import dev.localmed.nativespike.shared.model.SearchResultGroup
import dev.localmed.nativespike.shared.search.SearchEngine
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext

private const val DEBOUNCE_MS = 120L

@Composable
fun SearchScreen(
    engine: SearchEngine,
    onOpenDocument: (documentId: String, documentTitle: String, sectionAnchor: String?) -> Unit,
) {
    var query by remember { mutableStateOf("") }
    var outcome by remember { mutableStateOf<SearchOutcome?>(null) }
    var isSearching by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(query) {
        if (query.isBlank()) {
            outcome = null
            isSearching = false
            error = null
            return@LaunchedEffect
        }
        isSearching = true
        delay(DEBOUNCE_MS)
        try {
            val result = withContext(Dispatchers.Default) { engine.search(query) }
            outcome = result
            error = null
        } catch (cause: Exception) {
            error = cause.message ?: "Ошибка поиска"
        } finally {
            isSearching = false
        }
    }

    Scaffold(topBar = {
        Surface(tonalElevation = 2.dp) {
            Column(Modifier.fillMaxWidth().padding(16.dp)) {
                Text(
                    "LocalMed Native (spike)",
                    style = MaterialTheme.typography.titleMedium,
                )
                Text(
                    "Kotlin Multiplatform + Compose · core.db напрямую",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            OutlinedTextField(
                value = query,
                onValueChange = { query = it },
                modifier = Modifier.fillMaxWidth().padding(16.dp),
                placeholder = { Text("Поиск по базе…") },
                singleLine = true,
            )

            val timing = outcome?.timing
            if (timing != null) {
                Text(
                    "SQL: ${"%.1f".format(timing.sqlOnlyMs)} мс · Итого: ${"%.1f".format(timing.totalMs)} мс",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(horizontal = 16.dp),
                )
            }
            if (error != null) {
                Text(
                    "Ошибка: $error",
                    color = MaterialTheme.colorScheme.error,
                    modifier = Modifier.padding(16.dp),
                )
            }

            val groups = outcome?.groups.orEmpty()
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                items(groups, key = { it.documentId }) { group ->
                    DocumentResultCard(group = group, onOpenDocument = onOpenDocument)
                }
            }
        }
    }
}

@Composable
private fun DocumentResultCard(
    group: SearchResultGroup,
    onOpenDocument: (documentId: String, documentTitle: String, sectionAnchor: String?) -> Unit,
) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable { onOpenDocument(group.documentId, group.documentTitle, group.items.firstOrNull()?.anchor) },
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
    ) {
        Column(Modifier.padding(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                KindBadge(label = group.documentKind.label)
            }
            Text(
                group.documentTitle,
                style = MaterialTheme.typography.titleSmall,
                modifier = Modifier.padding(top = 6.dp, bottom = 6.dp),
            )
            group.items.forEach { item ->
                Column(
                    Modifier
                        .fillMaxWidth()
                        .clickable { onOpenDocument(group.documentId, group.documentTitle, item.anchor) }
                        .padding(vertical = 4.dp),
                ) {
                    Text(
                        item.sectionPath,
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.primary,
                    )
                    Text(
                        highlightedSnippet(item.snippet),
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
            }
        }
    }
}

@Composable
private fun KindBadge(label: String) {
    Box(
        modifier = Modifier
            .background(MaterialTheme.colorScheme.secondaryContainer, RoundedCornerShape(50))
            .padding(horizontal = 10.dp, vertical = 4.dp),
    ) {
        Text(
            label,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSecondaryContainer,
        )
    }
}

/** FTS5 `snippet()` marks hits with '[' / ']' (see NativeSearchDatabase); render those as bold. */
private fun highlightedSnippet(raw: String) = buildAnnotatedString {
    var index = 0
    while (index < raw.length) {
        val openIndex = raw.indexOf('[', index)
        if (openIndex < 0) {
            append(raw.substring(index))
            break
        }
        append(raw.substring(index, openIndex))
        val closeIndex = raw.indexOf(']', openIndex)
        if (closeIndex < 0) {
            append(raw.substring(openIndex))
            break
        }
        withStyle(style = androidx.compose.ui.text.SpanStyle(fontWeight = FontWeight.Bold)) {
            append(raw.substring(openIndex + 1, closeIndex))
        }
        index = closeIndex + 1
    }
}
