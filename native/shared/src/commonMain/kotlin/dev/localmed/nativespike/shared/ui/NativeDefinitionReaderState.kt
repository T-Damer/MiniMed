package dev.localmed.nativespike.shared.ui

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import dev.localmed.nativespike.shared.core.NativeDefinitionBlock
import dev.localmed.nativespike.shared.core.NativeDefinitionSource
import dev.localmed.nativespike.shared.core.NativeDefinitionTextPage
import dev.localmed.nativespike.shared.core.NativeMedicalCore
import dev.localmed.nativespike.shared.core.NativeReaderRoute
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.isActive

/** Presentation paging only; all source identity, validation and content reads stay in core. */
class NativeDefinitionReaderState(val route: NativeReaderRoute.Definition) {
    private var textGeneration = 0
    var blocks by mutableStateOf<List<NativeDefinitionBlock>>(emptyList())
        private set
    var nextBlocks by mutableStateOf<String?>(null)
        private set
    var blocksLoaded by mutableStateOf(false)
        private set
    var blocksLoading by mutableStateOf(false)
        private set
    var blocksError by mutableStateOf<String?>(null)
        private set
    var selected by mutableStateOf<NativeDefinitionBlock?>(null)
        private set
    var offset by mutableStateOf(route.textOffsetCodepoints)
        private set
    var text by mutableStateOf<NativeDefinitionTextPage?>(null)
        private set
    var source by mutableStateOf<NativeDefinitionSource?>(null)
        private set
    var textLoading by mutableStateOf(false)
        private set
    var textError by mutableStateOf<String?>(null)
        private set
    var sourceError by mutableStateOf<String?>(null)
        private set

    suspend fun loadInitialBlocks(core: NativeMedicalCore) {
        blocksLoading = true
        blocksError = null
        try {
            var after = ""
            val loaded = mutableListOf<NativeDefinitionBlock>()
            var next: String?
            do {
                val page = core.definitionBlocks(route.target, after)
                loaded.addAll(page.blocks)
                next = page.next
                if (route.blockLinkId == null || loaded.any { it.linkId == route.blockLinkId } || next == null) break
                require(next != after) { "Reference cursor did not advance" }
                after = next
            } while (true)
            if (!currentCoroutineContext().isActive) return
            blocks = loaded
            nextBlocks = next
            blocksLoaded = true
            selected = if (route.blockLinkId == null) loaded.firstOrNull() else loaded.singleOrNull { it.linkId == route.blockLinkId }
            if (route.blockLinkId != null && selected == null) blocksError = "Сохранённый исходный блок в этой редакции не найден."
        } catch (cause: CancellationException) { throw cause }
        catch (cause: Exception) { blocksError = "Не удалось прочитать исходные блоки. Повторите попытку." }
        finally { blocksLoading = false }
    }

    suspend fun loadMoreBlocks(core: NativeMedicalCore) {
        val after = nextBlocks ?: return
        if (blocksLoading) return
        blocksLoading = true
        blocksError = null
        try {
            val page = core.definitionBlocks(route.target, after)
            require(page.next == null || page.next != after) { "Reference cursor did not advance" }
            blocks = (blocks + page.blocks).distinctBy { it.linkId }
            nextBlocks = page.next
        } catch (cause: CancellationException) { throw cause }
        catch (cause: Exception) { blocksError = "Не удалось прочитать следующие исходные блоки. Повторите попытку." }
        finally { blocksLoading = false }
    }

    fun position(index: Int, viewportOffset: Int): NativeReaderRoute.Definition? = selected?.let {
        route.copy(blockLinkId = it.linkId, textOffsetCodepoints = offset, firstVisibleItemIndex = index, firstVisibleItemOffset = viewportOffset)
    }

    fun select(block: NativeDefinitionBlock) {
        selected = block
        offset = 0
        text = null
        textError = null
        sourceError = null
        if (source?.id != block.sourceId) source = null
    }

    fun moveTo(offsetCodepoints: Int) {
        offset = offsetCodepoints
        text = null
        textError = null
    }

    fun previousBlock() {
        val index = blocks.indexOfFirst { it.linkId == selected?.linkId }
        blocks.getOrNull(index - 1)?.let(::select)
    }

    suspend fun nextBlock(core: NativeMedicalCore) {
        val index = blocks.indexOfFirst { it.linkId == selected?.linkId }
        if (index < 0) return
        if (index + 1 == blocks.size && nextBlocks != null) loadMoreBlocks(core)
        blocks.getOrNull(index + 1)?.let(::select)
    }

    suspend fun loadText(core: NativeMedicalCore) {
        val block = selected ?: return
        val requestedOffset = offset
        val generation = ++textGeneration
        textLoading = true
        textError = null
        sourceError = null
        try {
            val page = core.definitionText(route.target, block.chunkId, requestedOffset)
            if (!currentCoroutineContext().isActive || generation != textGeneration || selected != block || offset != requestedOffset) return
            text = page
            if (page == null) textError = "Исходный текст этого блока не найден."
            else if (source?.id != page.sourceId) {
                try {
                    val attribution = core.definitionSource(route.target, page.sourceId)
                    if (currentCoroutineContext().isActive && generation == textGeneration && selected == block && offset == requestedOffset) {
                        source = attribution
                        if (attribution == null) sourceError = "Сведения об источнике этого блока отсутствуют."
                    }
                } catch (cause: CancellationException) { throw cause }
                catch (cause: Exception) {
                    if (currentCoroutineContext().isActive && generation == textGeneration && selected == block && offset == requestedOffset) sourceError = "Не удалось прочитать сведения об источнике. Повторите попытку."
                }
            }
        } catch (cause: CancellationException) { throw cause }
        catch (cause: Exception) {
            if (currentCoroutineContext().isActive && generation == textGeneration && selected == block && offset == requestedOffset) textError = "Не удалось прочитать исходный текст. Повторите попытку."
        } finally {
            if (generation == textGeneration && selected == block && offset == requestedOffset) textLoading = false
        }
    }
}
