export type GailRace = 'white' | 'black' | 'hispanic' | 'asian' | 'other';

interface GailModelData {
  readonly beta: readonly [number, number, number, number, number, number];
  readonly incidence: readonly number[];
  readonly mortality: readonly number[];
  readonly attributableRisk: readonly [number, number];
}

const GAIL_MODEL_DATA: Record<GailRace, GailModelData> = {
  white: {
    beta: [0.5292641686, 0.0940103059, 0.2186262218, 0.9583027845, -0.288042483, -0.1908113865],
    incidence: [
      0.00001, 0.000076, 0.000266, 0.000661, 0.001265, 0.001866, 0.002211, 0.002721, 0.003348,
      0.003923, 0.004178, 0.004439, 0.004421, 0.004109,
    ],
    mortality: [
      0.000493, 0.000531, 0.000625, 0.000825, 0.001307, 0.002181, 0.003655, 0.005852, 0.009439,
      0.015028, 0.023839, 0.038832, 0.066828, 0.144908,
    ],
    attributableRisk: [0.5788413, 0.5788413],
  },
  black: {
    beta: [0.1822121131, 0.2672530336, 0, 0.4757242578, -0.1119411682, 0],
    incidence: [
      0.00002696, 0.00011295, 0.00031094, 0.00067639, 0.00119444, 0.00187394, 0.00241504,
      0.00291112, 0.00310127, 0.0036656, 0.00393132, 0.00408951, 0.00396793, 0.00363712,
    ],
    mortality: [
      0.00074354, 0.00101698, 0.00145937, 0.00215933, 0.00315077, 0.00448779, 0.00632281,
      0.00963037, 0.01471818, 0.02116304, 0.03266035, 0.04564087, 0.06835185, 0.13271262,
    ],
    attributableRisk: [0.7294988, 0.74397137],
  },
  hispanic: {
    beta: [0.0970783641, 0, 0.2318368334, 0.166685441, 0, 0],
    incidence: [
      0.0000166, 0.0000741, 0.000274, 0.0006099, 0.0012225, 0.0019027, 0.0023142, 0.0028357,
      0.0031144, 0.0030794, 0.0033344, 0.0035082, 0.0025308, 0.0020414,
    ],
    mortality: [
      0.0003561, 0.0004038, 0.0005281, 0.0008875, 0.0013987, 0.0020769, 0.0030912, 0.004696,
      0.007605, 0.0120555, 0.0193805, 0.0288386, 0.0429634, 0.0740349,
    ],
    attributableRisk: [0.749294788397, 0.778215491668],
  },
  asian: {
    beta: [0.55263612260619, 0.07499257592975, 0.27638268294593, 0.79185633720481, 0, 0],
    incidence: [
      0.000004059636, 0.000045944465, 0.000188279352, 0.000492930493, 0.000913603501,
      0.001471537353, 0.001421275482, 0.001970946494, 0.001674745804, 0.001821581075,
      0.001834477198, 0.001919911972, 0.002233371071, 0.002247315779,
    ],
    mortality: [
      0.000210649076, 0.000192644865, 0.000244435215, 0.000317895949, 0.000473261994, 0.00080027138,
      0.001217480226, 0.002099836508, 0.003436889186, 0.006097405623, 0.010664526765,
      0.020148678452, 0.03799079659, 0.098333900733,
    ],
    attributableRisk: [0.47519806426735, 0.50316401683903],
  },
  other: {
    beta: [0.5292641686, 0.0940103059, 0.2186262218, 0.9583027845, -0.288042483, -0.1908113865],
    incidence: [
      0.00001, 0.000076, 0.000266, 0.000661, 0.001265, 0.001866, 0.002211, 0.002721, 0.003348,
      0.003923, 0.004178, 0.004439, 0.004421, 0.004109,
    ],
    mortality: [
      0.000493, 0.000531, 0.000625, 0.000825, 0.001307, 0.002181, 0.003655, 0.005852, 0.009439,
      0.015028, 0.023839, 0.038832, 0.066828, 0.144908,
    ],
    attributableRisk: [0.5788413, 0.5788413],
  },
};

