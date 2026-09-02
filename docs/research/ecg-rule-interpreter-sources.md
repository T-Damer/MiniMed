# Открытые источники для rule-based интерпретатора ЭКГ

Дата исследования: 31 августа 2026 г.

## Короткий вывод

Собственный интерпретатор измерений реалистичен как **измерительный и объяснимый screening-слой**, но не как подтверждающий диагноз. Архитектура приборов обычно разделена на: (1) качество/подготовку сигнала, (2) выделение комплексов и fiducials, (3) измерения, (4) диагностическую классификацию. Именно такую последовательность рекомендуют AHA/ACC/HRS; автоматическое заключение должно быть проверено врачом.

Открытых исходников GE 12SL, Philips DXL, Glasgow или Mortara нет. Однако публичные physician guides оказались намного полезнее обычных рекламных материалов: в них есть подробные списки параметров, библиотеки statement-кодов и значительная часть пороговых правил. Glasgow, например, публикует конкретные условия для оси, блокад, гипертрофии, Q-волн и ST-изменений. При этом руководство прямо предупреждает, что часть формул и процедур опущена, а дискретные пороги в реальной программе заменены сглаженными функциями. Поэтому можно реализовать независимые правила по опубликованным клиническим критериям, но нельзя обещать точную копию конкретного бренда.

## Что реально опубликовано

| Источник | Что доступно | Что закрыто/ограничено | Ценность для MiniMed |
|---|---|---|---|
| AHA/ACCF/HRS Part I (JACC, 2007) | Стандартизация записи, фильтрации, шаблонов, onset/offset, global intervals, требования к валидации | Полный код конкретных систем | Канонический pipeline и список обязательных измерений |
| AHA/ACCF/HRS Part II (JACC, 2007) | Core statement lexicon: норма, технические ошибки, синусовые/наджелудочковые/желудочковые ритмы, блокады, гипертрофия, ишемия/инфаркт | Это словарь, а не готовый классификатор | Стабильные ключи диагнозов и группировка вывода |
| AHA Parts III–VI (JACC/Circulation, 2008–2009) | Критерии проводимости, гипертрофии, ST/T/QT и острой ишемии | Не являются лицензией на исходные алгоритмы приборов | Пороговые правила с указанием источника и применимости |
| Philips DXL Physician’s Guide | 46 полей на отведение, global/group/rhythm measurements, axis, PR/QRS/QT/QTc, P/T morphology, quality flags, interpretive/severity codes и многие reason thresholds | Полный DXL proprietary; guide содержит copyright и device-specific behavior | Наиболее подробный публичный перечень параметров |
| GE Marquette 12SL Physician’s Guide/страница продукта | HR, axis, intervals/durations, atrial arrhythmia, pace, QT; gender/age MI criteria; pediatric criteria; validation methodology | Исходный код, полный statement decision tree и базы | Подтверждает обязательность возраста/пола и отдельной pediatrics-ветки |
| Glasgow Physician’s Guide | Подробные условия для QC, lead reversal, ритма, оси, блокад, гипертрофии, Q-волн, ST/T и statement list; возрастные и половые пределы | Полный код, сглаженные функции и веса двух MI-сетей не опубликованы | Лучший открытый источник для структуры независимого rule engine |
| DICOM Waveform / SCP-ECG | Каналы, частота, lead codes, waveform annotations и timing; SCP допускает последовательные каналы | Интерпретационные правила не задаются DICOM | Безопасный формат обмена measurements/annotations |
| HL7 aECG / FDA | XML-аннотации waveforms и измерений; FDA прямо рекомендует aECG для submission | Не диагностический движок | Формат хранения fiducials/provenance |
| BRAVEHEART (GPLv3) | Открытые denoise, fiducials, параметры; CSV/WFDB/DICOM/EDF, Windows/Mac | Не широкий диагноз; MATLAB/лицензионные условия GPLv3 | Полезен как reference implementation измерительного слоя |
| NeuroKit2 (MIT) | R-peaks, P/T delineation, интервалы и quality helpers | Не диагностический классификатор | Практичный Python baseline для измерений |
| OpenECG (Apache-2.0) | Лёгкая сегментация P/QRS/T и rule-based AF check | Не 12-lead broad interpreter | Локальный preprocessor и контроль качества |
| Construe (AGPL-3.0) | Открытая knowledge base и abductive rules от P/QRS/T до AF, bigeminy/trigeminy и ventricular flutter/fibrillation; принимает MIT-BIH/WFDB и ручные QRS annotations | Старый Python/scipy stack, WFDB runtime, NP-hard rhythm search и AGPL несовместимы с прямым browser-встраиванием | Ближайший найденный открытый broad rule engine; использовать как внешний reference и benchmark, не переносить код |

