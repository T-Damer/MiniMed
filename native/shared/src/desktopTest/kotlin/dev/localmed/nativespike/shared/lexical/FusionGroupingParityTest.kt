package dev.localmed.nativespike.shared.lexical

import dev.localmed.nativespike.shared.assertLookupParity
import kotlin.test.Test

class FusionGroupingParityTest {
    @Test
    fun full_pipeline_groups_and_source_passages_match_the_real_pipeline() = assertLookupParity()
}
