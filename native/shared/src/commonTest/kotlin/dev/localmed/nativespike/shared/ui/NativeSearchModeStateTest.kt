package dev.localmed.nativespike.shared.ui

import dev.localmed.nativespike.shared.core.NativeSearchSnapshot
import dev.localmed.nativespike.shared.model.NativeSearchSelection
import dev.localmed.nativespike.shared.model.NativeSearchScope
import dev.localmed.nativespike.shared.model.NativeSearchFilters
import dev.localmed.nativespike.shared.model.NativeSearchMode
import dev.localmed.nativespike.shared.model.SearchOutcome
import dev.localmed.nativespike.shared.model.SearchTiming
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import kotlin.test.assertSame

class NativeSearchModeStateTest {
    @Test fun readinessRestoresSavedSearchUnlessTheUserEditedOrSubmittedTheStartupField() {
        val saved = NativeSearchSnapshot("сохранённый запрос", 7, 80, NativeSearchMode.CLINICAL)
        val untouched = NativeSearchUiState(NativeSearchSnapshot())
        assertEquals(saved, untouched.restoreWhenUntouched(saved).snapshot())
        val edited = NativeSearchUiState(NativeSearchSnapshot())
        edited.updateQuery("пневмония")
        edited.submit(waitingForCore = true)
        assertSame(edited, edited.restoreWhenUntouched(saved))
        assertEquals("пневмония", edited.restoreWhenUntouched(saved).query)
        edited.updateQuery("")
        assertSame(edited, edited.restoreWhenUntouched(saved))
        assertEquals("", edited.restoreWhenUntouched(saved).query)
        val cleared = NativeSearchUiState(NativeSearchSnapshot())
        cleared.updateQuery("черновик")
        cleared.updateQuery("")
        assertSame(cleared, cleared.restoreWhenUntouched(saved))
    }
    @Test fun queryQueuedBeforeCoreReadinessRemainsEditableAndDoesNotAttachToANewerDraft() {
        val state = NativeSearchUiState(NativeSearchSnapshot())
        state.submit(waitingForCore = true)
        assertNull(state.queuedQuery)
        assertEquals(0, state.attempt)
        state.updateQuery("пневмония")
        state.submit(waitingForCore = true)
        assertEquals("пневмония", state.queuedQuery)
        assertEquals("пневмония", state.snapshot().query)
        state.updateQuery("цефтриаксон")
        assertNull(state.queuedQuery)
        state.submit(waitingForCore = true)
        state.completeQueuedQuery("пневмония")
        assertEquals("цефтриаксон", state.queuedQuery)
        state.completeQueuedQuery("цефтриаксон")
        assertNull(state.queuedQuery)
        assertEquals(2, state.attempt)
        state.submit(waitingForCore = false)
        assertNull(state.queuedQuery)
        assertEquals(3, state.attempt)
    }
    @Test fun sameQueryModeSwitchRejectsLateExactNameHitsUntilLookupReturns() {
        val state = NativeSearchUiState(NativeSearchSnapshot("АО"))
        assertTrue(state.acceptsLookupIdentities("АО", NativeSearchMode.LOOKUP))
        state.updateMode(NativeSearchMode.CLINICAL)
        assertFalse(state.acceptsLookupIdentities("АО", NativeSearchMode.LOOKUP))
        assertFalse(state.acceptsLookupIdentities("АО", NativeSearchMode.CLINICAL))
        state.updateMode(NativeSearchMode.LOOKUP)
        assertTrue(state.acceptsLookupIdentities("АО", NativeSearchMode.LOOKUP))
        state.updateQuery("АД")
        assertFalse(state.acceptsLookupIdentities("АО", NativeSearchMode.LOOKUP))
    }

    @Test fun restoredModeKeepsItsViewportButModeChangeResetsBeforeLayoutCanFlushOldPosition() {
        val snapshot = NativeSearchSnapshot("клиническое описание", 7, 80, NativeSearchMode.CLINICAL)
        val state = NativeSearchUiState(snapshot)
        assertEquals(snapshot, state.snapshot())
        state.outcome = SearchOutcome(emptyList(), SearchTiming(0.0, 0.0), NativeSearchMode.CLINICAL)
        state.completedQuery = state.query
        state.completedMode = NativeSearchMode.CLINICAL
        state.updateMode(NativeSearchMode.LOOKUP)
        assertEquals(NativeSearchSnapshot(snapshot.query, mode = NativeSearchMode.LOOKUP), state.snapshot())
        assertNull(state.outcome)
        assertNull(state.completedQuery)
        assertNull(state.completedMode)
    }

    @Test fun changedQueryKeepsExplicitModeAndRejectsInvalidInputWithoutTruncation() {
        val state = NativeSearchUiState(NativeSearchSnapshot("исходный запрос", 9, 40, NativeSearchMode.CLINICAL))
        state.updateQuery("новое описание")
        assertEquals(NativeSearchSnapshot("новое описание", mode = NativeSearchMode.CLINICAL), state.snapshot())
        state.updateQuery("x".repeat(20_001))
        assertEquals("новое описание", state.query)
        assertEquals(NativeSearchMode.CLINICAL, state.mode)
        state.updateQuery("ещё один запрос")
        assertNull(state.inputError)
    }
    @Test fun scopeAndFilterChangesRejectOldSameQueryRequestsAndResetViewport() {
        val selection=NativeSearchSelection(NativeSearchScope.GUIDELINES,NativeSearchFilters(ageGroups=listOf("children")))
        val snapshot=NativeSearchSnapshot("энцефалит",8,70,selection=selection)
        val state=NativeSearchUiState(snapshot)
        assertEquals(snapshot,state.snapshot())
        assertTrue(state.acceptsRequest(state.query,state.mode,selection))
        val changed=selection.copy(scope=NativeSearchScope.MEDICATIONS)
        state.updateSelection(changed)
        assertFalse(state.acceptsRequest(state.query,state.mode,selection))
        assertFalse(state.acceptsLookupIdentities(state.query,state.mode,selection))
        assertEquals(NativeSearchSnapshot(snapshot.query,selection=changed),state.snapshot())
        val newFilters=changed.copy(filters=NativeSearchFilters(ageGroups=listOf("adults")))
        state.updateSelection(newFilters)
        assertFalse(state.acceptsRequest(state.query,state.mode,changed))
        assertTrue(state.acceptsLookupIdentities(state.query,state.mode,newFilters))
        assertEquals(newFilters,NativeSearchUiState(state.snapshot()).selection)
    }
}
