package dev.localmed.nativespike.shared.lexical

import dev.localmed.nativespike.shared.model.SearchDocumentSummary
import dev.localmed.nativespike.shared.text.normalizeSurfaceText
import dev.localmed.nativespike.shared.text.searchSubjectText

/**
 * A Kotlin port of `QueryDocumentIndex` (packages/core/src/query-document-index.ts) — stage 2
 * sub-stage D+ of the migration (docs/CURRENT_STATE.md, per the coordinator's decision after
 * reviewing the first sub-stage D report: this index is needed for golden parity — a document an
 * exact alias/title/navigation-alias names but no branch's own FTS search surfaces can never appear
 * in results without it).
 *
 * **Optimization-pass correction (docs/research/native-vs-webview-2026-09-28.md, "Optimization
 * pass"):** the claim this header used to make — "the real WebView pipeline builds this same index
 * once at startup" — is WRONG, found by actually reading `create-medical-core.ts` this pass.
 * `queryDocumentIndex` there is built LAZILY, inside the first `search()` call itself
 * (`if (indexedDocuments !== documents || !queryDocumentIndex || ...) { queryDocumentIndex = new
 * QueryDocumentIndex(documents); ... }`, around line 1184), cached only after that. WebView's cold
 * start never pays this cost; its FIRST QUERY does. `LookupEngine.kt` now builds this index in the
 * background right after construction (not blocking first frame, but also not waiting for the
 * user's first keystroke the way TS does) — see that file's header for why this is a deliberate
 * product-level improvement over TS's fully-lazy behavior, not an attempt to reproduce it exactly.
 *
 * Built ONCE from `NativeSearchDatabase.listSearchDocuments()` (the whole ~20k-document corpus),
 * not per query — mirrors `create-medical-core.ts` caching `queryDocumentIndex` across searches and
 * only rebuilding it when the document list changes. Callers (`LookupPipeline.kt`'s
 * `runLookupPipeline`) take a pre-built `QueryDocumentIndex` rather than building one per call.
 *
 * **Optimization-pass memory fix**: this class used to also keep `byId: Map<String,
 * SearchDocumentSummary>` — a full copy of every one of the ~20k documents' title/shortTitle/
 * sourceType/declaredAliases/navigationAliases, retained for the process lifetime — purely to
 * compute `availableIds` via `byId.keys`. Nothing else ever read `byId` (confirmed: no reference
 * anywhere outside this file). Removed; `availableIds` is now collected directly, so this index
 * retains only the id strings and the four identity-lookup maps it actually uses, not a second copy
 * of the whole corpus's document summaries.
 */
class QueryDocumentIndex(documents: List<SearchDocumentSummary>) {
    val availableIds: Set<String>

    /** Most identities name one document; allocate an ordered set only for real ambiguity. */
    private class IdentityIds(private val first: String) {
        private var multiple: LinkedHashSet<String>? = null
        fun add(id: String) {
            if (id == first) return
            val current = multiple
            if (current == null) multiple = linkedSetOf(first, id) else current.add(id)
        }
        fun values(): Set<String> = multiple ?: setOf(first)
    }

    private val aliases = HashMap<String, IdentityIds>()
    private val titles = HashMap<String, IdentityIds>()
    private val navigationAliases = HashMap<String, IdentityIds>()
    private val shortTitles = HashMap<String, IdentityIds>()

    init {
        val ids = HashSet<String>(documents.size * 2)
        for (document in documents) {
            ids.add(document.id)
            addIdentity(document.title, document.id, titles)
            if (!document.shortTitle.isNullOrEmpty()) addIdentity(document.shortTitle, document.id, shortTitles)
            for (name in document.declaredAliases) addIdentity(name, document.id, aliases)
            for (name in document.navigationAliases) {
                val normalized = normalizeSurfaceText(name)
                addNormalizedIdentity(normalized, document.id, aliases)
                addNormalizedIdentity(normalized, document.id, navigationAliases)
            }
        }
        availableIds = ids
    }

    private fun addIdentity(value: String, documentId: String, index: MutableMap<String, IdentityIds>) {
        addNormalizedIdentity(normalizeSurfaceText(value), documentId, index)
    }

    private fun addNormalizedIdentity(normalized: String, documentId: String, index: MutableMap<String, IdentityIds>) {
        index.getOrPut(normalized) { IdentityIds(documentId) }.add(documentId)
    }

    fun exactAliasIds(query: String): Set<String> = aliases[searchSubjectText(query)]?.values() ?: emptySet()
    fun exactTitleIds(query: String): Set<String> = titles[searchSubjectText(query)]?.values() ?: emptySet()
    fun exactNavigationAliasIds(query: String): Set<String> = navigationAliases[searchSubjectText(query)]?.values() ?: emptySet()
    fun exactShortTitleIds(query: String): Set<String> = shortTitles[searchSubjectText(query)]?.values() ?: emptySet()
    fun exactIdentityIds(query: String): Set<String> =
        exactTitleIds(query) + exactNavigationAliasIds(query) + exactShortTitleIds(query)
}
