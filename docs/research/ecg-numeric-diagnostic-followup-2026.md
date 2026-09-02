# Числовая интерпретация ЭКГ: follow-up research

Дата проверки: 31 августа 2026 г.

## Вывод

Готового открытого permissive-движка уровня GE 12SL / Philips DXL / Glasgow, который принимает
интервалы, оси, амплитуды и морфологию и выдаёт широкий набор диагнозов, снова не найдено.
Наиболее полезная новая находка — не код, а официальный **VERITAS V7.20 Physician's Guide**:
в нём опубликована значительная часть последовательных rule/score-критериев, включая причины
вывода и suppression/skip-условия. Это лучший новый **reference**, но не лицензия на перенос
vendor-реализации.

Практический путь для MiniMed остаётся двухслойным:

1. измерения с явным происхождением и контролем качества;
2. независимо написанные объяснимые правила и отдельно валидированный статистический слой.

Измеритель P/Q/R/S/T не является диагностическим движком. Коды Minnesota/SCP/SNOMED и форматы
DICOM/SCP-ECG задают словарь или транспорт, но не превращают измерения в диагноз.

## Кандидаты

| Кандидат | Точный вход | Выход и охват | Лицензия / артефакты | Локально / browser | Решение |
|---|---|---|---|---|---|
| VERITAS V7.20, Rev E (2019-08) | Одновременная 12/15-lead запись; анализ 1000 Hz, 10 s; representative/median beats, global PR/QRS/QT/RR, per-lead amplitudes/durations, возраст | Последовательные rhythm/contour statements: ритм, conduction, axis, hypertrophy, infarction, ST-T, QT, pediatric; reason и severity | Proprietary/copyrighted guide; исходников и runtime нет; веса не нужны, но vendor implementation обязателен | Самостоятельно запустить нельзя | **Reference** для feature contract, порядка правил и тестов; правила не копировать дословно |
| NOVACODE, HHANES 12/92 | Representative averaged complex, global fiducials, Q/R/S/T/ST amplitudes/durations, QRS areas/axis, age/sex/race for some scores | Minnesota Code 1982, probable/possible MI и LVH, continuous CIIS/LV-mass estimates | Публичная документация, но не исходники и не open-source license | Runtime недоступен | **Reference**; независимо реализовать только выбранные клинически обоснованные критерии |
| MC-MEANS / MEANS | Обычно simultaneous 12-lead, 500 Hz, 10 s; signal → representative beat → measurements | Minnesota codes; MEANS также rhythm/morphology statements | Коммерчески лицензирован, не freely available; без pretrained weights | Нет открытого локального/browser runtime | **Reject runtime**, оставить как исторический comparator |
| WFDB 10.7.0 (`bxb`, `epicmp`, `ecgeval`) | Две WFDB annotation streams одной записи: reference и test beats/episodes | Метрики beat/RR, AF/VF/ST episodes; **не генерирует диагноз** | C; `ecgeval.c` GPL-2.0-or-later, официальный пакет помечен GPLv3; весов нет | Локально да; browser-порт не оправдан | **Adopt as external evaluator**, не как interpreter |
| 3D FMM-ECG, commit `d9193aa` | 1–12 raw leads + Hz; затем один beat matrix + QRS annotation | P/Q/R/S/T параметры `A/alpha/beta/omega`, RR и morphology indices; broad labels отсутствуют | GPL-3.0, R + package FMM; весов нет | Локально да; browser нет | **Benchmark measurement layer** |
| ECGTwinMentor 1.0.0, commit `dd3e06e` | 8 чисел/категорий: HR, PR, QRS, ST, QTc, axis, rhythm, T morphology | 6-class dense NN: normal, MI, heart block, AF, brady-, tachycardia | CC BY-NC 4.0; bundled H5/TFLite/scaler/encoder | Локально/edge да | **Reject**: synthetic corpus и target leakage |
| MIMIC-IV-ECG 1.0 | ~800k 10-s 12-lead/500-Hz records; global RR, P/QRS/T fiducials и axes; machine report lines | Не алгоритм: внешний корпус machine measurements + machine statements, часть ECG связана с cardiologist reports | ODbL 1.0; files сейчас доступны без credentialing | Offline analysis после скачивания | **Adopt for external validation** global rules |
| KURIAS-ECG 1.0 | Планировались 20k 10-s 12-lead/500-Hz, analyzed parameters, 147 device statements | 10 Minnesota groups + SNOMED/OMOP mappings | Restricted Health Data License; downloads отключены после internal audit | Сейчас невоспроизводимо | **Reject until reopened** |
| DICOM PS3.16 / ISO 41064:2023 | Typed global/per-lead measurements, annotations and coded findings | Transport/report schema, не decision rules | DICOM открыт; ISO full text платный | Схема локально реализуема | **Adopt as contract reference** |
| `scpinfo`, commit `52c1ec0` | SCP-ECG file | Waveforms/metadata; Section 8 заявлен partly, но код читает только header | MIT, Python, без весов | Локально да | **Reject as diagnostic importer** в текущем виде |

