package dev.localmed.nativespike.shared.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.localmed.nativespike.shared.model.SearchOutcome
import dev.localmed.nativespike.shared.model.SearchResultGroup
import dev.localmed.nativespike.shared.search.LookupEngine
import dev.localmed.nativespike.shared.text.formatFixed1
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.withContext

private const val DEBOUNCE_MS = 120L

// --home-gap from apps/app/src/features/search/search-home-intro.css: 1rem (16dp) baseline, 1.25rem
// (20dp) at the wider breakpoint. This spike targets phone width only, so 16dp throughout — see
// docs/research/native-vs-webview-2026-09-28.md, "Web visual parity restyle".
private val HOME_GAP = 16.dp

@Composable
fun SearchScreen(
    engine: LookupEngine,
    onOpenDocument: (documentId: String, documentTitle: String, sectionAnchor: String?) -> Unit,
    // Debug measurement hook only (see native/androidApp's MainActivity — HyperOS blocks
    // `adb shell input` entirely on the physical Xiaomi 14, and even on a plain emulator
    // `adb shell input text` cannot type Cyrillic: it maps characters through the current
    // KeyCharacterMap, which has no mapping for них — `input text "менингит"` throws inside
    // InputShellCommand.sendText). `externalQuery`, when non-null, drives the same query state a
    // real keystroke would, so a debug build can be driven by a broadcast instead of typing.
    // `null` (every non-bench caller) preserves exactly the original typed-search behavior.
    externalQuery: String? = null,
    // `stages`: per-stage timing map from LookupEngine.search's onStage callback, summed by stage
    // name across all branches (see PipelineTiming.kt/LookupPipeline.kt) — used only by the debug
    // bench path (see MainActivity), empty for any non-bench call.
    onOutcome: ((query: String, outcome: SearchOutcome?, tookMs: Double, stages: Map<String, Double>) -> Unit)? = null,
) {
    var query by remember { mutableStateOf("") }
    var outcome by remember { mutableStateOf<SearchOutcome?>(null) }
    var isSearching by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(externalQuery) {
        if (externalQuery != null) query = externalQuery
    }

    LaunchedEffect(query) {
        val requestQuery = query
        if (query.isBlank()) {
            outcome = null
            isSearching = false
            error = null
            return@LaunchedEffect
        }
        isSearching = true
        error = null
        val benchStart = if (query == externalQuery) kotlin.time.TimeSource.Monotonic.markNow() else null
        val stageTimings: MutableMap<String, Double>? = if (benchStart != null) LinkedHashMap() else null
        delay(DEBOUNCE_MS)
        try {
            val result = withContext(Dispatchers.Default) {
                engine.search(requestQuery) { stage, ms ->
                    stageTimings?.let { it[stage] = (it[stage] ?: 0.0) + ms }
                }
            }
            outcome = result
            error = null
            if (benchStart != null) {
                // Two frame waits: the first is where Compose schedules recomposition for the
                // new `outcome`, the second guarantees that recomposition has actually been
                // measured/laid-out/drawn — see docs/research/native-vs-webview-2026-09-28.md.
                androidx.compose.runtime.withFrameNanos { }
                androidx.compose.runtime.withFrameNanos { }
                onOutcome?.invoke(
                    requestQuery, result, benchStart.elapsedNow().inWholeMicroseconds / 1000.0,
                    stageTimings.orEmpty(),
                )
            }
        } catch (cause: CancellationException) {
            throw cause
        } catch (cause: Exception) {
            if (currentCoroutineContext().isActive && query == requestQuery) {
                error = cause.message ?: "Ошибка поиска"
            }
        } finally {
            if (currentCoroutineContext().isActive && query == requestQuery) {
                isSearching = false
            }
        }
    }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            Surface(color = MaterialTheme.colorScheme.background) {
                Column(Modifier.fillMaxWidth().padding(horizontal = HOME_GAP, vertical = 10.dp)) {
                    Text(
                        "LocalMed Native (spike)",
                        style = MaterialTheme.typography.titleMedium,
                        color = MaterialTheme.colorScheme.onBackground,
                    )
                    Text(
                        "Kotlin Multiplatform + Compose · core.db напрямую",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onBackground,
                    )
                }
            }
        },
    ) { padding ->
        Column(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background).padding(padding)) {
            // Web's ".search-field-pill": a rounded card on --theme-search-surface holding the
            // field plus a source-scope row and a "clinical analysis" toggle — see
            // apps/app/src/features/search/search-quick-access.css. Visual only below: this spike
            // has one lexical branch (no scope/clinical-mode logic), matching the coordinator's
            // "can be without logic" instruction — these two rows never change search behavior.
            Surface(
                color = MaterialTheme.colorScheme.errorContainer, // mapped to --theme-search-surface — see Theme.kt
                shape = androidx.compose.foundation.shape.RoundedCornerShape(12.dp),
                modifier = Modifier.fillMaxWidth().padding(horizontal = HOME_GAP, vertical = 8.dp),
            ) {
                Column {
                    TextField(
                        value = query,
                        onValueChange = { query = it },
                        modifier = Modifier.fillMaxWidth(),
                        placeholder = { Text("Название, код МКБ, препарат или фраза из документа", style = MaterialTheme.typography.bodyMedium) },
                        singleLine = true,
                        colors = TextFieldDefaults.colors(
                            focusedContainerColor = androidx.compose.ui.graphics.Color.Transparent,
                            unfocusedContainerColor = androidx.compose.ui.graphics.Color.Transparent,
                            focusedIndicatorColor = androidx.compose.ui.graphics.Color.Transparent,
                            unfocusedIndicatorColor = androidx.compose.ui.graphics.Color.Transparent,
                        ),
                        textStyle = MaterialTheme.typography.bodyLarge,
                    )
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 10.dp),
                        verticalAlignment = androidx.compose.ui.Alignment.CenterVertically,
                    ) {
                        Surface(
                            color = MaterialTheme.colorScheme.surface,
                            shape = androidx.compose.foundation.shape.RoundedCornerShape(50),
                            border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
                        ) {
                            Text(
                                "Все источники",
                                style = MaterialTheme.typography.labelMedium,
                                color = MaterialTheme.colorScheme.onSurface,
                                modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
                            )
                        }
                        androidx.compose.foundation.layout.Spacer(Modifier.weight(1f))
                        Text(
                            "Клинический разбор",
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }

            val timing = outcome?.timing
            if (timing != null) {
                Text(
                    "SQL: ${formatFixed1(timing.sqlOnlyMs)} мс · Итого: ${formatFixed1(timing.totalMs)} мс",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onBackground,
                    modifier = Modifier.padding(horizontal = HOME_GAP),
                )
            }
            if (error != null) {
                Text(
                    "Ошибка: $error",
                    color = MaterialTheme.colorScheme.onBackground,
                    modifier = Modifier.padding(HOME_GAP),
                )
            }

            val groups = outcome?.groups.orEmpty()
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(horizontal = HOME_GAP, vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(1.dp), // web's .result-card list uses hairline dividers, not gaps
            ) {
                items(groups, key = { it.documentId }) { group ->
                    DocumentResultCard(group = group, onOpenDocument = onOpenDocument)
                }
            }
        }
    }
}

