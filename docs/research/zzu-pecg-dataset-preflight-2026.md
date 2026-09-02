# ZZU-pECG dataset preflight for a local pediatric manifest builder

**Date:** 2026-09-01
**Scope:** metadata-only preflight for Figshare article 27078763, *A pediatric ECG database with disease diagnosis covering 11643 children*. This note uses the publisher's Figshare record/API, the linked Scientific Data article, and the files served by that record. The raw split archive was not downloaded.

## Verdict

| Use case | Verdict | Boundary |
|---|---|---|
| Pediatric manifest/reference benchmark | **GO, metadata/reference only** | Build a 12-lead, patient-disjoint signal/reference manifest with source-native codes, age, sex, and quality fields. It is not a clinically validated benchmark. |
| Training a pediatric diagnostic model | **NO-GO now** | ZZU disease/ECG taxonomies do not safely become MiniMed's adult image labels ([ECGCode.csv](https://ndownloader.figshare.com/files/53512538), [DiseaseCode.csv](https://ndownloader.figshare.com/files/53512544)); raw-QC, label policy, and independent evaluation are still required. |
| Real-phone photo holdout | **NO-GO from ZZU** | The record exposes WFDB signal files, not photographed ECG images or phone-capture artifacts ([paper](https://www.nature.com/articles/s41597-025-05225-z)). |

The existing MiniMed contract has no pediatric diagnostic output; it only defines pediatric eligibility and a future training-manifest shape ([current state](../CURRENT_STATE.md), [manifest contract](../../tools/benchmarks/src/ecg-training-manifest.ts), [pediatric policy](ecg-pediatric-age-stratification-2026.md)).

## Identity, revision, and rights

The authoritative record is the [Springer Nature Figshare dataset page](https://springernature.figshare.com/articles/dataset/A_pediatric_ECG_database_with_disease_diagnosis_covering_11643_children/27078763) and its [Figshare article API response](https://api.figshare.com/v2/articles/27078763). The API reports:

- title: *A pediatric ECG database with disease diagnosis covering 11643 children*;
- version: 1;
- versioned DOI: [10.6084/m9.figshare.27078763.v1](https://doi.org/10.6084/m9.figshare.27078763.v1);
- published: 2025-05-27T07:01:31Z;
- modified: 2025-05-27T07:01:32Z;
- dataset size: 4,063,604,410 bytes;
- license: **CC BY 4.0**, [https://creativecommons.org/licenses/by/4.0/](https://creativecommons.org/licenses/by/4.0/).

Do not conflate the dataset license with the article license: the linked [Scientific Data paper](https://www.nature.com/articles/s41597-025-05225-z) identifies the article content as CC BY-NC-ND 4.0. The data payload should therefore be attributed under the Figshare record's CC BY terms, while paper text/figures remain subject to the article terms.

The publisher description reports 11,643 hospitalized children, 14,190 ECG records, 12,334 12-lead records, 1,856 9-lead records, 500 Hz sampling, 5–120 s duration, and 3,516 records diagnosed with cardiovascular disease; the paper describes the same core cohort and acquisition characteristics ([Figshare API](https://api.figshare.com/v2/articles/27078763), [paper](https://www.nature.com/articles/s41597-025-05225-z)).

## Authoritative file list

This is the complete file list returned by the [article API](https://api.figshare.com/v2/articles/27078763); each download URL is the publisher's direct Figshare URL.

| Filename | Figshare file id | Exact size (bytes) | MD5 | Direct download |
|---|---:|---:|---|---|
| <code>ECGCode.csv</code> | 53512538 | 3,632 | <code>7612c5af0e01e052eb85792c5e362f12</code> | [ndownloader.figshare.com/files/53512538](https://ndownloader.figshare.com/files/53512538) |
| <code>DiseaseCode.csv</code> | 53512544 | 2,965 | <code>0bff597c23397c0d05a937fe09807ad4</code> | [ndownloader.figshare.com/files/53512544](https://ndownloader.figshare.com/files/53512544) |
| <code>Child_ecg.zip</code> | 53523902 | 1,908,237,306 | <code>d7bb207d0f559c5f697bd7e442975718</code> | [ndownloader.figshare.com/files/53523902](https://ndownloader.figshare.com/files/53523902) |
| <code>Child_ecg.z01</code> | 53524583 | 2,147,483,648 | <code>4782e8c17b478745853db85210ce46aa</code> | [ndownloader.figshare.com/files/53524583](https://ndownloader.figshare.com/files/53524583) |
| <code>AttributesDictionary.csv</code> | 53580632 | 7,717,825 | <code>ffbbb7ebd8ad4425b3a859739eb65eb1</code> | [ndownloader.figshare.com/files/53580632](https://ndownloader.figshare.com/files/53580632) |
| <code>ExampleReadingCode.ipynb</code> | 53581268 | 159,034 | <code>66694258f55ea75bf3454546d486a0e5</code> | [ndownloader.figshare.com/files/53581268](https://ndownloader.figshare.com/files/53581268) |

The two raw members sum to 4,055,720,954 bytes. The three metadata CSVs sum to 7,724,422 bytes (about 7.37 MiB); adding the optional notebook gives 7,883,456 bytes (about 7.52 MiB). Thus labels/index/schema can be inspected before any raw waveform download. Both raw members are required for the split archive; do not fetch only one member.

## Actual metadata schema and builder rules

The checksum-matched <code>AttributesDictionary.csv</code> header is exactly:

<code>Filename,ECG_ID,Patient_ID,Age,Gender,Acquisition_date,Sampling_point,Lead,AHA_code,CHN_code,ICD-10 code,pSQI,basSQI,bSQI</code>

The observations below are from a local parse of that publisher-served file ([AttributesDictionary.csv](https://ndownloader.figshare.com/files/53580632)) and are consistent with the paper's Data Records section ([paper](https://www.nature.com/articles/s41597-025-05225-z)).

| Field | Observed/source meaning | Required builder treatment |
|---|---|---|
| <code>Filename</code> | Every row has three slash-separated parts; observed part 2 equals <code>Patient_ID</code> and part 3 equals <code>ECG_ID</code>. | Preserve the exact string. After raw extraction, link <code>&lt;Filename&gt;.hea</code> and <code>&lt;Filename&gt;.dat</code>; require both files and verify that embedded identifiers agree. |
| <code>ECG_ID</code> | One record identifier per row: 14,190 rows and 14,190 unique values in the CSV. | Use as <code>base_ecg_id</code>; never use a patient ID as a record ID. |
| <code>Patient_ID</code> | 11,643 unique patient identifiers; multiple records can belong to one patient. | Use for grouping and split assignment. Do not expose it in logs or generated user-facing output. |
| <code>Age</code> | Every row is an integer followed by <code>d</code>; local values are 1–5,474 days. The paper says age is retained in original days and is based on acquisition date. | Parse strictly; reject missing/invalid values. Keep <code>age_days</code> as an integer, with no year/month rounding. |
| <code>Gender</code> | Local values are <code>Female</code> or <code>Male</code> (6,059 and 8,131 records respectively). | Normalize only to the existing typed sex field where unambiguous; retain the raw value and do not infer other sex categories. |
| <code>Acquisition_date</code> | Present per record. The paper says dates were shifted by a random integer range that is not disclosed, while within-patient exam order was preserved. | Treat as deidentified provenance/order, not as calendar ground truth; do not use it for an external temporal claim. |
| <code>Sampling_point</code> | Local integer values are 2,500–60,000, all divisible by 500. | Interpret as samples per record. At the published 500 Hz, duration is <code>Sampling_point / 500</code> seconds (5–120 s). |
| <code>Lead</code> | <code>12</code> for 12,334 records and <code>9</code> for 1,856 records. | Include only <code>Lead == 12</code> for this preflight. Do not synthesize missing channels. |
| <code>AHA_code</code> / <code>CHN_code</code> | Semicolon-delimited source statement codes; the codebooks are in <code>ECGCode.csv</code>. | Preserve exact source tokens, including modifiers and composite tokens; do not compare AHA and CHN numeric values as if they were the same namespace. |
| <code>ICD-10 code</code> | Semicolon-delimited disease codes from the source attribute dictionary. | Keep in a separate source-native disease field; never translate ICD disease categories into adult ECG-image labels without an explicit reviewed policy. |
| <code>pSQI</code>, <code>basSQI</code>, <code>bSQI</code> | Per-record quality indices supplied by the dataset; the paper describes them as per-lead quality measures averaged for the record. | Preserve numeric values and source provenance; apply QC thresholds only as a documented benchmark policy. |

The paper says each raw record is a WFDB <code>&lt;record&gt;.hea</code> plus <code>&lt;record&gt;.dat</code>; the header carries format/lead/sampling/gender/age/disease information and the data file is 16-bit little-endian binary. The official [ExampleReadingCode.ipynb](https://ndownloader.figshare.com/files/53581268) reads a record's comments as <code>comments[1]</code> (disease diagnosis) and <code>comments[2]</code> (ECG diagnosis). Therefore, after raw extraction, parse the header comments as untrusted source fields and keep them separate from normalized labels ([paper](https://www.nature.com/articles/s41597-025-05225-z), [notebook](https://ndownloader.figshare.com/files/53581268)).

The paper notes that children under seven may lack V2/V4/V6 and that the dataset represents those channels with V1/V3/V5; a <code>Lead == 12</code> row therefore does not prove that every conventional electrode was physically available. Preserve the source channel layout and flag this condition if it is visible in the header ([paper](https://www.nature.com/articles/s41597-025-05225-z)).

## MiniMed inclusion contract

For this preflight, select exactly:

1. <code>Age</code> parses to an exact integer <code>age_days</code>;
2. <code>age_days &lt; 18 * 365 = 6570</code> (the current MiniMed adult boundary);
3. <code>Lead == 12</code>;
4. all source identifiers and code fields pass schema validation.

The checksum-matched metadata predicts 12,334 included records. The checked-in builder retains all 12,334 twelve-lead records from 10,355 patients and excludes 1,856 nine-lead records; its validated output has empty pediatric diagnostic ground truth and namespaced source-native codes ([builder](../../tools/benchmarks/src/build-zzu-pecg-training-manifest.ts), [AttributesDictionary.csv](https://ndownloader.figshare.com/files/53580632)). The source cohort itself ends at 0–14 years (the CSV maximum is 5,474 days), so it supplies no 15–17-year coverage; do not describe it as a complete <code>&lt;18</code> pediatric population ([paper](https://www.nature.com/articles/s41597-025-05225-z), [AttributesDictionary.csv](https://ndownloader.figshare.com/files/53580632)).

Write a source-specific sidecar/reference manifest with source-native <code>AHA_code</code>, <code>CHN_code</code>, <code>ICD-10 code</code>, diagnosis statements, and quality fields. Do not populate MiniMed's <code>ground_truth_labels</code> with guessed adult labels. The fixed MiniMed image profile (12 leads, 12x1, 50 mm/s, 10 mm/mV) is a product rendering contract, not a native ZZU acquisition claim ([manifest contract](../../tools/benchmarks/src/ecg-training-manifest.ts)). The product currently has no pediatric diagnostic output or pediatric calibrated probabilities ([current state](../CURRENT_STATE.md), [pediatric policy](ecg-pediatric-age-stratification-2026.md)).

The current builder output intentionally retains only the manifest fields, exact integer <code>age_days</code>, normalized <code>sex</code>, and namespaced source label codes (<code>AHA:</code>, <code>CHN:</code>, <code>ICD10:</code>). It does **not** retain <code>Filename</code>, <code>Acquisition_date</code>, <code>Sampling_point</code>, <code>Lead</code>, <code>pSQI</code>, <code>basSQI</code>, or <code>bSQI</code>; keep those in a separate source/reference sidecar if file linkage, duration, or quality filtering is needed ([builder](../../tools/benchmarks/src/build-zzu-pecg-training-manifest.ts)).

## Source label taxonomy and conservative crosswalk

<code>DiseaseCode.csv</code> has 20 rows: 19 named disease entries plus <code>Other diseases(OD)</code>. The exact source taxonomy is:

- **Myocarditis:** Fulminant myocarditis; Viral myocarditis; Acute myocarditis; Myocarditis.
- **Cardiomyopathy:** Dilated cardiomyopathy; Hypertrophic cardiomyopathy; Cardiomyopathy; Noncompaction of the ventricular myocardium.
- **Kawasaki disease:** Kawasaki disease.
- **Congenital heart disease:** Ventricular septal defect; Atrial septal defect; Atrial septal defect (Foramen ovale); Atrial septal defect (Ostium secundum defect); Atrioventricular septal defect; Tetralogy of Fallot; Stenosis of right ventricular outflow tract; Patent ductus arteriosus; Stenosis of pulmonary artery; Pulmonary valve stenosis.
- **Other diseases(OD):** see the attribute dictionary and the source's ICD-10 2019 reference.

This is a disease/ICD taxonomy, not an ECG-image taxonomy ([DiseaseCode.csv](https://ndownloader.figshare.com/files/53512544)).

<code>ECGCode.csv</code> has 105 rows: 78 primary ECG statements, 14 AHA modifiers, and 13 AHA <code>Suggests</code>/<code>Consider</code> statements. The current adult label set is <code>NORM</code>, <code>Acute MI</code>, <code>Old MI</code>, <code>STTC</code>, <code>CD</code>, <code>HYP</code>, <code>PAC</code>, <code>PVC</code>, <code>AFIB/AFL</code>, <code>TACHY</code>, <code>BRADY</code> ([ECGCode.csv](https://ndownloader.figshare.com/files/53512538), [adult label contract](../../tools/benchmarks/src/ecg-image-dataset.ts)). The only defensible preflight overlaps are:

| MiniMed adult label | Source-supported terms | Decision |
|---|---|---|
| <code>NORM</code> | <code>Normal ECG</code> (<code>A1</code> / <code>A1</code>) | Exact candidate. Keep <code>Otherwise normal ECG</code> (<code>A2</code> / <code>A2</code>) source-native and require an explicit policy before collapsing it into <code>NORM</code>. |
| <code>Acute MI</code> | Six regional MI pairs: AHA/CHN <code>M160/M136</code>, <code>M161/M139</code>, <code>M162/M140</code>, <code>M163/N/A</code>, <code>M165/M135</code>, <code>M166/M138</code>, plus explicit <code>Acute</code> (<code>Modifier330</code> in AHA or observed <code>+Acute</code> in composite tokens) | Candidate only when the MI primary code and acute modifier are both present. Unqualified or <code>Recent</code> MI is ambiguous. |
| <code>Old MI</code> | The same six regional MI pairs plus <code>Old</code> (<code>Modifier332</code> / observed <code>+Old</code>) | Candidate only with an explicit old modifier. Unqualified or <code>Recent</code> MI is ambiguous. |
| <code>STTC</code> | <code>ST deviation with T-wave change</code> (<code>L146</code> / <code>L122</code>) | Exact combined-term candidate. Isolated ST deviation, T-wave abnormality, ischemia, QT/U, or early-repolarization terms are ambiguous/unmappable to this single adult label. |
| <code>CD</code> | AV-block and fascicular/bundle/intraventricular-conduction statements in source <code>H*</code>/<code>I*</code> families | Broad family overlap only; no automatic mapping to <code>CD</code> without a reviewed policy. |
| <code>HYP</code> | <code>Left ventricular hypertrophy</code> (<code>K142</code> / <code>K117</code>) and <code>Right ventricular hypertrophy</code> (<code>K143</code> / <code>K118</code>) | Conceptual overlap, but the adult label is broad; keep source terms and mark mapping policy-dependent. High-voltage and atrial-enlargement terms are not <code>HYP</code> by default. |
| <code>PAC</code> | <code>Atrial premature complex(es)</code> (<code>D30</code> / <code>D21</code>) and nonconducted atrial premature complexes (<code>D31</code> / <code>D22</code>) | Exact candidate for the base concept; retain occurrence/frequency/pattern modifiers. Junctional premature and escape terms are not PAC. |
| <code>PVC</code> | <code>Ventricular premature complex(es)</code> (<code>F60</code> / <code>F55</code>) | Exact candidate for the base concept. Fusion, escape, tachycardia, and fibrillation are not PVC by default. |
| <code>AFIB/AFL</code> | <code>Atrial fibrillation</code> (<code>E50</code> / <code>E48</code>) and <code>Atrial flutter</code> (<code>E51</code> / <code>E49</code>) | Exact candidates for the combined adult label; preserve the two source terms separately in provenance. |
| <code>TACHY</code> | <code>Sinus tachycardia</code> (<code>C21</code> / <code>C13</code>) | Exact candidate for sinus tachycardia only. Ectopic atrial, junctional, supraventricular, and ventricular tachycardia are source-supported tachy terms but ambiguous under one broad adult label. |
| <code>BRADY</code> | <code>Sinus bradycardia</code> (<code>C22</code> / <code>C14</code>) | Exact candidate. Sinus pause/arrest and sinoatrial block are source-only, not automatic BRADY mappings. |

These are overlaps of ECG statements only. Do not map myocarditis, cardiomyopathy, Kawasaki disease, congenital heart disease, or <code>Other diseases(OD)</code> to <code>NORM</code>, <code>HYP</code>, <code>CD</code>, or any other adult image label. Any training target must retain the original AHA/CHN/ICD token and the mapping decision (<code>exact</code>, <code>ambiguous</code>, or <code>unmapped</code>) ([ECGCode.csv](https://ndownloader.figshare.com/files/53512538), [DiseaseCode.csv](https://ndownloader.figshare.com/files/53512544)).

## Folds and deterministic split

I found no published patient-level fold assignment in the Figshare record, paper, or official notebook. The notebook imports <code>train_test_split</code> for example code but does not publish a fold manifest or assignment rule ([Figshare API](https://api.figshare.com/v2/articles/27078763), [paper](https://www.nature.com/articles/s41597-025-05225-z), [notebook](https://ndownloader.figshare.com/files/53581268)).

Use this one deterministic, versioned rule for the local builder:

~~~~python
from hashlib import sha256

digest = sha256(f"ZZU-pECG-v1:{patient_id}".encode("utf-8")).digest()
bucket = int.from_bytes(digest[:8], byteorder="big", signed=False) % 10
split = (
    "train"      if bucket < 8 else
    "validation" if bucket == 8 else
    "test"
)
~~~~

Assign on exact <code>Patient_ID</code> before any record/image expansion; every record and future render/photo variant for that patient inherits the same split. Calibration is not emitted (0 records). On the checksum-matched metadata, the 12-lead subset is 9,809/1,270/1,255 records for train/validation/test respectively, covering 10,355 patients with zero patient leakage; 1,856 nine-lead records are excluded. These are reproducibility checks, not published folds, a representativeness claim, or clinical validation. Recompute them if the Figshare revision changes. The verified manifest JSON SHA-256 is <code>df862a44542353bf674029488578284e56430da8201a969a25411b17f4d9e762</code>.

## Legal, privacy, and trust caveats

- This is a single-hospital, hospitalized Chinese cohort from the First Affiliated Hospital of Zhengzhou University, not a community screening cohort; the paper reports collection in 2018–2024 and ages 0–14 ([paper](https://www.nature.com/articles/s41597-025-05225-z)).
- The paper says patient IDs were regenerated/deidentified, acquisition dates were shifted by an undisclosed random range, and ECG data were released for public research under ethics approvals <code>2024-KY-0221-003</code> and <code>2025-KY-0369-001</code>; informed-consent signatures were waived ([paper](https://www.nature.com/articles/s41597-025-05225-z)). Treat age, dates, diagnoses, and IDs as sensitive even after deidentification (operational privacy inference); keep them out of logs, screenshots, released packs, and git history.
- The paper says diagnoses came from inpatient records, were reviewed by senior physicians, and can coexist with a normal ECG; records across hospitalization, treatment, and recovery were retained. A diagnostic code is therefore not proof that the waveform shows the disease ([paper](https://www.nature.com/articles/s41597-025-05225-z)).
- The paper has an acquisition-period inconsistency (January 2018–May 2024 in one description versus June 2024 in another) and a cardiovascular-count inconsistency (3,516 in the description/abstract and one methods sentence versus 3,716 in a later processing sentence). Recompute from row-level codes and do not hardcode either aggregate ([Figshare API](https://api.figshare.com/v2/articles/27078763), [paper](https://www.nature.com/articles/s41597-025-05225-z)).
- The paper notes Supplementary Table 1 was corrected on 2025-06-06; use the current article/supplement, not an older cached copy ([paper](https://www.nature.com/articles/s41597-025-05225-z)).
- The 0–14 age ceiling means there is no ZZU evidence for ages 15–17, no phone-photo holdout, and no basis for claiming pediatric clinical generalization. The raw archive must remain outside the repository and production content pack until schema, checksums, WFDB linkage, and label policy pass.

## Minimal next commands (metadata first)

The following retrieves only the API metadata and the three CSVs; it does not touch either raw archive member.

~~~~sh
zzu_meta_dir=$(mktemp -d)

rtk curl -fsSL https://api.figshare.com/v2/articles/27078763 |
  rtk jq -r '.files[] | [.name, .id, .size, .download_url, .supplied_md5] | @tsv'

rtk curl -fsSL https://api.figshare.com/v2/articles/27078763/versions/1 |
  rtk jq '{version, doi, published_date, modified_date, license, license_url, size}'

rtk curl -fL --retry 3 -o "$zzu_meta_dir/ECGCode.csv" \
  https://ndownloader.figshare.com/files/53512538
rtk curl -fL --retry 3 -o "$zzu_meta_dir/DiseaseCode.csv" \
  https://ndownloader.figshare.com/files/53512544
rtk curl -fL --retry 3 -o "$zzu_meta_dir/AttributesDictionary.csv" \
  https://ndownloader.figshare.com/files/53580632

test "$(rtk md5 -q "$zzu_meta_dir/ECGCode.csv")" = 7612c5af0e01e052eb85792c5e362f12
test "$(rtk md5 -q "$zzu_meta_dir/DiseaseCode.csv")" = 0bff597c23397c0d05a937fe09807ad4
test "$(rtk md5 -q "$zzu_meta_dir/AttributesDictionary.csv")" = ffbbb7ebd8ad4425b3a859739eb65eb1

zzu_manifest_dir=$(mktemp -d)
rtk bun tools/benchmarks/src/build-zzu-pecg-training-manifest.ts \
  --attributes "$zzu_meta_dir/AttributesDictionary.csv" \
  --output "$zzu_manifest_dir/manifest.json"
rtk shasum -a 256 "$zzu_manifest_dir/manifest.json"
~~~~

The builder should parse and fail closed on the exact header, strict day-age grammar, <code>Lead ∈ {9,12}</code>, nonempty IDs, semicolon code preservation, and <code>Filename</code>/ID linkage. The checked-in CLI above writes only outside the repository and can be verified against the output SHA-256. Only after these checks pass should a separately approved step fetch both <code>Child_ecg.z01</code> and <code>Child_ecg.zip</code>, verify their MD5 values from the table above, extract WFDB pairs, and run raw/header linkage and signal-quality checks ([builder](../../tools/benchmarks/src/build-zzu-pecg-training-manifest.ts)).