## 1. VERITAS: новый наиболее конкретный rule reference

Официальный guide фиксирует software version **7.20**, документ `9515-001-52-ENG Rev E`,
revision `2019-08`; одновременно документ содержит copyright/confidentiality notice
([титульные страницы](https://www.hillrom.fr/content/dam/hillrom-aem/us/en/sap-documents/LIT/9515-/9515-001-52-ENGLITPDF.pdf)).
Это документация закрытого алгоритма, не open-source release.

Контракт существенно богаче текущих 30 полей MiniMed. VERITAS формирует representative beats,
определяет global PR/QRS/QT по всем одновременно записанным отведениям, средний RR за 10 секунд и
per-lead amplitudes/durations; все измерения, кроме pacemaker pulse detection, выполняются на
1000 samples/s ([median beat и measurements, стр. 10–12](https://www.hillrom.fr/content/dam/hillrom-aem/us/en/sap-documents/LIT/9515-/9515-001-52-ENGLITPDF.pdf)).
Следовательно, единственный экстремум Q/R/S/T на коротком последовательном фрагменте фото не
эквивалентен vendor input.

Guide показывает настоящий граф правил, а не только statement list:

- adult RBBB использует QRS duration вместе с terminal R в V1 и длительными S в lateral leads;
- LBBB добавляет отсутствие Q, R duration и `QRS area ratio`, а не один порог QRS;
- nonspecific conduction delay проверяется только после отрицательных specific block tests;
- ST/MI/hypertrophy ветви имеют skip/suppression conditions;
- rhythm и contour analysis разделены, а pediatric thresholds образуют отдельную ветвь.

Эти зависимости и конкретные примеры опубликованы в разделах conduction и global measurements
([RBBB/LBBB, стр. 17–21](https://www.hillrom.fr/content/dam/hillrom-aem/us/en/sap-documents/LIT/9515-/9515-001-52-ENGLITPDF.pdf));
сам guide предупреждает, что compact rhythm descriptions намеренно опускают часть деталей и что
computer statements требуют physician review ([стр. 6–8](https://www.hillrom.fr/content/dam/hillrom-aem/us/en/sap-documents/LIT/9515-/9515-001-52-ENGLITPDF.pdf)).

**Рекомендация:** использовать только как reference для структуры входа, порядка `quality → rhythm
→ conduction → morphology → suppression`, missing-data gates и regression cases. Не переносить
vendor wording/таблицы и не заявлять parity с VERITAS.

## 2. Minnesota Code, NOVACODE и MC-MEANS

CDC HHANES `12/92` публикует не только итоговые Minnesota categories, но и формализованные
measurement definitions NOVACODE. Программа строила majority-cluster representative complex,
использовала simultaneous global QRS reference lines, baseline перед QRS, Q/R/S/T/ST
amplitudes/durations и QRS integrals для axis; документ также публикует CIIS thresholds и
регрессионные коэффициенты ECG-estimated LV mass
([Section M и notes 22–24](https://wwwn.cdc.gov/nchs/data/hhanes/6540.pdf)). Выход — объективные
коды/вероятностные категории `probable/possible/consider`, а не широкий клинический диагноз.

Это важная спецификация, но не исполнимый open-source artifact. Minnesota Code изначально создан
для population studies; его исходная публикация прямо отмечает, что он не является hospital ECG
coding system ([Journal of Electrocardiology](https://doi.org/10.1016/S0022-0736(69)80044-0)).
Поздняя валидация автоматического Minnesota coder показала чувствительность/специфичность по
девяти категориям на 300 специально подобранных ECG, но исходники не опубликованы
([1996 validation](https://doi.org/10.1016/S0022-0736(96)80025-2)).

MC-MEANS также не является доступным кандидатом: MEANS обычно принимает simultaneous 12-lead
10-second ECG около 500 Hz и строит representative P-QRS-T complex
([методика QT measurement](https://pmc.ncbi.nlm.nih.gov/articles/PMC6932072/)); современная
публикация прямо говорит, что MEANS лицензирован и freely unavailable
([PLOS One, 2024](https://doi.org/10.1371/journal.pone.0304893)). Ни модельных весов, ни открытого
runtime для MiniMed нет.

Онтологический Minnesota prototype на Protégé/HermiT демонстрирует, что правила можно выразить как
`lead + waveform property + operator + threshold`, но публикация не даёт поддерживаемого runtime
или репозитория ([Sram & Takács, 2015](https://acta.uni-obuda.hu/Sram_Takacs_60.pdf)). Это
архитектурная иллюстрация, не кандидат на интеграцию.

## 3. WFDB: открытая оценка, не открытая диагностика

Официальный WFDB **10.7.0** — portable C package из более чем 70 signal/annotation applications;
он предназначен для чтения/обработки/оценки physiological waveforms
([PhysioNet release](https://physionet.org/content/wfdb/10.7.0/)). На pinned commit
[`de6b1d3`](https://github.com/bemoody/wfdb/tree/de6b1d3981d69060e6a4d1b4e86375fb0d3ed2d1):

- [`bxb`](https://github.com/bemoody/wfdb/blob/de6b1d3981d69060e6a4d1b4e86375fb0d3ed2d1/doc/wag-src/bxb.1)
  сравнивает reference/test beat annotations и RR errors;
- [`epicmp`](https://github.com/bemoody/wfdb/blob/de6b1d3981d69060e6a4d1b4e86375fb0d3ed2d1/doc/wag-src/epicmp.1)
  считает episode/duration statistics для VF, AF и ST;
- [`ecgeval`](https://github.com/bemoody/wfdb/blob/de6b1d3981d69060e6a4d1b4e86375fb0d3ed2d1/app/ecgeval.c)
  оркестрирует comparators; файл лицензирован GPL-2.0-or-later.

Ни один из них не превращает PR/QRS/QT/amplitudes в diagnostic statements. Их разумная роль —
внешняя проверка beat/rhythm/ST annotations MiniMed; перенос C/GPL в browser bundle не нужен.

## 4. Свежие GitHub-кандидаты

### 3D FMM-ECG — измеритель

Pinned commit [`d9193aa`](https://github.com/FMMGroupVa/FMM-Applications-3DECG/tree/d9193aae41d7fed2f3cb820eabc52b822eddfe8e),
GPL-3.0. `givePreprocessing_git` принимает raw matrix до 12 leads и sampling frequency, возвращает
QRS annotations/segmentation; `fitMultiFMM_ECG` принимает beat matrix + QRS index и выдаёт по
P/Q/R/S/T параметры amplitude/location/skewness/width для восьми независимых leads
([точный contract](https://github.com/FMMGroupVa/FMM-Applications-3DECG/blob/d9193aae41d7fed2f3cb820eabc52b822eddfe8e/README.md#L22-L44),
[лицензия](https://github.com/FMMGroupVa/FMM-Applications-3DECG/blob/d9193aae41d7fed2f3cb820eabc52b822eddfe8e/LICENSE#L1-L18)).

Репозиторий публикует normal PTB-XL percentile ranges для параметров/индексов, но не broad
diagnostic classifier и не готовые clinical thresholds для заболеваний
([normal ranges](https://github.com/FMMGroupVa/FMM-Applications-3DECG/blob/d9193aae41d7fed2f3cb820eabc52b822eddfe8e/README.md#L49-L59)).
Это хороший offline comparator для digitizer/delineator, но не замена rule layer.

### ECGTwinMentor — отклонён из-за leakage

Pinned commit [`dd3e06e`](https://github.com/ElsevierSoftwareX/SOFTX-D-25-00517/tree/dd3e06e07a189298123a501087fbafeca39e1917),
version 1.0.0, CC BY-NC 4.0. Проект принимает восемь агрегированных параметров и поставляет
H5/TFLite dense classifier для шести классов
([input/model contract](https://github.com/ElsevierSoftwareX/SOFTX-D-25-00517/blob/dd3e06e07a189298123a501087fbafeca39e1917/README.md#L98-L125),
[license](https://github.com/ElsevierSoftwareX/SOFTX-D-25-00517/blob/dd3e06e07a189298123a501087fbafeca39e1917/LICENSE)).

Проверка bundled training CSV обнаружила 3000 строк, ровно 500 на класс. При этом все 500
`Atrial Fibrillation`, `Bradycardia` и `Tachycardia` имеют одноимённое поле `Rhythm`; все 500
`Normal`, `Myocardial Infarction` и `Heart Block` имеют `Rhythm=Sinus`
([pinned training CSV](https://github.com/ElsevierSoftwareX/SOFTX-D-25-00517/blob/dd3e06e07a189298123a501087fbafeca39e1917/model/ecg_dataset.csv)).
То есть половина target практически записана во входе, а README прямо называет ECG generation
synthetic/educational ([scope](https://github.com/ElsevierSoftwareX/SOFTX-D-25-00517/blob/dd3e06e07a189298123a501087fbafeca39e1917/README.md#L21-L35)).
Высокая локальная accuracy такого артефакта не будет клиническим evidence. Не интегрировать и не
использовать как comparator.

## 5. Лучшие новые данные для проверки

### MIMIC-IV-ECG 1.0 — принять для внешней проверки

Версия 1.0 содержит около 800 000 diagnostic 12-lead ECG по 10 секунд при 500 Hz; источник
смешивает несколько производителей и сейчас доступен без credentialing под ODbL 1.0
([описание и access](https://physionet.org/content/mimic-iv-ecg/1.0/)). Файл
`machine_measurements.csv` размером 174.2 MB содержит `report_0..report_17`, а открытый
[data dictionary](https://physionet.org/files/mimic-iv-ecg/1.0/machine_measurements_data_dictionary.csv)
фиксирует `rr_interval`, `p_onset`, `p_end`, `qrs_onset`, `qrs_end`, `t_end`, `p_axis`, `qrs_axis`,
`t_axis`.

Ограничение принципиально: опубликованы только **global** machine measures; per-lead measurements
в версии 1.0 отсутствуют ([methods](https://physionet.org/content/mimic-iv-ecg/1.0/#machine-measurements)).
Поэтому набор годится для независимой проверки interval/axis/rhythm/conduction rules и parser
machine statements, но не для 24 per-lead Q/R/S/T amplitudes текущего numeric pack.

### KURIAS-ECG 1.0 — пока недоступен

KURIAS обещает почти идеальный comparator: 20 000 10-second/500-Hz ECG, analyzed parameters,
147 device statements, SNOMED/OMOP mapping и 10 Minnesota groups
([data description](https://physionet.org/content/kurias-ecg/1.0/)). Однако PhysioNet явно
сообщает, что downloads отключены после internal audit; files unavailable, лицензия — Restricted
Health Data License 1.5.0 ([access status](https://physionet.org/content/kurias-ecg/1.0/#files)).
До повторного открытия он невоспроизводим и не должен входить в обязательный benchmark.

## 6. Стандарты и import contract

Текущий DICOM PS3.16 TID 3713 задаёт global ventricular rate, QT/QTc, PR, QRS, RR, axes и ectopic
beat counts; TID 3714 задаёт per-lead waveform durations/voltages, ST morphology и noise
([global template](https://dicom.nema.org/medical/dicom/current/output/chtml/part16/sect_TID_3713.html),
[lead template](https://dicom.nema.org/medical/dicom/current/output/chtml/part16/sect_TID_3714.html)).
Это хороший typed boundary для MiniMed с UCUM units и measurement provenance, но стандарт не
определяет diagnostic decision tree.

ISO 41064:2023 edition 1 заменил ISO 11073-91064:2009 и охватывает обмен signal data,
measurements, annotations и interpretation results; полный текст — платный
([официальная карточка ISO](https://www.iso.org/standard/84664.html)). Это transport standard,
не открытая реализация диагностики.

MIT-парсер [`scpinfo@52c1ec0`](https://github.com/gitrust/scpinfo/tree/52c1ec044318acada75128746b0514345851b72d)
принимает SCP file и лицензирован MIT, но Section 8 поддержан только partly
([README](https://github.com/gitrust/scpinfo/blob/52c1ec044318acada75128746b0514345851b72d/README.md#L6-L18));
фактически `_section8` читает лишь header и возвращает пустой `Section8`
([source](https://github.com/gitrust/scpinfo/blob/52c1ec044318acada75128746b0514345851b72d/scpreader.py#L365-L372)).
В текущем виде он не извлекает textual diagnosis и не нужен MiniMed.

## Ranked shortlist

1. **MIMIC-IV-ECG 1.0 — adopt for validation.** Единственная новая находка, сразу улучшающая
   доказательность global numeric rules без vendor code.
2. **VERITAS V7.20 guide — reference.** Лучший новый источник структуры rule graph, feature
   gaps, suppression и pediatric separation; не копировать vendor implementation.
3. **NOVACODE 12/92 — reference.** Полезен для формальных Minnesota/CIIS/LVH test cases, но не
   как готовый runtime и не как hospital-diagnosis oracle.
4. **WFDB 10.7.0 — external evaluator.** Использовать только для annotation metrics.
5. **3D FMM-ECG — measurement benchmark.** Добавлять лишь если текущая эвристика P/Q/R/S/T не
   выдержит количественный benchmark и GPL/R dependency приемлемы для отдельного research tool.
6. **KURIAS — wait.** Пересмотреть после официального возобновления downloads.
7. **ECGTwinMentor — reject.** Не использовать даже как accuracy baseline.

## Локальная проверка правила оси на MIMIC-IV-ECG

31 августа 2026 г. `machine_measurements.csv` был скачан напрямую из версии 1.0 и проверен
локально. Размер — 182 674 683 байта, SHA-256
`56f6b1413221bce95bd6f48b28ca1acf27ae0b073d6f2c1d12f3af7500eabbb6`, 800 035 строк и 156
разных `cart_id`.

Проверялось только взрослое AHA-правило оси MiniMed: `−30…+90°` — референсный диапазон, левее
него — отклонение влево, правее — вправо, левее `−90°` — крайняя ось. Значения `181…360°`
нормализовались в signed-представление; 3564 sentinel/вне диапазона были отклонены. Из аппаратных
строк брались только строгие фразы `left/right axis deviation` и `extreme QRS axis`; 49 219
`leftward/rightward`, `borderline` и `indeterminate` были исключены как иной словарь. Осталось
747 252 сопоставимых записей.

| Аппаратная строка → / правило ↓ | диапазон | влево | вправо | крайняя |
|---|---:|---:|---:|---:|
| Нет строгого axis statement | 602 649 | 43 971 | 7 267 | 4 422 |
| Left axis deviation | 2 622 | 74 110 | 0 | 3 386 |
| Right axis deviation | 48 | 0 | 6 487 | 2 135 |
| Extreme QRS axis | 0 | 0 | 0 | 155 |

Для бинарного «ось вне диапазона» agreement с аппаратным statement составил: sensitivity 0,970,
specificity 0,915, PPV 0,608, NPV 0,996; точное совпадение четырёх категорий — 0,915. Среди 12
крупнейших `cart_id` sensitivity менялась от 0,907 до 0,975, specificity — от 0,832 до 0,954.

Это не клиническая валидация: аппаратные строки используют suppression, собственные границы и
разную терминологию, а отсутствие строки не доказывает норму. Результат подтверждает только два
решения продукта: показывать буквальный факт «ось вне взрослого референсного диапазона» и не
выводить из него фасцикулярную блокаду/причину. Импорт обязан нормализовать представление угла и
отклонять sentinel; фото и ручной ввод требуют отдельной погрешности измерения.

### Локальная проверка интервалов

На том же файле проверены правила, которые доступны MiniMed по ручным цифрам. ЧСС вычислялась из
RR, PR — как `qrs_onset − p_onset`, QRS — `qrs_end − qrs_onset`, QT — `t_end − qrs_onset`, QTc —
по Framingham. Sentinel и значения вне действующего UI-контракта исключались: 1530 RR, 123 976 PR,
1544 QRS и 1422 QT.

| Правило MiniMed | Строгий machine comparator | N | Sensitivity | Specificity | PPV | NPV |
|---|---|---:|---:|---:|---:|---:|
| ЧСС <50/мин | dominant `sinus bradycardia` | 644 968 | 0,170 | 0,9997 | 0,991 | 0,869 |
| ЧСС ≥100/мин | dominant `sinus tachycardia` | 644 968 | 0,990 | 0,997 | 0,975 | 0,999 |
| PR >200 мс | strict first-degree A-V block / prolonged PR | 631 376 | 0,953 | 0,987 | 0,803 | 0,997 |
| QRS ≥120 мс | complete BBB / IVCD / prolonged QRS | 796 450 | 0,927 | 0,903 | 0,451 | 0,993 |
| QTc Framingham >470 мс | `prolonged QT interval` | 797 823 | 0,678 | 0,936 | 0,343 | 0,983 |

Низкая sensitivity брадикардии ожидаема: аппараты часто печатают sinus bradycardia при 50–59/мин,
тогда как клинический guideline ACC/AHA/HRS использует `<50/мин` как компонент определения sinus
node dysfunction и запрещает делать диагноз только по частоте
([2018 guideline](https://www.ahajournals.org/doi/full/10.1161/CIR.0000000000000628)). Поэтому
MiniMed сохраняет консервативный порог и текст «признак по частоте».

Для QT результат нельзя исправлять подгонкой одного unisex-порога: vendor formula, пол, QRS и
suppression неизвестны. AHA Part IV рекомендует QTc `>450 мс` для мужчин и `≥460 мс` для женщин,
а при широком QRS требует отдельной коррекции/JT
([Part IV](https://www.ahajournals.org/doi/pdf/10.1161/circulationaha.108.191096)). В приложении
добавлен пол для этих порогов; без пола остаётся консервативный `>470 мс`, `≥500 мс` всегда требует
срочной проверки. Сам MIMIC-файл не содержит пола и не валидирует это изменение.

Практический вывод: rate ≥100 и PR >200 — сильные agreement checks; QRS ≥120 остаётся только
буквальным фактом «широкий комплекс», не BBB; QTc — review finding с обязательным указанием формулы,
пола и ограничения при QRS ≥120. Machine statements — comparator, не ground truth.

## Следующий расширенный эксперимент MiniMed

Не писать новый runtime и не скачивать 90 GB waveforms. Скачать только 174.2 MB
`machine_measurements.csv` MIMIC-IV-ECG 1.0 и:

1. детерминированно нормализовать machine `report_0..17` в небольшой locked vocabulary:
   brady/tachycardia, first-degree AV block, wide QRS/conduction delay, axis deviation, prolonged QT;
2. вычислить только те MiniMed rules, которым достаточно RR, P/QRS/T fiducials и axes;
3. сделать patient-independent sample и отдельно stratify по `cart_id`;
4. для каждого statement выдать coverage, sensitivity, specificity, PPV/NPV и confusion table;
5. не обучать на этих labels и не называть machine statements ground truth: это external vendor
   agreement test, после которого спорные случаи должен проверить врач.

Этот эксперимент проверит полезность числового слоя быстрее и честнее, чем перенос очередной CNN
или vendor-like rule transcription.
