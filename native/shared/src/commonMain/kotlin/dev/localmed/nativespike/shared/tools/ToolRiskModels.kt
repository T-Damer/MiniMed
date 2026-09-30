package dev.localmed.nativespike.shared.tools

import kotlin.math.exp
import kotlin.math.floor
import kotlin.math.ln

/** Named expression functions from the existing schema language, independent of tool identities. */
internal class ToolRiskModels(private val tables: Map<String, GailTable>) {
    fun gail(age: Double, horizon: Double, race: String, biopsies: Double, menarcheInput: Double, birthInput: Double, relativesInput: Double, atypical: Double): Double {
        val data = tables[race] ?: throw ToolExpressionError("Unknown Gail model race.")
        val menarche = if(race == "black" && menarcheInput == 2.0) 1.0 else menarcheInput
        val birth = when(race) { "black" -> 0.0; "hispanic" -> if(birthInput >= 3) 2.0 else if(birthInput == 2.0) 1.0 else 0.0; else -> birthInput }
        val relatives = if((race == "hispanic" || race == "asian") && relativesInput == 2.0) 1.0 else relativesInput
        val below50 = exp(biopsies * data.beta[0] + menarche * data.beta[1] + birth * data.beta[2] + relatives * data.beta[3] + birth * relatives * data.beta[5] + ln(if(biopsies == 0.0) 1.0 else if(atypical == 1.0) 1.82 else 0.93))
        val above50 = below50 * exp(biopsies * data.beta[4]); val endAge = minOf(90.0, age + horizon)
        var current = age; var cumulative = 0.0; var result = 0.0
        while(current < endAge) {
            val band = maxOf(0, minOf(13, floor((current - 20) / 5).toInt())); val next = minOf(endAge, 20.0 + (band + 1) * 5)
            // Schema inputs bound ages to the published model. A malformed direct expression must terminate.
            if(next <= current) throw ToolExpressionError("Gail model age is outside the supported integration domain.")
            val duration = next - current; val relative = if(current < 50) below50 else above50
            val attributable = data.attributableRisk[if(current < 50) 0 else 1]
            val incidence = data.incidence[band] * (1 - attributable) * relative; val mortality = data.mortality[band]; val combined = incidence + mortality
            result += (incidence / combined) * exp(-cumulative) * (1 - exp(-combined * duration))
            cumulative += combined * duration; current = next
        }
        return result * 100
    }
    fun cervical(age: Double, cytology: String, hpv: String, hpv16: String, prior: String, suppressed: String): Double = when {
        age < 25 && cytology != "hsil" && cytology != "agc" -> 1.0
        suppressed == "yes" || prior == "yes" -> 3.0
        hpv16 == "yes" || cytology == "hsil" || cytology == "agc" -> 3.0
        hpv == "positive" && cytology != "negative" -> 2.0
        hpv == "positive" || prior == "unknown" -> 2.0
        else -> 1.0
    }
}
