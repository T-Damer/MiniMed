package dev.localmed.nativespike.shared.search

import dev.localmed.nativespike.shared.db.NativeSearchDatabase
import dev.localmed.nativespike.shared.lexical.AliasExpander
import dev.localmed.nativespike.shared.lexical.MedicationSpellingMatcher
import dev.localmed.nativespike.shared.lexical.QueryDocumentIndex
import dev.localmed.nativespike.shared.lexical.buildQueryDocumentIndex
import dev.localmed.nativespike.shared.lexical.createAliasExpander
import dev.localmed.nativespike.shared.lexical.createMedicationSpellingMatcher
import dev.localmed.nativespike.shared.lexical.filterQueryAliases
import dev.localmed.nativespike.shared.lexical.runLookupPipelineGroups
import dev.localmed.nativespike.shared.lexical.sortAliasesLikeMultiMedicalStore
import dev.localmed.nativespike.shared.model.AliasRecord
import dev.localmed.nativespike.shared.model.DocumentKind
import dev.localmed.nativespike.shared.model.SearchOutcome
import dev.localmed.nativespike.shared.model.SearchResultGroup
import dev.localmed.nativespike.shared.model.SearchResultItem
import dev.localmed.nativespike.shared.model.SearchTiming
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlin.time.TimeSource

private const val GROUP_LIMIT = 20
private const val ITEMS_PER_GROUP = 3

/**
 * Stage 4 (docs/CURRENT_STATE.md): the full ported pipeline (stage 2 sub-stages A-D —
 * `buildLookupQueryPlan`, SQL branch execution, fusion/grouping/ranking, `QueryDocumentIndex`)
 * wired into the spike UI, replacing `SearchEngine`'s deliberately simplified single-branch
 * matcher (kept in the tree, unreferenced, for anyone who wants the pre-stage-2 baseline).
 *
 * **Optimization pass** (docs/research/native-vs-webview-2026-09-28.md, "Optimization pass"):
 * stage 4's first measurement found this pipeline building THREE vocabulary/index structures ON
 * EVERY QUERY (`createAliasExpander`'s fuzzy-match head index, `createMedicationSpellingMatcher`'s
 * spelling index, both over the whole alias table; `QueryDocumentIndex` was already built once).
 * Profiling (this pass's stage-timing table) confirmed the alias/spelling index rebuilds were the
 * dominant per-query cost. All three are now built exactly ONCE here, in the constructor, and
 * reused across every `search()` call — the reason the pipeline was ever rebuilding them per call
 * was that `LookupPipeline.kt`'s functions accept them as OPTIONAL parameters (for golden-parity
 * tests that intentionally rebuild a small vocabulary per call), not that reuse was impossible.
 *
 * **Checked against the real TS source this pass** (`create-medical-core.ts`, `expandAliases`'s and
 * `medication-lookup.ts`'s own `WeakMap`/module-level caches): all three of TS's equivalent
 * structures are built LAZILY, inside the first `search()` call itself, cached by object identity
 * thereafter — NOT eagerly at app startup, contrary to this file's stage-4 header, which incorrectly
 * assumed `QueryDocumentIndex` construction was staged at WebView startup. Rather than reproduce
 * TS's lazy-on-first-query behavior exactly (which would make the FIRST real query pay the full
 * build cost, same as WebView does), this port starts building all three in the background right
 * after construction, not blocking the constructor or first frame — a deliberate improvement over
 * both TS's lazy approach and this port's own former eager/blocking stage-4 approach: cold start is
 * not slowed down (nothing blocks in `init`), and by the time a real user finishes typing their
 * first query (debounced 120ms in `SearchScreen.kt`, plus normal typing time), the background builds
 * are very likely already done, so `search()`'s `.await()` on them is usually a no-op.
 * `indexBuildMs`/`vocabularyBuildMs` are recorded once each finishes and exposed so `MainActivity`
 * can log them on its own schedule — separate from "search-ready" and from any single query's
 * latency, so neither number silently absorbs this cost.
 *
 * **Crash found and fixed during this pass**: the first version of this background warm-up ran
 * vocabulary-build and `QueryDocumentIndex`-build as two SEPARATE `engineScope.async` coroutines.
 * `NativeSearchDatabase` opens exactly one `SQLiteConnection` and is documented as "read-only,
 * single connection... single-threaded by design" (see that class's header) — but `Dispatchers.
 * Default` is a thread pool, so those two coroutines could and did land on two different worker
 * threads and call into the bundled SQLite JNI bridge AT THE SAME TIME. Reproduced on-device: a
 * native `SIGSEGV` in a `DefaultDispatcher-worker` thread inside `libsqliteJni.so`, every cold
 * start, a few hundred ms after "search-ready" logged (right when both background builds' DB reads
 * would have raced). Fixed by moving both builds into ONE background coroutine (`engineScope.launch`
 * below), run strictly sequentially — `documentIndexDeferred` only completes after the vocabulary
 * build's DB reads are entirely finished, so `search()` awaiting both before touching the database
 * itself can never overlap with this warm-up's own DB access either.
 */
