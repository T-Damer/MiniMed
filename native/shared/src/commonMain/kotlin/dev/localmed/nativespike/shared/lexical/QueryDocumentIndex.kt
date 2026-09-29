package dev.localmed.nativespike.shared.lexical

import dev.localmed.nativespike.shared.model.SearchDocumentSummary
import dev.localmed.nativespike.shared.text.normalizeSurfaceText
import dev.localmed.nativespike.shared.text.searchSubjectText

/**
 * A Kotlin port of `QueryDocumentIndex` (packages/core/src/query-document-index.ts) — stage 2
 * sub-stage D+ of the migration (docs/CURRENT_STATE.md, per the coordinator's decision after
 * reviewing the first sub-stage D report: this index is needed for both golden parity — a document
 * an exact alias/title/navigation-alias names but no branch's own FTS search surfaces can never
 * appear in results without it — and for an honest cold-start timing measurement, since the real
 * WebView pipeline builds this same index once at startup).
 *
 * Built ONCE from `NativeSearchDatabase.listSearchDocuments()` (the whole ~20k-document corpus),
 * not per query — mirrors `create-medical-core.ts` caching `queryDocumentIndex` across searches and
 * only rebuilding it when the document list changes. Callers (`LookupPipeline.kt`'s
 * `runLookupPipeline`) take a pre-built `QueryDocumentIndex` rather than building one per call.
 */
class QueryDocumentIndex(documents: List<SearchDocumentSummary>) {
    val byId: Map<String, SearchDocumentSummary> = documents.associateBy { it.id }
    val availableIds: Set<String> = byId.keys

    private val aliases = HashMap<String, MutableSet<String>>()
    private val titles = HashMap<String, MutableSet<String>>()
    private val navigationAliases = HashMap<String, MutableSet<String>>()
    private val shortTitles = HashMap<String, MutableSet<String>>()

    init {
        for (document in documents) {
            addIdentity(document.title, document.id, titles)
            if (!document.shortTitle.isNullOrEmpty()) addIdentity(document.shortTitle, document.id, shortTitles)
            for (name in document.declaredAliases) addIdentity(name, document.id, aliases)
            for (name in document.navigationAliases) {
                addIdentity(name, document.id, aliases)
                addIdentity(name, document.id, navigationAliases)
            }
        }
    }

    private fun addIdentity(value: String, documentId: String, index: MutableMap<String, MutableSet<String>>) {
        val normalized = normalizeSurfaceText(value)
        index.getOrPut(normalized) { LinkedHashSet() }.add(documentId)
    }

    fun exactAliasIds(query: String): Set<String> = aliases[searchSubjectText(query)] ?: emptySet()
    fun exactTitleIds(query: String): Set<String> = titles[searchSubjectText(query)] ?: emptySet()
    fun exactNavigationAliasIds(query: String): Set<String> = navigationAliases[searchSubjectText(query)] ?: emptySet()
    fun exactShortTitleIds(query: String): Set<String> = shortTitles[searchSubjectText(query)] ?: emptySet()
    fun exactIdentityIds(query: String): Set<String> =
        exactTitleIds(query) + exactNavigationAliasIds(query) + exactShortTitleIds(query)
}