/** NCI BCRAT/Gail absolute-risk integration, using the published package constants. */
export function calculateGailRisk(
  ageYears: number,
  horizonYears: number,
  race: GailRace,
  biopsiesCategory: number,
  menarcheCategory: number,
  firstBirthCategory: number,
  relativesCategory: number,
  atypicalHyperplasia: number,
): number {
  const data = GAIL_MODEL_DATA[race];
  const menarche = race === 'black' && menarcheCategory === 2 ? 1 : menarcheCategory;
  let firstBirth = firstBirthCategory;
  if (race === 'black') firstBirth = 0;
  if (race === 'hispanic') firstBirth = firstBirth >= 3 ? 2 : firstBirth === 2 ? 1 : 0;
  let relatives = relativesCategory;
  if (race === 'hispanic' && relatives === 2) relatives = 1;
  if (race === 'asian' && relatives === 2) relatives = 1;

  const relativeRiskBelow50 = Math.exp(
    biopsiesCategory * data.beta[0] +
      menarche * data.beta[1] +
      firstBirth * data.beta[2] +
      relatives * data.beta[3] +
      firstBirth * relatives * data.beta[5] +
      Math.log(biopsiesCategory === 0 ? 1 : atypicalHyperplasia === 1 ? 1.82 : 0.93),
  );
  const relativeRiskAtLeast50 = relativeRiskBelow50 * Math.exp(biopsiesCategory * data.beta[4]);
  const endAge = Math.min(90, ageYears + horizonYears);
  let currentAge = ageYears;
  let cumulativeHazard = 0;
  let risk = 0;

  while (currentAge < endAge) {
    const ageBand = Math.max(0, Math.min(13, Math.floor((currentAge - 20) / 5)));
    const nextBandAge = Math.min(endAge, 20 + (ageBand + 1) * 5);
    const duration = nextBandAge - currentAge;
    const relativeRisk = currentAge < 50 ? relativeRiskBelow50 : relativeRiskAtLeast50;
    const attributableRisk = data.attributableRisk[currentAge < 50 ? 0 : 1];
    const adjustedIncidence =
      (data.incidence[ageBand] ?? 0) * (1 - attributableRisk) * relativeRisk;
    const mortality = data.mortality[ageBand] ?? 0;
    const combinedHazard = adjustedIncidence + mortality;
    risk +=
      (adjustedIncidence / combinedHazard) *
      Math.exp(-cumulativeHazard) *
      (1 - Math.exp(-combinedHazard * duration));
    cumulativeHazard += combinedHazard * duration;
    currentAge = nextBandAge;
  }
  return risk * 100;
}

export type CervicalCytology = 'negative' | 'ascus' | 'lsil' | 'hsil' | 'agc';
export type CervicalHpvStatus = 'negative' | 'positive';

/** Conservative ASCCP pathway band for common screening inputs; not an absolute cancer risk. */
export function calculateCervicalRiskBand(
  ageYears: number,
  cytology: CervicalCytology,
  hpvStatus: CervicalHpvStatus,
  hpv16Or18: 'no' | 'yes',
  priorCin2Plus: 'unknown' | 'negative' | 'yes',
  immunosuppressed: 'no' | 'yes',
): number {
  if (ageYears < 25 && cytology !== 'hsil' && cytology !== 'agc') return 1;
  if (immunosuppressed === 'yes' || priorCin2Plus === 'yes') return 3;
  if (hpv16Or18 === 'yes' || cytology === 'hsil' || cytology === 'agc') return 3;
  if (hpvStatus === 'positive' && cytology !== 'negative') return 2;
  if (hpvStatus === 'positive' || priorCin2Plus === 'unknown') return 2;
  return 1;
}
