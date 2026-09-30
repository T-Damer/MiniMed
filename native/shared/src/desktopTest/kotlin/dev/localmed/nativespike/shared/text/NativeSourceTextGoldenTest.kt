package dev.localmed.nativespike.shared.text

import dev.localmed.nativespike.shared.reader.NativeBlock
import dev.localmed.nativespike.shared.reader.NativeInline
import kotlinx.serialization.json.*
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class NativeSourceTextGoldenTest {
    private val json = Json { ignoreUnknownKeys = true; classDiscriminator = "kind" }

    @Test fun releasedSourceChunksAndWebBoundariesPreserveExactPresentation() {
        val resource = requireNotNull(javaClass.getResource("/native-source-text-golden.json"))
        val fixture = json.parseToJsonElement(resource.readText()).jsonObject
        val cases = fixture.getValue("cases").jsonArray
        assertEquals(115, cases.size)
        for (element in cases) {
            val case = element.jsonObject
            val name = case.getValue("name").jsonPrimitive.content
            val original = case.getValue("originalText").jsonPrimitive.content
            val stripped = case.getValue("strippedText").jsonPrimitive.content
            val spans = case["sourceSpans"]
            val metadata = json.parseToJsonElement(case.getValue("metadataJson").jsonPrimitive.content).jsonObject
            assertEquals(stripped, stripKnownHtmlMarkup(original), "$name: stripped text")
            assertEquals(json.decodeFromJsonElement<List<NativeSourceTextBlock>>(case.getValue("parseBlocks")),
                parseNativeSourceText(original, spans), "$name: original blocks")
            assertEquals(json.decodeFromJsonElement<List<NativeSourceTextBlock>>(case.getValue("displayBlocks")),
                parseNativeSourceText(stripped, spans), "$name: display blocks")
            val expected = case.getValue("renderBlock").takeUnless { it == JsonNull }
                ?.let { json.decodeFromJsonElement<NativeSourceRichBlock>(it) }
            val rich = readNativeSourceRichBlock(metadata)
            assertEquals(expected, rich, "$name: rich metadata")
            assertEquals(case.getValue("renderSearchText").takeUnless { it == JsonNull }?.jsonPrimitive?.content,
                rich?.searchText(), "$name: rich search text")
            // The adapter must emit real reader blocks, including ordinary extracted prose.
            val reader = nativeSourceReaderBlocks(original, metadata)
            assertTrue(reader.isNotEmpty() || case.getValue("displayBlocks").jsonArray.isEmpty(), "$name: reader blocks")
        }
    }

    @Test fun readerAdapterGroupsWebListsAndHidesAuthoringBoldMarkers() {
        val blocks = nativeSourceReaderBlocks("1. **A**\n\n4. B", JsonObject(emptyMap()))
        val list = blocks.single() as NativeBlock.ListBlock
        assertEquals(1, list.start)
        assertEquals(2, list.items.size)
        assertEquals(listOf(NativeInline.Text("A")), (list.items[0].blocks.single() as NativeBlock.Paragraph).inlines)
        assertEquals(listOf(NativeBlock.Raw("2147483648. Item")), nativeSourceReaderBlocks("2147483648. Item", JsonObject(emptyMap())))
    }

    @Test fun readerAdapterKeepsLiteralTextAndExplicitOrdinalsWithoutLoadingRemoteImages() {
        val blocks = nativeSourceReaderBlocks("• Давление <38°C\n\n3. Оригинальный пункт\n\n![Схема](https://example.test/image.png)", JsonObject(emptyMap()))
        assertEquals(NativeBlock.ListBlock(false, 1, listOf(dev.localmed.nativespike.shared.reader.NativeListItem(
            listOf(NativeBlock.Paragraph(listOf(NativeInline.Text("Давление <38°C"))))))), blocks[0])
        assertEquals(3, (blocks[1] as NativeBlock.ListBlock).start)
        assertEquals(NativeBlock.Image("https://example.test/image.png", "Схема", null), blocks[2])
    }
}
