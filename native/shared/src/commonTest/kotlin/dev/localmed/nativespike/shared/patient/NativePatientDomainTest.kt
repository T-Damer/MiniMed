package dev.localmed.nativespike.shared.patient

import dev.localmed.nativespike.shared.tools.NativeToolInput
import dev.localmed.nativespike.shared.tools.NativeToolPatientBinding
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull
import kotlin.test.assertTrue

class NativePatientDomainTest {
    private fun domain(): NativePatientDomain { var id=0;return NativePatientDomain(NativePatientContext({"2025-01-02T00:00:00.000Z"},{"synthetic-${id++}"})) }
    @Test fun avatarRequiresOneExtendedGrapheme() {
        for(symbol in listOf("👩‍⚕️","👨‍👩‍👧‍👦","🇷🇺","👍🏽","е\u0301"))assertEquals(symbol,normalizeNativePatientAvatar(NativePatientAvatar("symbol"," $symbol ")).value)
        for(symbol in listOf("","AB","🇷🇺🇷🇺"))assertFailsWith<IllegalArgumentException> { normalizeNativePatientAvatar(NativePatientAvatar("symbol",symbol)) }
    }
    @Test fun revisionInClosedEpisodePreservesHistoricalValueAndStatus() {
        val d=domain();val profile=d.createPatientProfile(NativeCreatePatientProfileInput("Тест",id="p")).profile
        val episode=d.createClinicalEpisode(NativeCreateClinicalEpisodeInput("p",id="e"))
        var state=d.appendEpisode(NativePatientVaultSnapshot(profiles=listOf(profile)),episode)
        val event=d.createManualMeasurementEvent(NativeCreateMeasurementInput("p","glucose","Глюкоза",5.0,"ммоль/л",episodeId="e"))
        state=d.appendEvent(state,event);state=d.closeClinicalEpisode(state,"e")
        val before=state
        val revised=d.reviseManualObservation(state,event.observations.single().id,NativeReviseObservationInput(6.0))
        assertEquals(5.0,before.observations.single().value);assertEquals(5.0,revised.observations.first().value)
        assertEquals(6.0,revised.observations.last().value);assertEquals("closed",revised.episodes.single().status)
        assertEquals(revised.observations.last().id,revised.observations.first().supersededBy)
        assertFailsWith<IllegalArgumentException> { d.reviseManualObservation(revised,event.observations.single().id,NativeReviseObservationInput(7.0)) }
        assertEquals(before,state)
    }
    @Test fun explicitBindingDoesNotUseFutureOrWrongUnitMeasurement() {
        val d=domain();val created=d.createPatientProfile(NativeCreatePatientProfileInput("Тест",id="p",weightKg=70.0));var state=NativePatientVaultSnapshot(profiles=listOf(created.profile))
        created.initialEvents.forEach { state=d.appendEvent(state,it) }
        assertNull(d.patientBindingValue(NativeToolPatientBinding("latestObservation",metricId="body-mass",unit="кг"),created.profile,state,"2025-01-01"))
        assertNull(d.patientBindingValue(NativeToolPatientBinding("latestObservation",metricId="body-mass",unit="г"),created.profile,state,"2025-01-03"))
        assertEquals(NativeToolInput.Number(70.0),d.patientBindingValue(NativeToolPatientBinding("latestObservation",metricId="body-mass",unit="кг"),created.profile,state,"2025-01-03"))
    }
    @Test fun calendarAgeKeepsActualLeapAndEndOfMonthSemantics() {
        val d=domain();assertEquals(NativePatientAge(1,0,0),d.calculateAgeOnDate("2020-02-29","2021-03-01"))
        assertEquals(NativePatientAge(0,1,-1),d.calculateAgeOnDate("2020-01-31","2020-03-01"))
        assertFailsWith<IllegalArgumentException> { d.calculateAgeOnDate("2021-02-30","2021-03-01") }
    }
    @Test fun unitsAndToolVersionsRemainDifferentDynamicsSeries() {
        val d=domain();val p=d.createPatientProfile(NativeCreatePatientProfileInput("Тест",id="p")).profile;var s=NativePatientVaultSnapshot(profiles=listOf(p))
        for(unit in listOf("ммоль/л","мг/дл"))s=d.appendEvent(s,d.createManualMeasurementEvent(NativeCreateMeasurementInput("p","glucose","Глюкоза",5.0,unit)))
        assertEquals(listOf("1","2"),s.metricDefinitions.map { it.metricVersion })
        assertEquals(2,d.buildDynamics(s,"p").size);assertEquals(2,d.buildDynamicsGroups(s,"p").size)
        assertTrue(s.events.none { it.immutable })
    }
}