/** Mirrors web's `.result-card` (apps/app/src/styles/global.css): flat (no corner radius, no
 * elevation), `--theme-surface-raised` background, a bordered mono "category stamp" instead of a
 * filled chip, and a mono uppercase `.result-path` line above a serif snippet. */
@Composable
private fun DocumentResultCard(
    group: SearchResultGroup,
    onOpenDocument: (documentId: String, documentTitle: String, sectionAnchor: String?) -> Unit,
) {
    Surface(
        color = MaterialTheme.colorScheme.surfaceVariant, // --theme-surface-raised — see Theme.kt
        modifier = Modifier
            .fillMaxWidth()
            .clickable { onOpenDocument(group.documentId, group.documentTitle, group.items.firstOrNull()?.anchor) },
    ) {
        Column(Modifier.padding(14.dp)) {
            Row {
                CategoryStamp(label = group.documentKind.label)
            }
            Text(
                group.documentTitle,
                style = MaterialTheme.typography.titleSmall,
                color = MaterialTheme.colorScheme.onSurface,
                modifier = Modifier.padding(top = 8.dp, bottom = 6.dp),
            )
            group.items.forEach { item ->
                Column(
                    Modifier
                        .fillMaxWidth()
                        .clickable { onOpenDocument(group.documentId, group.documentTitle, item.anchor) }
                        .padding(vertical = 4.dp),
                ) {
                    Text(
                        item.sectionPath.uppercase(),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        letterSpacing = 0.5.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Text(
                        highlightedSnippet(item.snippet, item.highlightedRanges),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurface,
                        modifier = Modifier.padding(top = 4.dp),
                    )
                }
            }
        }
    }
}

/** Web's `.category-stamp`: `border: 1px solid currentColor`, mono, uppercase, bold, letter-spaced
 * — a bordered label, not a filled Material chip. */
@Composable
private fun CategoryStamp(label: String) {
    Box(
        modifier = Modifier
            .border(1.dp, MaterialTheme.colorScheme.primary)
            .padding(horizontal = 6.dp, vertical = 3.dp),
    ) {
        Text(
            label.uppercase(),
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.primary,
            letterSpacing = 0.7.sp,
        )
    }
}

/** Thin Compose wrapper around the pure, unit-tested `snippetSegments` (text/SnippetSegments.kt). */
private fun highlightedSnippet(raw: String, ranges: List<dev.localmed.nativespike.shared.text.TextRange>) = buildAnnotatedString {
    for (segment in dev.localmed.nativespike.shared.text.snippetSegments(raw, ranges)) {
        if (segment.highlighted) {
            withStyle(style = androidx.compose.ui.text.SpanStyle(fontWeight = FontWeight.Bold)) {
                append(segment.text)
            }
        } else {
            append(segment.text)
        }
    }
}
