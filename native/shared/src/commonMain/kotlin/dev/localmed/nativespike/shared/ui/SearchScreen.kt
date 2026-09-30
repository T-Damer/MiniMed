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
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.localmed.nativespike.shared.model.SearchOutcome
import dev.localmed.nativespike.shared.model.SearchResultGroup
import dev.localmed.nativespike.shared.core.NativeMedicalCore
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive

private const val DEBOUNCE_MS = 120L

// --home-gap from apps/app/src/features/search/search-home-intro.css: 1rem (16dp) baseline, 1.25rem
// (20dp) at the wider breakpoint. This spike targets phone width only, so 16dp throughout — see
// docs/research/native-vs-webview-2026-09-28.md, "Web visual parity restyle".
private val HOME_GAP = 16.dp

@Composable
fun SearchScreen(
    core: NativeMedicalCore,
    state: NativeSearchUiState,
    onOpenDocument: (documentId: String, documentTitle: String, sectionAnchor: String?) -> Unit,
    openingSource: Boolean = false,
    sourceError: String? = null,
    onOpenSources: () -> Unit,
    onRetrySave: (() -> Unit)? = null,
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
    LaunchedEffect(externalQuery) {
        if (externalQuery != null) state.query = externalQuery
    }

    LaunchedEffect(core, state.query, state.attempt) {
        val requestQuery = state.query
        if (state.positionQuery != requestQuery) {
            state.positionQuery = requestQuery
            state.listState.scrollToItem(0)
        }
        if (requestQuery.isBlank()) {
            state.outcome = null
            state.loading = false
            state.error = null
            state.completedQuery = null
            return@LaunchedEffect
        }
        if (state.completedQuery == requestQuery && state.outcome != null) return@LaunchedEffect
        state.loading = true
        state.error = null
        state.outcome = null
        val benchStart = if (requestQuery == externalQuery) kotlin.time.TimeSource.Monotonic.markNow() else null
        val stageTimings: MutableMap<String, Double>? = if (benchStart != null) LinkedHashMap() else null
        delay(DEBOUNCE_MS)
        try {
            val result = core.search(requestQuery) { stage, ms ->
                    stageTimings?.let { it[stage] = (it[stage] ?: 0.0) + ms }
            }
            if (!currentCoroutineContext().isActive || state.query != requestQuery) return@LaunchedEffect
            state.outcome = result
            state.completedQuery = requestQuery
            state.error = null
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
            if (currentCoroutineContext().isActive && state.query == requestQuery) {
                state.error = cause.message ?: "Не удалось выполнить поиск. Повторите запрос."
            }
        } finally {
            if (currentCoroutineContext().isActive && state.query == requestQuery) {
                state.loading = false
            }
        }
    }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            Surface(color = MaterialTheme.colorScheme.background) {
                Column(Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = HOME_GAP, vertical = 10.dp)) {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text("MiniMed", style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onBackground)
                        TextButton(onClick = onOpenSources) {
                            Text("Источники", color = MaterialTheme.colorScheme.onBackground)
                        }
                    }
                }
            }
        },
    ) { padding ->
        Column(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background).padding(padding)) {
            Surface(
                color = MaterialTheme.colorScheme.errorContainer, // mapped to --theme-search-surface — see Theme.kt
                shape = androidx.compose.foundation.shape.RoundedCornerShape(12.dp),
                modifier = Modifier.fillMaxWidth().padding(horizontal = HOME_GAP, vertical = 8.dp),
            ) {
                Column {
                    TextField(
                        value = state.query,
                        onValueChange = { state.query = it },
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
                }
            }

            if (openingSource) Text("Открываем источник…", modifier = Modifier.padding(horizontal = HOME_GAP),
                style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onBackground)
            sourceError?.let { Text(it, modifier = Modifier.padding(horizontal = HOME_GAP),
                style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onBackground) }
            onRetrySave?.let { retry -> TextButton(onClick = retry, modifier = Modifier.padding(horizontal = HOME_GAP)) { Text("Повторить сохранение") } }
            if (state.loading) LinearProgressIndicator(modifier = Modifier.fillMaxWidth().padding(horizontal = HOME_GAP))
            if (state.error != null) {
                Text(
                    state.error ?: "Не удалось выполнить поиск.",
                    color = MaterialTheme.colorScheme.onBackground,
                    modifier = Modifier.padding(HOME_GAP),
                )
                TextButton(onClick = { state.attempt += 1 }, modifier = Modifier.padding(horizontal = HOME_GAP)) {
                    Text("Повторить поиск")
                }
            }

            val groups = state.outcome?.groups.orEmpty()
            if (!state.loading && state.error == null && state.completedQuery != null && groups.isEmpty()) {
                Text("По этому запросу источники не найдены.", style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onBackground, modifier = Modifier.padding(HOME_GAP))
            }
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                state = state.listState,
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