## Параметры, которые следует извлекать

Минимальный взрослый MVP: sample rate, gain, lead placement/quality; ventricular/atrial rate; RR mean и variability; P duration/amplitude/axis; PR; QRS duration; QT и QTc (Bazett/Fridericia с явным выбором); Q/R/S amplitudes и areas по каждому lead; ST deviation в J+60/80 ms; T polarity/amplitude; frontal QRS/P/T axis; R-wave progression; beat labels (normal/PAC/PVC); pacemaker spikes.

Производители дополнительно используют representative/median beat, global onset/offset, morphology groups, ectopic-beat counts, longest run, mean atrial/ventricular rate, standard deviations и severity/reason codes. Это видно прямо в индексе Philips DXL guide, но названия полей сами по себе не раскрывают правила принятия решения.

### Что именно удалось достать из руководств приборов

Philips DXL Edition 2 раскрывает практически готовую спецификацию входного объекта интерпретатора:

- **46 полей на каждое отведение:** амплитуда, длительность, площадь и notch для P/P′; амплитуда и длительность Q/R/S/R′/S′; ventricular activation time; QRS peak-to-peak, duration, area и notch; delta-wave; ST в J-point, midpoint, J+80 ms и конце сегмента, его длительность, наклон и форма; T/T′ amplitude, duration, area и notch; PR interval/segment; QT; morphology group и шесть quality flags.
- **Оси и векторы:** P, первые 40 ms QRS, средняя QRS, последние 40 ms QRS, ST и T; начальный, максимальный и терминальный transverse QRS vector.
- **Глобальные значения:** ventricular rate, PR interval/segment, QRS duration, QT, QTc и QT dispersion.
- **Ритм по группам комплексов:** количество и доля комплексов, longest run, min/mean/max ventricular rate, mean RR, atrial rate, число P на QRS, min/mean/max PR, вариабельность, pauses, pacing, Wenckebach, bigeminy/trigeminy, multifocal/aberrant shape и ectopy counts.

GE 12SL публикует statement library с числовыми ID и acronyms для ритмов, AV-проводимости, оси, блокад, гипертрофии, инфаркта, ST/T, QT, качества и serial comparison. Его официальный DICOM conformance document отдельно перечисляет переносимые глобальные измерения: ventricular/atrial rate, PR, QRS, QT, RR, QTc/Bazett и P/QRS/T axes.

Glasgow раскрывает еще больше диагностической логики. Например, руководство задает возрастные пределы QRS axis, комбинации амплитуд/длительностей для fascicular blocks и Q-волн, возрастно-половые voltage limits, lead-quality rules и условия, при которых анализ STEMI должен быть отключен. Но это **гибрид**, а не чистый набор `if`: для inferior MI используется сеть с 9 входами, для anterior MI — с 42 входами; результаты объединяются с deterministic criteria, а опубликованные дискретные пороги в поставляемом алгоритме сглаживаются непрерывными функциями. Это хороший аргумент в пользу нашего плана «правила сначала, ML только для неоднозначных случаев».

### Как добывать параметры еще

По убыванию практической ценности:

1. **Physician’s guides и extended-measurement reports.** Это главный источник названий полей, единиц, statement-кодов, reason-текстов и части порогов.
2. **DICOM conformance statements и экспортные схемы.** Они показывают, какие measurements и annotations реально покидают прибор. Это безопаснее и полезнее, чем пытаться разбирать бинарный алгоритм.
3. **FDA 510(k) summaries.** Обычно не раскрывают decision tree, но фиксируют intended use, возрастные группы, типы выходов и обязательность physician overread.
4. **Патенты и статьи авторов алгоритмов.** Часто раскрывают median-beat pipeline, набор признаков и отдельные формулы. Их нужно использовать как исследовательский материал с проверкой патентных ограничений, а не копировать реализацию.
5. **Обезличенные MUSE/Philips XML или DICOM-экспорты одной и той же ЭКГ.** Если получить их законно от клиники или собственного аппарата, можно составить field dictionary и black-box сравнить измерения разных систем. Пациентские данные в репозиторий не добавлять.
6. **Публичные statement libraries и AHA lexicon.** Полезны для стабильных внутренних ID и формулировок, но сами по себе не являются правилами.

Реверс-инжиниринг прошивки прибора сейчас не нужен: публичных спецификаций уже достаточно для MVP, а юридический и технический риск несоразмерен пользе.

## Что можно реализовать правилами

Первый слой должен выдавать факты, а не диагнозы: `HR=...`, `PR=...`, `QRS=...`, `QTc=...`, ось, качество, найденные P/QRS/T. Второй слой может аккуратно реализовать:

- синусовый ритм, тахикардия/брадикардия, нерегулярный ритм и подозрение на AF;
- AV-блоки и внутрижелудочковые блокады по PR/QRS и морфологии;
- axis deviation;
- базовые voltage/duration criteria гипертрофии;
- ST elevation/depression и T-wave abnormality с локализацией по соседним отведениям;
- патологические Q и poor R progression как «признак/подозрение», не как установленный инфаркт;
- QT prolongation с предупреждением о формуле и ЧСС.

Отдельный воспроизводимый взрослый критерий уже доступен в AHA/ACCF/HRS Part III: паттерн
желудочкового предвозбуждения WPW-типа требует совместного наличия PR <120 мс, дельта-волны и
QRS >120 мс. Это именно ECG pattern, а не клинический синдром; при его срабатывании морфология
широкого QRS не должна одновременно интерпретироваться как обычная полная блокада ножки.
[Первичный источник](https://www.jacc.org/doi/10.1016/j.jacc.2008.12.013).

Для AF актуальное ACC/AHA/ACCP/HRS руководство перечисляет три визуальных ECG-признака:
нерегулярные RR при сохранённом AV-проведении, отсутствие различимых P-волн и нерегулярную
предсердную активность/f-волны. Оно отдельно требует, чтобы первичный диагноз подтверждался
медицинским специалистом при визуальном просмотре самой записи. Поэтому MiniMed может показывать
только review-required pattern после явного ручного подтверждения всех трёх наблюдений.
[Первичный источник](https://www.ahajournals.org/doi/10.1161/CIR.0000000000001193).

Photo digitizer теперь сохраняет и показывает найденную последовательность RR, но автоматический
вывод AF по-прежнему не включается. В локальном smoke на 15 изображениях только 6 прошли общий
quality gate, а единственный quality-qualified положительный пример ФП недостаточен для выбора
порогов. Кроме того, RR-нерегулярность сама по себе не подтверждает отсутствие P и наличие
f-волн; экстрасистолы и артефакты могут имитировать этот признак.

Для каждого вывода нужны: сработавшие критерии, значения, пороги, отсутствующие данные, качество и уровень `normal / finding / suspicious / urgent-review`. Острый инфаркт, электролиты, кардиомиопатия и «старый инфаркт» нельзя подтверждать одной фотографией и одними правилами.

## Возраст и пол

Возраст/пол — не косметический контекст. GE прямо заявляет age/gender-driven MI criteria и dedicated pediatric criteria. AHA Part I отдельно предупреждает о различиях при младенцах/детях и о неэквивалентности torso placement. Для ребёнка нужны отдельные reference limits для HR, PR, QRS, QTc, оси, вольтажа и R/S progression по возрасту, полу и часто росту; взрослые пороги применять нельзя. PEDMEANS manual прямо описывает age-dependent classification rules.

Практическая политика: возраст в днях/месяцах/годах обязателен для pediatrics; пол — опционален только там, где правило действительно sex-specific; при неизвестном возрасте выдавать измерения и безопасные описания без возрастного диагноза.

## Лицензирование и воспроизводимость

- Публикации AHA/JACC и руководства производителей можно цитировать и использовать как спецификацию, но текст/таблицы нельзя без проверки лицензии просто копировать в продукт.
- Клинические критерии и математические формулы обычно не являются авторским кодом; конкретная реализация, statement wording, базы и thresholds коммерческого алгоритма могут быть proprietary. Нужна независимая формулировка, attribution и юридическая проверка.
- DICOM и доступные части SCP/aECG задают обмен данными, а не клиническую истину.
- BRAVEHEART GPLv3 нельзя автоматически смешивать с закрытой/проприетарной частью продукта; NeuroKit2/OpenECG имеют более удобные permissive licenses, но не дают медицинской валидации.
- Construe подтверждает, что широкий объяснимый rule engine возможен без image classifier, но его AGPL-код и тяжёлый abductive runtime нельзя копировать в MiniMed. Полезны его открытая декомпозиция наблюдений и опубликованные тестовые задачи; правила MiniMed должны быть независимой реализацией по первичным клиническим критериям.

## Сложность MVP

| Уровень | Содержание | Оценка |
|---|---|---|
| M0 | QC, ЧСС, RR, PR/QRS/QT/QTc, ось, объяснимые факты | 1–2 недели **после** стабильной оцифровки и fiducials |
| M1 adult rules | ритмы, блокады, axis, voltage criteria, ST/T/Q flags, AHA statement IDs | 4–8 недель на правила при надежных measurements |
| Фото → adult report | коррекция фото, 12-lead segmentation, robust fiducials, measurements, rules и benchmark | реалистично 3–6 месяцев для небольшой команды |
| Vendor-like | calibrated probabilities, broad differential, serial comparison, pacemakers, noisy/atypical cases | годы данных, разработки и независимой клинической валидации |
| Pediatric | отдельные нормы, возрастные переходы, врождённые паттерны | отдельный этап, не расширение adult rules |

## Самые ценные первичные документы

1. [AHA/ACC/HRS Part I: technology and computerized interpretation](https://www.jacc.org/doi/10.1016/j.jacc.2007.01.024) — архитектура измерительного pipeline и требование physician overread.
2. [AHA/ACC/HRS Part II: diagnostic statement list](https://www.jacc.org/doi/10.1016/j.jacc.2007.01.025) — базовый словарь statement IDs.
3. [AHA/ACC/HRS Part IV: ST, T, U and QT](https://www.jacc.org/doi/10.1016/j.jacc.2008.12.014).
4. [AHA/ACC/HRS Part V: chamber hypertrophy](https://www.jacc.org/doi/10.1016/j.jacc.2008.12.015).
5. [Philips DXL Physician’s Guide](https://www.documents.philips.com/doclib/enc/fetch/2000/4504/577242/577243/577246/581601/711562/DXL_ECG_Algorithm_Physician_s_Guide_%28ENG%29_Ed.2.pdf) — самый конкретный публичный индекс измерений и codes.
6. [Philips DXL official overview](https://www.usa.philips.com/healthcare/product/HCNOCTN68/dxl-16-lead-ecg-algorithm) — 12/15/16-lead scope, pediatric mode и gender-specific STEMI references.
7. [Glasgow 12-lead ECG Analysis Program Physician’s Guide](https://8331374.fs1.hubspotusercontent-na1.net/hubfs/8331374/Knowledge%20Base/corpuls3/20210525_glasgow_GAN_v1.0_ENG_Druck.pdf) — наиболее подробное публичное описание criteria и гибридного rule/NN подхода.
8. [GE Marquette 12SL Physician’s Guide v23](https://landing1.gehealthcare.com/rs/005-SHS-767/images/45351-MUSE-17Nov2022-6-1-Quick-Reference-Guide-LP-Diagnostic-Cardiology.pdf) — criteria/methodology, statement library, pediatric tables и validation.
9. [GE MUSE NX DICOM Conformance Statement](https://www.gehealthcare.com/-/jssmedia/documents/us-global/products/interoperability/dicom/diagnostic-ecg/gehc-dicom_conformance_muse-nxr2_doc2659504_rev2.pdf) — фактические поля глобальных measurements и annotations в экспорте.
10. [FDA 510(k) Philips DXL K132068](https://www.accessdata.fda.gov/cdrh_docs/pdf13/K132068.pdf) — intended use и типы анализируемых признаков.
11. [DICOM PS3.17: SCP-ECG harmonization](https://dicom.nema.org/medical/dicom/2026a/output/chtml/part17/sect_C.7.html) — lead mapping, annotations и multiplex timing.
12. [FDA ECG Waveform FAQ](https://www.fda.gov/media/152892/download) — aECG XML и annotations как переносимый формат.
13. [BRAVEHEART repository](https://github.com/BIVectors/BRAVEHEART) — открытый reference для signal processing/fiducials, GPLv3.
14. [OpenECG repository](https://github.com/vitaldb/openecg) — компактная локальная сегментация и AF rule baseline.
15. [PEDMEANS Physicians Manual](https://www.hillrom.com/content/dam/hillrom-aem/us/en/sap-documents/LIT/80015/80015051LITPDF.pdf) — практическое объяснение возрастозависимой pediatric classification.
16. [Construe](https://github.com/citiususc/construe) — открытая knowledge-based интерпретация multi-lead ECG и коротких rhythm strips; AGPL-3.0, Python/WFDB.
17. [PhysioNet ecgpuwave](https://physionet.org/content/ecgpuwave/1.3.4/) — QRS detector и P/QRS/ST-T onset/peak/offset annotations; измерительный слой, не диагнозатор.

## Рекомендация для проекта

Не пытаться копировать GE/Philips или переносить Construe. Сделать независимый `ECGMeasurements` + `ECGFindings` engine: WFDB/ecgpuwave, OpenECG или собственные проверяемые измерения как benchmarks; AHA statement IDs, ссылки на критерий и возрастной профиль как контракт. Начать только со взрослых и 10-секундной качественной оцифровки; pediatric profile подключать отдельным модулем после появления валидных детских наборов. Каждое правило должно иметь synthetic/unit cases и показывать evidence, а не только итоговую строку.