class LookupEngine(private val database: NativeSearchDatabase) {
    private val engineScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    private class Vocabulary(
        val aliases: List<AliasRecord>,
        val aliasExpander: AliasExpander,
        val medicationMatcher: MedicationSpellingMatcher,
    )

    /** Set once the background vocabulary build completes — see this class's header. */
    var vocabularyBuildMs: Double = 0.0
        private set

    /** Set once the background `QueryDocumentIndex` build completes — see this class's header. */
    var indexBuildMs: Double = 0.0
        private set

    private val vocabularyDeferred = CompletableDeferred<Vocabulary>()
    private val documentIndexDeferred = CompletableDeferred<QueryDocumentIndex>()

    init {
        // One coroutine, strictly sequential DB access — see this class's crash-fix note above.
        engineScope.launch {
            val startedVocabulary = TimeSource.Monotonic.markNow()
            val aliases = filterQueryAliases(sortAliasesLikeMultiMedicalStore(database.listAliases()))
            val aliasExpander = createAliasExpander(aliases)
            val medicationMatcher = createMedicationSpellingMatcher(aliases)
            vocabularyBuildMs = startedVocabulary.elapsedNow().inWholeMicroseconds / 1000.0
            vocabularyDeferred.complete(Vocabulary(aliases, aliasExpander, medicationMatcher))

            val startedIndex = TimeSource.Monotonic.markNow()
            val index = buildQueryDocumentIndex(database)
            indexBuildMs = startedIndex.elapsedNow().inWholeMicroseconds / 1000.0
            documentIndexDeferred.complete(index)
        }
    }

    /** Lets a caller (e.g. `MainActivity`, for cold-start logging) observe background-build
     * completion without running a real search. Safe to call from any dispatcher. */
    suspend fun awaitReady() {
        vocabularyDeferred.await()
        documentIndexDeferred.await()
    }

    /**
     * `onStage`, when non-null, receives `(stageName, ms)` for every timed phase of this query —
     * see `PipelineTiming.kt`/the pipeline files it's threaded through. Used by the debug bench path
     * (`MainActivity`) to build the stage-timing table in "Optimization pass"; `null` for every
     * ordinary UI-driven search (zero overhead — see `timedStage`'s doc).
     */
    suspend fun search(query: String, onStage: ((String, Double) -> Unit)? = null): SearchOutcome? {
        if (query.isBlank()) return null
        val vocabulary = vocabularyDeferred.await()
        val documentIndex = documentIndexDeferred.await()
        val started = TimeSource.Monotonic.markNow()
        val groups = runLookupPipelineGroups(
            query, vocabulary.aliases, database, documentIndex, GROUP_LIMIT,
            vocabulary.aliasExpander, vocabulary.medicationMatcher, onStage,
        )
        val totalMs = started.elapsedNow().inWholeMicroseconds / 1000.0

        val uiGroups = groups.map { group ->
            SearchResultGroup(
                documentId = group.documentId,
                documentTitle = group.title,
                documentKind = DocumentKind.fromSourceType(group.results.firstOrNull()?.sourceType ?: ""),
                items = group.results.take(ITEMS_PER_GROUP).map { result ->
                    SearchResultItem(
                        chunkId = result.chunkId,
                        sectionId = result.sectionId,
                        sectionPath = result.sectionPath.joinToString(" › "),
                        anchor = result.anchor,
                        snippet = result.previewText,
                    )
                },
            )
        }
        return SearchOutcome(groups = uiGroups, timing = SearchTiming(sqlOnlyMs = totalMs, totalMs = totalMs))
    }
}
