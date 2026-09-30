package dev.localmed.nativespike.shared.user

import dev.localmed.nativespike.shared.core.NativeContentIO
import dev.localmed.nativespike.shared.tools.NativeCalculatorDraft
import dev.localmed.nativespike.shared.tools.NativeAssessmentDraft
import dev.localmed.nativespike.shared.tools.NativeCalculatorResult
import dev.localmed.nativespike.shared.tools.NativeAssessmentResult
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.Required
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

@Serializable enum class NativeToolEntry { Catalog, Search, Collections }

@Serializable sealed interface NativeToolRoute {
    @Serializable data object Catalog: NativeToolRoute
    @Serializable data class Tool(val id: String,val version: String,val entry: NativeToolEntry=NativeToolEntry.Catalog): NativeToolRoute
}
@Serializable data class NativeSavedTool(
    val id: String,val version: String,val calculator: NativeCalculatorDraft?=null,
    val assessment: NativeAssessmentDraft?=null,val calculatorResult: NativeCalculatorResult?=null,
    val assessmentResult: NativeAssessmentResult?=null,
)
@Serializable data class NativeToolsSnapshot(@Required val schemaVersion: Int=1,@Required val route: NativeToolRoute?=null,
    @Required val query: String="",@Required val drafts: List<NativeSavedTool> = emptyList())
class NativeToolsFormatException: IllegalArgumentException("Unsupported or damaged private tools format")

/** Atomic private drafts/results; an unreadable or unknown file is preserved verbatim. */
class NativeToolsState(private val io: NativeContentIO) {
    private val mutex=Mutex();private val json=Json { encodeDefaults=true }
    private val mutable=MutableStateFlow<NativeToolsSnapshot?>(null)
    val snapshot=mutable.asStateFlow()
    private val path="native-tools-state.json"
    suspend fun load()=mutex.withLock {
        if(mutable.value!=null) return@withLock
        val loaded=if(io.exists(path)) try { json.decodeFromString<NativeToolsSnapshot>(io.readText(path)).also(::validate) }
        catch(cause: SerializationException) { throw NativeToolsFormatException() }
        catch(cause: IllegalArgumentException) { throw NativeToolsFormatException() } else NativeToolsSnapshot()
        mutable.value=loaded
    }
    suspend fun route(value: NativeToolRoute?)=mutate { it.copy(route=value) }
    suspend fun query(value: String)=mutate { it.copy(query=value) }
    suspend fun save(value: NativeSavedTool)=mutate { it.copy(drafts=(it.drafts.filterNot { old -> old.id==value.id && old.version==value.version }+value)) }
    suspend fun awaitWrites()=mutex.withLock { }
    private suspend fun mutate(change: (NativeToolsSnapshot)->NativeToolsSnapshot)=mutex.withLock {
        val current=requireNotNull(mutable.value) { "Tools state is not loaded" };val next=change(current);validate(next)
        if(next!=current) { io.writeTextAtomic(path,json.encodeToString(next));mutable.value=next }
    }
    private fun validate(value: NativeToolsSnapshot) {
        require(value.schemaVersion==1 && value.query.length<=20_000 && '\u0000' !in value.query && value.drafts.size<=200)
        fun id(text: String) { require(text.isNotBlank() && text.length<=256 && '\u0000' !in text) }
        (value.route as? NativeToolRoute.Tool)?.let { id(it.id);id(it.version) }
        require(value.drafts.map { it.id to it.version }.distinct().size==value.drafts.size)
        value.drafts.forEach { draft ->
            id(draft.id);id(draft.version);require((draft.calculator!=null) != (draft.assessment!=null))
            draft.calculator?.let { require(it.toolId==draft.id && it.stage>=0);it.inputs.forEach { (key,text) -> id(key);require(text.length<=20_000 && '\u0000' !in text) };require(draft.assessmentResult==null) }
            draft.assessment?.let { require(it.toolId==draft.id);it.answers.forEach { (key,number) -> id(key);require(number.isFinite()) };require(draft.calculatorResult==null) }
            (draft.calculatorResult as? NativeCalculatorResult.Success)?.let { require(it.calculatorId==draft.id) }
            (draft.assessmentResult as? NativeAssessmentResult.Success)?.let { require(it.value.assessmentId==draft.id) }
        }
    }
}
